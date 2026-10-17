// `bench regression [--base <ref|file>] [--fresh <file>] [--json]` (architecture §8.5, g2.regression):
// compares a fresh artifact with a base one, and the datasets with the base's datasets. It fails on fewer
// true positives, a new extent mismatch, an unlisted miss or false entry, a code end more than 16 bytes
// from the ELF, a non-deterministic run, a ROM the fresh artifact lost, and a `labels`/`untyped` row
// added without a `Bench-Exception: <rom> <addr> <reason>` trailer in a commit since the base. When the
// base rows come from the PoC's dumps and the fresh ones from romlift's analysis (phase 2 against main),
// each row is also compared field by field: the ROM, ELF and startup fields must be equal, and its
// misses, false entries and extent mismatches may only improve. The default base is
// `git merge-base origin/main HEAD`, never HEAD; a base without an artifact passes with a note. Each
// problem has a kind, so --json prints {schema: 'romlift/bench-regression@1', ok, base, problems}.
import { isDeepStrictEqual } from 'node:util';

import { compareCodeUnits } from 'romlift';

import { isImprovement } from './accepted-diffs.ts';

import { parseResultsText, readResultsFile, type Results } from './artifact.ts';
import { resultsPath, type BenchContext } from './context.ts';
import { loadDatasets, parseDataset, type Dataset } from './dataset.ts';
import { rowDiffs } from './baseline-rows.ts';
import { BenchError, exists } from './files.ts';
import { gitMergeBase, gitMessagesSince, gitShow } from './git.ts';
import type { BenchRow } from './row.ts';

export const CODE_END_TOLERANCE = 16;

export interface ExceptionTrailer {
  readonly rom: string;
  readonly addr: string;
  readonly reason: string;
}

const TRAILER = /^Bench-Exception:[ \t]+(\S+)[ \t]+(0x[0-9A-F]{8})[ \t]+(\S.*)$/gm;

/** Every `Bench-Exception: <rom> <addr> <reason>` line of the messages. */
export function parseTrailers(messages: readonly string[]): ExceptionTrailer[] {
  const out: ExceptionTrailer[] = [];
  for (const message of messages) {
    for (const m of message.matchAll(TRAILER)) {
      if (m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) out.push({ rom: m[1], addr: m[2], reason: m[3].trim() });
    }
  }
  return out;
}

export interface RegressionInput {
  readonly fresh: Results;
  readonly base: Results;
  readonly datasets: readonly Dataset[];
  /** The base's datasets by name; undefined when the base is a file and its datasets are unknown. */
  readonly baseDatasets: ReadonlyMap<string, Dataset> | undefined;
  readonly trailers: readonly ExceptionTrailer[];
}

/** One reason the fresh artifact regresses against the base (the --json `problems`). */
export interface RegressionProblem {
  readonly kind: string;
  readonly rom: string;
  readonly detail: string;
}

/** The row fields that must not move at all: they describe the ROM, its ELF and the startup region, not the rules. */
const FIXED_FIELDS = ['sha1', 'elfCommit', 'elfFunctions', 'startup'] as const;

/**
 * A PoC-sourced base row against a romlift row, field by field: the fixed fields must be equal, and the
 * misses, false entries and extent mismatches may only improve (baseline-rows.ts's kinds).
 */
function pocRowProblems(fresh: BenchRow, base: BenchRow): RegressionProblem[] {
  const out: RegressionProblem[] = [];
  for (const field of FIXED_FIELDS) {
    if (!isDeepStrictEqual(fresh[field], base[field])) {
      out.push({ kind: 'row-field', rom: fresh.name, detail: `${field} is ${JSON.stringify(fresh[field])}, the PoC row has ${JSON.stringify(base[field])}` });
    }
  }
  const found = new Set([...base.extents.mismatches.map((m) => m.addr)].filter((addr) => !fresh.misses.some((m) => m.addr === addr)));
  const baseRow = { name: base.name, tp: base.tp, misses: base.misses, falseEntries: base.falseEntries, mismatches: base.extents.mismatches };
  for (const d of rowDiffs(baseRow, fresh, found)) {
    if (isImprovement(d.kind)) continue;
    // New extent mismatches are reported once, by the check every base gets.
    if (d.kind === 'extent-mismatch-added') continue;
    out.push({ kind: d.kind, rom: fresh.name, detail: `${d.addr}: ${d.kind.replace(/-/g, ' ')} against the PoC row` });
  }
  return out;
}

export function regressionProblems(input: RegressionInput): RegressionProblem[] {
  const { fresh, base } = input;
  const problems: RegressionProblem[] = [];
  const pocBase = base.meta.source === 'poc' && fresh.meta.source === 'romlift';
  for (const r of fresh.roms) {
    const push = (kind: string, detail: string): void => {
      problems.push({ kind, rom: r.name, detail });
    };
    for (const m of r.misses) if (!m.listed) push('unlisted-miss', `miss ${m.addr} ${m.name} (${m.reason}) is not in the labels list`);
    for (const f of r.falseEntries) {
      if (!f.listed) push('unlisted-false-entry', `false entry ${f.addr} via ${f.origin}, ${f.size} bytes${f.owner === undefined ? '' : ` inside ${f.owner}`} is not in the untyped list`);
    }
    if (Math.abs(r.codeEnd.delta) > CODE_END_TOLERANCE) push('code-end', `code end ${r.codeEnd.found} is ${r.codeEnd.delta} bytes from the ELF's ${r.codeEnd.elf}`);
    if (!r.deterministic) push('nondeterministic', 'two runs disagree');
    const b = base.roms.find((x) => x.name === r.name);
    if (b === undefined) continue;
    if (r.tp < b.tp) push('true-positives', `true positives fell from ${b.tp} to ${r.tp}`);
    const had = new Set(b.extents.mismatches.map((m) => m.addr));
    for (const m of r.extents.mismatches) if (!had.has(m.addr)) push('new-extent-mismatch', `new extent mismatch at ${m.addr} ${m.name}: found ${m.found}, ELF ${m.elf}`);
    if (pocBase) problems.push(...pocRowProblems(r, b));
  }
  for (const b of base.roms) if (!fresh.roms.some((r) => r.name === b.name)) problems.push({ kind: 'coverage', rom: b.name, detail: 'in the base artifact but not in the fresh one (coverage shrank)' });
  if (input.baseDatasets !== undefined) {
    const allowed = new Set(input.trailers.map((t) => `${t.rom} ${t.addr}`));
    for (const d of input.datasets) {
      const was = input.baseDatasets.get(d.name);
      for (const list of ['labels', 'untyped'] as const) {
        const before = new Set((was?.[list] ?? []).map((e) => e.addr));
        for (const e of d[list]) {
          if (!before.has(e.addr) && !allowed.has(`${d.name} ${e.addr}`)) {
            problems.push({ kind: 'untrailered-row', rom: d.name, detail: `${list} row ${e.addr} was added without a 'Bench-Exception: ${d.name} ${e.addr} <reason>' trailer` });
          }
        }
      }
      // A codeEnd row (D60 j) is an exception row too.
      const end = d.codeEnd?.addr;
      if (end !== undefined && was?.codeEnd?.addr !== end && !allowed.has(`${d.name} ${end}`)) {
        problems.push({ kind: 'untrailered-row', rom: d.name, detail: `codeEnd row ${end} was added without a 'Bench-Exception: ${d.name} ${end} <reason>' trailer` });
      }
    }
  }
  return problems;
}

/** The problems as text lines, `<rom>: <detail>`. */
export function regressionFailures(input: RegressionInput): string[] {
  return regressionProblems(input).map((p) => `${p.rom}: ${p.detail}`);
}

export interface RegressionOptions {
  readonly base?: string;
  readonly fresh?: string;
}

export interface RegressionOutcome {
  readonly baseLabel: string;
  readonly notes: readonly string[];
  /** `<rom>: <detail>` per problem, sorted. */
  readonly failures: readonly string[];
  /** In the order of `failures`. */
  readonly problems: readonly RegressionProblem[];
}

export const REGRESSION_SCHEMA = 'romlift/bench-regression@1';

/** The --json line (frozen by test/gates/g2.regression.test.ts). */
export function regressionReport(outcome: RegressionOutcome): { readonly schema: typeof REGRESSION_SCHEMA; readonly ok: boolean; readonly base: string; readonly problems: readonly RegressionProblem[] } {
  return { schema: REGRESSION_SCHEMA, ok: outcome.problems.length === 0, base: outcome.baseLabel, problems: outcome.problems };
}

/** The base artifact: a file when `ref` names one, else the artifact committed at the git ref. */
export async function readBase(cx: BenchContext, ref: string): Promise<{ readonly artifact: Results | undefined; readonly isFile: boolean }> {
  if (await exists(ref)) return { artifact: await readResultsFile(ref), isFile: true };
  const text = await gitShow(cx.repoRoot, ref, 'bench/results.json');
  return { artifact: text === null ? undefined : parseResultsText(text, `${ref}:bench/results.json`), isFile: false };
}

export async function defaultBase(cx: BenchContext): Promise<string> {
  const base = await gitMergeBase(cx.repoRoot, 'origin/main', 'HEAD');
  if (base === null) throw new BenchError('cannot compute git merge-base origin/main HEAD; pass --base <ref|file>');
  return base;
}

export async function regression(cx: BenchContext, options: RegressionOptions = {}): Promise<RegressionOutcome> {
  const ref = options.base ?? (await defaultBase(cx));
  const freshPath = options.fresh ?? resultsPath(cx);
  const fresh = await readResultsFile(freshPath);
  if (fresh === undefined) throw new BenchError(`${freshPath} does not exist: run npm run bench -- run`);
  const { artifact: base, isFile } = await readBase(cx, ref);
  if (base === undefined) return { baseLabel: ref, notes: [`the base ${ref} has no bench/results.json: nothing to compare`], failures: [], problems: [] };
  const loaded = await loadDatasets(cx);
  if (loaded.problems.length > 0) throw new BenchError(`malformed datasets: ${loaded.problems.map((p) => p.detail).join('; ')}`);
  const { datasets } = loaded;
  const notes: string[] = [];
  let baseDatasets: Map<string, Dataset> | undefined;
  let trailers: ExceptionTrailer[] = [];
  if (isFile) {
    notes.push('the base is a file: added dataset rows are not checked against trailers');
  } else {
    baseDatasets = new Map();
    for (const d of datasets) {
      const text = await gitShow(cx.repoRoot, ref, `bench/dataset/real/${d.name}.json`);
      if (text === null) continue;
      const parsed = parseDataset(JSON.parse(text) as unknown, `${ref}:bench/dataset/real/${d.name}.json`, { retired: true });
      if (parsed.dataset !== undefined) baseDatasets.set(d.name, parsed.dataset);
    }
    trailers = parseTrailers(await gitMessagesSince(cx.repoRoot, ref));
  }
  if (base.meta.source === 'poc' && fresh.meta.source === 'romlift') notes.push('the base rows come from the PoC: the romlift rows are compared with them field by field');
  const sorted = regressionProblems({ fresh, base, datasets, baseDatasets, trailers })
    .map((p) => ({ problem: p, line: `${p.rom}: ${p.detail}` }))
    .sort((a, b) => compareCodeUnits(a.line, b.line));
  return { baseLabel: ref, notes, failures: sorted.map((p) => p.line), problems: sorted.map((p) => p.problem) };
}

/** Reads a fresh artifact for `diff`: the given file or bench/results.json. */
export async function readFresh(cx: BenchContext, path?: string): Promise<Results> {
  const freshPath = path ?? resultsPath(cx);
  const fresh = await readResultsFile(freshPath);
  if (fresh === undefined) throw new BenchError(`${freshPath} does not exist: run npm run bench -- run`);
  return fresh;
}

