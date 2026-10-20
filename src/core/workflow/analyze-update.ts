// The `analyze --update` workflow (architecture §2.1, §6.5, D9, D23; roadmap 4.D): what the analysis says now about a
// project whose config may be older than romlift or than the user's edits, as a TOML patch. Two analyses, one at a
// time so their results never share the bin's heap cap:
//
//   1. the discover run of the ROM: every function it finds that [functions] does not list is a function proposal
//      (source `analysis`, its accepting rule; `label = true` when its entry lies inside another found function's
//      extent, as configFromDiscover writes it). Only those proposals outlive the run.
//   2. the confirm run over the project's config, with `generate`'s seeds (listedSeedsOf): under the owner's answer
//      to Q1 ("Only entries with `from`", D76 a, applied here by D77 e) only a listed entry with `from` is validated
//      (`Seed.validate`), one that fails the valid.* rules is reported (W_LISTED_INVALID) and stays listed, since the
//      TOML decides (D9); an entry without `from` is taken as it is, whether discover still finds it or not.
//
// planPatch (core/config/patch.ts) turns the proposals into line edits of the TOML text, keeping every comment; a
// patch it refuses (a table restructured by hand) is the plan's refusal. foundation/util/line-diff.ts renders the
// change for printing. Pure: the shell reads the project and, with `--write`, saves the text (shell/config/save.ts)
// if it still has the sha1 the plan was made from.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { AnalysisCode } from '../analysis/codes.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { planPatch } from '../config/patch.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { coveredEntries } from '../layout/borders.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { Proposal } from '../proposals/types.ts';
import { discover, profileOrDefault } from './discover.ts';
import { confirmOptions } from './generate.ts';
import { romSha1Problems } from '../config/rom-sha1.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { WorkflowCodes } from './codes.ts';
import type { AnalyzeUpdateInputs, AnalyzeUpdatePlan } from './types.ts';

/** The report a listed entry that fails validity gets. */
const LISTED_INVALID: AnalysisCode = 'W_LISTED_INVALID';

/** What the discover run leaves for the update: the proposals and its diagnostics. */
interface Discovered {
  readonly proposals: readonly Proposal[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The function proposals of a discover result against `config`: every found entry the config does not list. */
export function unlistedProposals(result: Pick<AnalysisResult, 'functions'>, config: Pick<RomliftConfig, 'functions'>): readonly Proposal[] {
  const nested = coveredEntries(result.functions);
  return result.functions
    .filter((f) => !config.functions.has(f.entry))
    .map(
      (f): Proposal => ({
        kind: 'function',
        addr: f.entry,
        mode: f.mode,
        ...(nested.has(f.entry) ? { label: true } : {}),
        source: { kind: 'analysis', rule: f.accepted.rule },
      }),
    );
}

/** Step 1 of the header; the discover result does not outlive this call. */
function discovered(rom: Rom, config: RomliftConfig, profile: CompilerProfile): Discovered {
  const result = discover(rom, { profile });
  return { proposals: unlistedProposals(result, config), diagnostics: result.diagnostics };
}

/** The W_LISTED_INVALID reports of step 2 (its W_UNLISTED_FUNCTION ones are the proposals already). */
function listedReports(rom: Rom, config: RomliftConfig, profile: CompilerProfile): readonly Diagnostic[] {
  const result = analyze(rom, profile, confirmOptions(config));
  return result.diagnostics.filter((d) => d.code === LISTED_INVALID || d.severity === 'error');
}

/**
 * The plan of `analyze --update` (architecture §2.1): the proposals, the patched TOML text and whether it changed,
 * with the reports. Refused (`ok: false`) for another ROM than the config's, an image that is not a cartridge, a
 * discover error, or a patch planPatch refuses (E_TOML_PATCH_REFUSED, whose message holds the entries to paste).
 */
export function analyzeUpdate(inputs: AnalyzeUpdateInputs): AnalyzeUpdatePlan {
  const { rom, config } = inputs;
  const refused = romSha1Problems(inputs.rom, inputs.config);
  if (refused.length > 0) return { ok: false, diagnostics: refused };
  const problems = checkRom(rom.bytes);
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const profile = profileOrDefault(inputs.profile);
  const found = discovered(rom, config, profile);
  if (found.diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: found.diagnostics };
  const reports = listedReports(rom, config, profile);
  const patch = planPatch(inputs.configText, config, found.proposals);
  if (!patch.ok) return { ok: false, diagnostics: [...reports, ...patch.diagnostics] };
  return { ok: true, proposals: found.proposals, text: patch.text, changed: patch.text !== inputs.configText, diagnostics: [...reports, ...patch.diagnostics] };
}

/**
 * E_STALE_CONFIG when the config on disk (`now`, read under the project lock just before the save) is not the text the
 * plan was made from (`read`): a user edit, or another `--write`, landed while the analyses ran, and saving the patch
 * would silently undo it. Empty when they are equal.
 */
export function staleConfigProblems(path: string, read: string, now: string): readonly Diagnostic[] {
  if (read === now) return [];
  return [diagnostic(WorkflowCodes, 'E_STALE_CONFIG', `${path} changed on disk since analyze --update read it; nothing was saved: run analyze --update --write again`, { path })];
}
