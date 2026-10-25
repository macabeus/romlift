// The `analyze --update` workflow (architecture §2.1, §6.5, D9, D23; roadmap 4.D): what the analysis says now about a
// project whose config may be older than romlift or than the user's edits, as a TOML patch. Two analyses, one at a
// time so their results never share the bin's heap cap:
//
//   1. the discover run of the ROM under the config's [[overrides]] (a data override claims its span, a code override
//      seeds its start, correctness-b0-3): every function it finds that [functions] does not list is a function
//      proposal (source `analysis`, its accepting rule, seed.override for a code override's start; `label = true` when
//      its entry lies inside another found function's extent, as configFromDiscover writes it). Only those proposals
//      outlive the run.
//   2. the confirm run over the project's config, with `generate`'s seeds (listedSeedsOf): under the owner's answer
//      to Q1 ("Only entries with `from`", D76 a, applied here by D77 e) only a listed entry with `from` is validated
//      (`Seed.validate`), one that fails the valid.* rules is reported (W_LISTED_INVALID) and stays listed, since the
//      TOML decides (D9); an entry without `from` is taken as it is, whether discover still finds it or not.
//
// Then the borders of the code that runs from RAM (architecture §6.7, D91): a hand-written [[overrides]] range with
// runs_at is its own module, so for each one whose start or end is not a module start (nor the ROM end) the plan
// proposes the missing border (runsAtBorders, source layout 'runs-at'): at the start an `asm` module `ram_<RUNADDR>`,
// and at the end a module resuming the one that held the range there (its kind, library and version), named
// `<that module>_<ENDADDR>` (eight upper-case hex digits each; `_2`, `_3`, … when the name is taken). A range that
// would take a `c` module's start inside it, or that does not lie in the ROM, cannot be made its own module and is
// refused with E_OVERRIDE_INVALID, the model's code and message.
//
// planPatch (core/config/patch.ts) turns the proposals into line edits of the TOML text, keeping every comment (a new
// [[modules]] block is inserted whole); a patch it refuses (a table restructured by hand) is the plan's refusal. A
// patch that changes the text is then parsed back and its module starts checked as generate checks them
// (architecture-r1-3, a0-4):
//
//   3. the confirm run over the patched config, its code layout and planModules (core/layout's isLegalStart): a
//      module start legal under the config on disk that the patch makes illegal, typically one a newly proposed
//      function's code now crosses or a runs_at border that is no legal border, is E_MODULE_BORDER naming the
//      proposals whose extent holds it, and a runs_at range still off the module borders is E_OVERRIDE_INVALID; either
//      refuses the plan, so `--write` saves nothing and generate is never handed a TOML it would refuse.
//
// foundation/util/line-diff.ts renders the change for printing. Pure: the shell reads the project and, with `--write`, saves the text (shell/config/save.ts)
// if it still has the sha1 the plan was made from.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hex, hexAddr } from '../../foundation/util/hex.ts';
import type { AnalysisCode } from '../analysis/codes.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { parseConfig } from '../config/parse.ts';
import { planPatch } from '../config/patch.ts';
import type { ModuleConfig, RomliftConfig } from '../config/schema.ts';
import { codeLayout, coveredEntries } from '../layout/borders.ts';
import { ModelCodes } from '../model/codes.ts';
import type { ModelCode } from '../model/codes.ts';
import { planModules } from '../model/modules.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { Proposal } from '../proposals/types.ts';
import { discoverOptions, profileOrDefault } from './discover.ts';
import { confirmOptions, overrideFactsOf } from './generate.ts';
import { romSha1Problems } from '../config/rom-sha1.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { WorkflowCodes } from './codes.ts';
import type { AnalyzeUpdateInputs, AnalyzeUpdatePlan } from './types.ts';

/** The report a listed entry that fails validity gets. */
const LISTED_INVALID: AnalysisCode = 'W_LISTED_INVALID';

/** The model's refusal of a module start that is not a legal border. */
const MODULE_BORDER: ModelCode = 'E_MODULE_BORDER';

/** The model's refusal of a runs_at range that is not its own module. */
const OVERRIDE_INVALID: ModelCode = 'E_OVERRIDE_INVALID';

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
  const result = analyze(rom, profile, { ...discoverOptions(), overrides: overrideFactsOf(config) });
  return { proposals: unlistedProposals(result, config), diagnostics: result.diagnostics };
}

// ---------------------------------------------------------------------------------------------------
// The borders of the runs_at ranges (§6.7).

type ModuleProposal = Extract<Proposal, { readonly kind: 'module' }>;

/** What runsAtBorders leaves: the module proposals, or the refusals of ranges that cannot be their own module. */
interface RunsAtBorders {
  readonly proposals: readonly ModuleProposal[];
  readonly refusals: readonly Diagnostic[];
}

/** `base`, or `base_2`, `base_3`, … : the first name not in `taken`, which it then holds. */
function freeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

/** The module of `modules` (in link order) that holds `a`: the last one starting at or below it. */
function moduleHolding(modules: readonly ModuleConfig[], a: Addr): ModuleConfig | undefined {
  let found: ModuleConfig | undefined;
  for (const m of modules) if (m.start <= a) found = m;
  return found;
}

/** E_OVERRIDE_INVALID for a runs_at range that cannot be its own module, with the model's message and why. */
function rangeRefusal(start: Addr, end: Addr, why: string): Diagnostic {
  const message = `the runs_at range [${hexAddr(start)}, ${hexAddr(end)}) does not start and end on module borders; a range that runs from RAM is its own module`;
  return diagnostic(ModelCodes, OVERRIDE_INVALID, `analyze --update cannot propose its borders, so nothing is saved: ${message}, and ${why}`, { span: { start, end }, addr: start });
}

/**
 * The module proposals that make every runs_at range of `config` its own module (see the header): one at a start that
 * is not a module start, one at an end that is neither a module start nor the ROM end; ranges in start order. Each
 * range is judged against the config's modules alone, so two ranges that share a module each split it once.
 */
export function runsAtBorders(rom: Pick<Rom, 'base' | 'end'>, config: Pick<RomliftConfig, 'modules' | 'overrides'>): RunsAtBorders {
  const proposals: ModuleProposal[] = [];
  const refusals: Diagnostic[] = [];
  const taken = new Set(config.modules.map((m) => m.name));
  const starts = new Set(config.modules.map((m) => m.start));
  const source = { kind: 'layout', reason: 'runs-at' } as const;
  const ranges = config.overrides.filter((o) => o.runsAt !== undefined).sort((a, b) => a.start - b.start || a.size - b.size);
  // A range ending where another starts leaves that border to the next range's own module.
  const rangeStarts = new Set(ranges.map((o) => o.start));
  for (const o of ranges) {
    const start = o.start;
    const end = o.start + o.size;
    if (start < rom.base || end > rom.end || o.size <= 0) {
      refusals.push(rangeRefusal(start, end, `it does not lie inside the ROM [${hexAddr(rom.base)}, ${hexAddr(rom.end)})`));
      continue;
    }
    const inner = config.modules.find((m) => m.kind === 'c' && m.start > start && m.start < end);
    if (inner !== undefined) {
      refusals.push(rangeRefusal(start, end, `the c module ${inner.name} starts inside it at ${hexAddr(inner.start)}: a c module's code cannot run from RAM`));
      continue;
    }
    const resumed = end < rom.end && !starts.has(end) && !rangeStarts.has(end) ? moduleHolding(config.modules, end) : undefined;
    if (!starts.has(start) && !proposals.some((p) => p.start === start)) proposals.push({ kind: 'module', name: freeName(`ram_${hex(o.runsAt ?? 0)}`, taken), start, moduleKind: 'asm', source });
    if (resumed !== undefined) {
      proposals.push({
        kind: 'module',
        name: freeName(`${resumed.name}_${hex(end)}`, taken),
        start: end,
        moduleKind: resumed.kind,
        ...(resumed.library === undefined || resumed.version === undefined ? {} : { library: { name: resumed.library, version: resumed.version } }),
        source,
      });
    }
  }
  return { proposals, refusals };
}

// ---------------------------------------------------------------------------------------------------
// The confirm runs.

/** What a confirm run over a config leaves for the update: its reports and the module starts generate refuses. */
interface Confirmed {
  /** The W_LISTED_INVALID reports and the analysis errors (its W_UNLISTED_FUNCTION ones are the proposals already). */
  readonly reports: readonly Diagnostic[];
  /** The E_MODULE_BORDER and E_OVERRIDE_INVALID diagnostics of planModules under the run's code layout, as buildModel raises them. */
  readonly borders: readonly Diagnostic[];
  /** Per refused start, the entries of the run's functions among `entries` whose extent holds it strictly. */
  readonly covering: ReadonlyMap<Addr, readonly Addr[]>;
}

/** Step 2 (and step 3 over the patched config); the confirm result does not outlive this call. */
function confirmed(rom: Rom, config: RomliftConfig, profile: CompilerProfile, entries: ReadonlySet<Addr> = new Set()): Confirmed {
  const result = analyze(rom, profile, confirmOptions(config));
  const borders = planModules(rom, config, codeLayout(rom, result)).diagnostics.filter((d) => d.code === MODULE_BORDER || d.code === OVERRIDE_INVALID);
  const covering = new Map<Addr, readonly Addr[]>();
  for (const d of borders) {
    const at = d.addr;
    if (at !== undefined) covering.set(at, result.functions.filter((f) => entries.has(f.entry) && f.extent.start < at && at < f.extent.end).map((f) => f.entry));
  }
  return { reports: result.diagnostics.filter((d) => d.code === LISTED_INVALID || d.severity === 'error'), borders, covering };
}

/** The proposals a refused start is laid at: those whose extent holds it, else the nearest function proposal below it. */
function responsible(at: Addr, covering: readonly Addr[], proposals: readonly Proposal[]): readonly Addr[] {
  if (covering.length > 0) return covering;
  const below = proposals.flatMap((p) => (p.kind === 'function' && p.addr < at ? [p.addr] : []));
  return below.length === 0 ? [] : [Math.max(...below)];
}

/**
 * Step 3: E_MODULE_BORDER for every module start of the patched text that generate would refuse and the config on
 * disk does not already have refused (`before`, step 2's), each naming the proposals laid at it, and every
 * E_OVERRIDE_INVALID left (the borders the plan proposed did not make the range its own module). Empty when the patch
 * leaves every start legal and every runs_at range its own module.
 */
function patchedBorderProblems(rom: Rom, text: string, profile: CompilerProfile, proposals: readonly Proposal[], before: readonly Diagnostic[]): readonly Diagnostic[] {
  const parsed = parseConfig(text);
  if (!parsed.ok) return parsed.diagnostics;
  const known = new Set(before.filter((d) => d.code === MODULE_BORDER).map((d) => d.addr));
  const entries = new Set(proposals.flatMap((p) => (p.kind === 'function' ? [p.addr] : [])));
  const after = confirmed(rom, parsed.value, profile, entries);
  const ranges = after.borders
    .filter((d) => d.code === OVERRIDE_INVALID)
    .map((d) => diagnostic(ModelCodes, OVERRIDE_INVALID, `analyze --update refuses its patch, so nothing is saved: ${d.message}`, { ...(d.span === undefined ? {} : { span: d.span }), ...(d.addr === undefined ? {} : { addr: d.addr }) }));
  const starts = after.borders
    .filter((d) => d.code === MODULE_BORDER && !known.has(d.addr))
    .map((d) => {
      const at = d.addr ?? 0;
      const named = responsible(at, after.covering.get(at) ?? [], proposals);
      const who = named.length === 0 ? 'the patch' : `the proposed function${named.length === 1 ? '' : 's'} ${named.map(hexAddr).join(', ')}`;
      return diagnostic(ModelCodes, MODULE_BORDER, `analyze --update refuses its patch, so nothing is saved: with ${who}, generate would refuse romlift.toml: ${d.message}`, {
        addr: at,
        cites: [...named, ...(d.cites ?? [])],
      });
    });
  return [...starts, ...ranges];
}

/**
 * The plan of `analyze --update` (architecture §2.1): the proposals, the patched TOML text and whether it changed,
 * with the reports. Refused (`ok: false`) for another ROM than the config's, an image that is not a cartridge, a
 * discover error, a runs_at range that cannot be its own module (E_OVERRIDE_INVALID), a patch planPatch refuses
 * (E_TOML_PATCH_REFUSED, whose message holds the entries to paste), or a patch whose module starts generate would
 * refuse (E_MODULE_BORDER naming the proposals, E_OVERRIDE_INVALID, step 3).
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
  const ram = runsAtBorders(rom, config);
  if (ram.refusals.length > 0) return { ok: false, diagnostics: ram.refusals };
  const proposals = [...found.proposals, ...ram.proposals];
  const current = confirmed(rom, config, profile);
  const reports = current.reports;
  const patch = planPatch(inputs.configText, config, proposals);
  if (!patch.ok) return { ok: false, diagnostics: [...reports, ...patch.diagnostics] };
  const changed = patch.text !== inputs.configText;
  const borders = changed ? patchedBorderProblems(rom, patch.text, profile, proposals, current.borders) : [];
  if (borders.length > 0) return { ok: false, diagnostics: [...reports, ...patch.diagnostics, ...borders] };
  return { ok: true, proposals, text: patch.text, changed, diagnostics: [...reports, ...patch.diagnostics] };
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
