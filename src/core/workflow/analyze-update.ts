// The `analyze --update` workflow (architecture §2.1, §6.5, D9, D23; roadmap 4.D): what the analysis says now about a
// project whose config may be older than romlift or than the user's edits, as a TOML patch. Two analyses, one at a
// time so their results never share the bin's heap cap:
//
//   1. the discover run of the ROM: every function it finds that [functions] does not list is a function proposal
//      (source `analysis`, its accepting rule; `label = true` when its entry lies inside another found function's
//      extent, as configFromDiscover writes it). Only those proposals and the set of found entries outlive the run.
//   2. the confirm run over the project's config, in which every listed entry discover no longer finds is validated
//      (`Seed.validate`): one that fails the valid.* rules is reported (W_LISTED_INVALID) and stays listed, since
//      the TOML decides (D9); an entry discover still finds is taken as it is, as in `generate`.
//
// planPatch (core/config/patch.ts) turns the proposals into line edits of the TOML text, keeping every comment; a
// patch it refuses (a table restructured by hand) is the plan's refusal. unifiedDiff renders the change for
// printing (and `scaffold --diff` renders template drift with it). Pure: the shell reads the project and, with
// `--write`, saves the text (shell/config/save.ts).
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import type { AnalysisCode } from '../analysis/codes.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisResult, Seed } from '../analysis/types.ts';
import { planPatch } from '../config/patch.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { coveredEntries } from '../layout/borders.ts';
import { profileById } from '../profile/registry.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { Proposal } from '../proposals/types.ts';
import { discover, DISCOVER_PROFILE } from './discover.ts';
import { confirmOptions, projectRomProblems } from './generate.ts';
import type { AnalyzeUpdateInputs, AnalyzeUpdatePlan } from './types.ts';

/** The report a listed entry that fails validity gets. */
const LISTED_INVALID: AnalysisCode = 'W_LISTED_INVALID';

/** What the discover run leaves for the update: the proposals and every entry it found. */
interface Discovered {
  readonly proposals: readonly Proposal[];
  readonly found: ReadonlySet<Addr>;
  readonly diagnostics: readonly Diagnostic[];
}

function defaultProfile(): CompilerProfile {
  const profile = profileById(DISCOVER_PROFILE);
  if (profile === undefined) throw new RomliftInvariantError(`the ${DISCOVER_PROFILE} profile is not registered`);
  return profile;
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
  return { proposals: unlistedProposals(result, config), found: new Set(result.functions.map((f) => f.entry)), diagnostics: result.diagnostics };
}

/** The confirm seeds of step 2: the config's, validated where discover no longer finds the entry. */
export function updateSeeds(seeds: readonly Seed[], found: ReadonlySet<Addr>): readonly Seed[] {
  return seeds.map((seed): Seed => (found.has(seed.entry) || seed.label === true ? seed : { ...seed, validate: true }));
}

/** The W_LISTED_INVALID reports of step 2 (its W_UNLISTED_FUNCTION ones are the proposals already). */
function listedReports(rom: Rom, config: RomliftConfig, found: ReadonlySet<Addr>, profile: CompilerProfile): readonly Diagnostic[] {
  const options = confirmOptions(config);
  const result = analyze(rom, profile, { ...options, seeds: updateSeeds(options.seeds, found) });
  return result.diagnostics.filter((d) => d.code === LISTED_INVALID || d.severity === 'error');
}

/**
 * The plan of `analyze --update` (architecture §2.1): the proposals, the patched TOML text and whether it changed,
 * with the reports. Refused (`ok: false`) for another ROM than the config's, an image that is not a cartridge, a
 * discover error, or a patch planPatch refuses (E_TOML_PATCH_REFUSED, whose message holds the entries to paste).
 */
export function analyzeUpdate(inputs: AnalyzeUpdateInputs): AnalyzeUpdatePlan {
  const { rom, config } = inputs;
  const refused = projectRomProblems(inputs);
  if (refused.length > 0) return { ok: false, diagnostics: refused };
  const problems = checkRom(rom.bytes);
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const profile = inputs.profile ?? defaultProfile();
  const found = discovered(rom, config, profile);
  if (found.diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: found.diagnostics };
  const reports = listedReports(rom, config, found.found, profile);
  const patch = planPatch(inputs.configText, config, found.proposals);
  if (!patch.ok) return { ok: false, diagnostics: [...reports, ...patch.diagnostics] };
  return { ok: true, proposals: found.proposals, text: patch.text, changed: patch.text !== inputs.configText, diagnostics: [...reports, ...patch.diagnostics] };
}

// ---------------------------------------------------------------------------------------------------
// The unified diff of two texts, by line (Myers' O((N+M)D) shortest edit script), for printing a patch.

/** How many unchanged lines a hunk shows around each change. */
const CONTEXT = 3;

type LineOp = { readonly kind: 'same' | 'del' | 'add'; readonly text: string };

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The shortest edit script from `a` to `b` (Myers 1986), as line operations in order. */
function editScript(a: readonly string[], b: readonly string[]): readonly LineOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        done = true;
        break;
      }
    }
  }
  const ops: LineOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d] ?? v;
    const k = x - y;
    const prevK = k === -d || (k !== d && (vd[offset + k - 1] ?? 0) < (vd[offset + k + 1] ?? 0)) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[x - 1] ?? '' });
      x--;
      y--;
    }
    if (d === 0) break;
    if (x === prevX) ops.push({ kind: 'add', text: b[y - 1] ?? '' });
    else ops.push({ kind: 'del', text: a[x - 1] ?? '' });
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

/**
 * The unified diff (`diff -u` form, three lines of context) of `before` and `after`, labelled `a/<path>` and
 * `b/<path>`; the empty string when they are equal. Deterministic; lines are compared whole.
 */
export function unifiedDiff(before: string, after: string, path: string): string {
  if (before === after) return '';
  const a = linesOf(before);
  const b = linesOf(after);
  const ops = editScript(a, b);
  const changed = ops.map((op, i) => (op.kind === 'same' ? -1 : i)).filter((i) => i >= 0);
  const hunks: { start: number; end: number }[] = [];
  for (const i of changed) {
    const start = Math.max(0, i - CONTEXT);
    const end = Math.min(ops.length, i + CONTEXT + 1);
    const last = hunks[hunks.length - 1];
    if (last !== undefined && start <= last.end) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  let out = `--- a/${path}\n+++ b/${path}\n`;
  let ai = 0;
  let bi = 0;
  let at = 0;
  for (const hunk of hunks) {
    for (; at < hunk.start; at++) {
      const op = ops[at];
      if (op?.kind !== 'add') ai++;
      if (op?.kind !== 'del') bi++;
    }
    const body: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (; at < hunk.end; at++) {
      const op = ops[at];
      if (op === undefined) break;
      body.push(`${op.kind === 'same' ? ' ' : op.kind === 'del' ? '-' : '+'}${op.text}`);
      if (op.kind !== 'add') aCount++;
      if (op.kind !== 'del') bCount++;
    }
    out += `@@ -${aCount === 0 ? ai : ai + 1},${aCount} +${bCount === 0 ? bi : bi + 1},${bCount} @@\n${body.join('\n')}\n`;
    ai += aCount;
    bi += bCount;
  }
  return out;
}

