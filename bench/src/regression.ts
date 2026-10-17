// `bench regression [--base <ref|file>] [--fresh <file>]` (architecture §8.5): compares a fresh
// artifact with a base one, and the datasets with the base's datasets. It fails on fewer true
// positives, a new extent mismatch, an unlisted miss or false entry, a code end more than 16 bytes from
// the ELF, a non-deterministic run, a ROM the fresh artifact lost, and a `labels`/`untyped` row added
// without a `Bench-Exception: <rom> <addr> <reason>` trailer in a commit since the base. The default
// base is `git merge-base origin/main HEAD`, never HEAD; a base without an artifact passes with a note.
import { compareCodeUnits } from 'romlift';

import { parseResultsText, readResultsFile, type Results } from './artifact.ts';
import { resultsPath, type BenchContext } from './context.ts';
import { loadDatasets, parseDataset, type Dataset } from './dataset.ts';
import { BenchError, exists } from './files.ts';
import { gitMergeBase, gitMessagesSince, gitShow } from './git.ts';

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

export function regressionFailures(input: RegressionInput): string[] {
  const { fresh, base } = input;
  const failures: string[] = [];
  for (const r of fresh.roms) {
    for (const m of r.misses) if (!m.listed) failures.push(`${r.name}: miss ${m.addr} ${m.name} (${m.reason}) is not in the labels list`);
    for (const f of r.falseEntries) {
      if (!f.listed) failures.push(`${r.name}: false entry ${f.addr} via ${f.origin}, ${f.size} bytes${f.owner === undefined ? '' : ` inside ${f.owner}`} is not in the untyped list`);
    }
    if (Math.abs(r.codeEnd.delta) > CODE_END_TOLERANCE) failures.push(`${r.name}: code end ${r.codeEnd.found} is ${r.codeEnd.delta} bytes from the ELF's ${r.codeEnd.elf}`);
    if (!r.deterministic) failures.push(`${r.name}: two runs disagree`);
    const b = base.roms.find((x) => x.name === r.name);
    if (b === undefined) continue;
    if (r.tp < b.tp) failures.push(`${r.name}: true positives fell from ${b.tp} to ${r.tp}`);
    const had = new Set(b.extents.mismatches.map((m) => m.addr));
    for (const m of r.extents.mismatches) if (!had.has(m.addr)) failures.push(`${r.name}: new extent mismatch at ${m.addr} ${m.name}: found ${m.found}, ELF ${m.elf}`);
  }
  for (const b of base.roms) if (!fresh.roms.some((r) => r.name === b.name)) failures.push(`${b.name}: in the base artifact but not in the fresh one (coverage shrank)`);
  if (input.baseDatasets !== undefined) {
    const allowed = new Set(input.trailers.map((t) => `${t.rom} ${t.addr}`));
    for (const d of input.datasets) {
      const was = input.baseDatasets.get(d.name);
      for (const list of ['labels', 'untyped'] as const) {
        const before = new Set((was?.[list] ?? []).map((e) => e.addr));
        for (const e of d[list]) {
          if (!before.has(e.addr) && !allowed.has(`${d.name} ${e.addr}`)) {
            failures.push(`${d.name}: ${list} row ${e.addr} was added without a 'Bench-Exception: ${d.name} ${e.addr} <reason>' trailer`);
          }
        }
      }
    }
  }
  return failures;
}

export interface RegressionOptions {
  readonly base?: string;
  readonly fresh?: string;
}

export interface RegressionOutcome {
  readonly baseLabel: string;
  readonly notes: readonly string[];
  readonly failures: readonly string[];
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
  if (base === undefined) return { baseLabel: ref, notes: [`the base ${ref} has no bench/results.json: nothing to compare`], failures: [] };
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
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
      const parsed = parseDataset(JSON.parse(text) as unknown, `${ref}:bench/dataset/real/${d.name}.json`);
      if (parsed.dataset !== undefined) baseDatasets.set(d.name, parsed.dataset);
    }
    trailers = parseTrailers(await gitMessagesSince(cx.repoRoot, ref));
  }
  const failures = regressionFailures({ fresh, base, datasets, baseDatasets, trailers }).sort(compareCodeUnits);
  return { baseLabel: ref, notes, failures };
}

/** Reads a fresh artifact for `diff`: the given file or bench/results.json. */
export async function readFresh(cx: BenchContext, path?: string): Promise<Results> {
  const freshPath = path ?? resultsPath(cx);
  const fresh = await readResultsFile(freshPath);
  if (fresh === undefined) throw new BenchError(`${freshPath} does not exist: run npm run bench -- run`);
  return fresh;
}

