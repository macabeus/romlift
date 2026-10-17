// The real-tier datasets, bench/dataset/real/<rom>.json (architecture §8.2): what to read for one ROM,
// its recorded digests, and the two authored exception lists. The loader reads every file in code-unit
// order; the structural check reports every problem it finds rather than stopping at the first.
import { join } from 'node:path';

import { parseHexAddr } from 'romlift';

import { datasetDir, type BenchContext } from './context.ts';
import { isDirectory, isRecord, listFiles, readJson } from './files.ts';
import { isExceptionCategory, type ExceptionCategory } from './vocabulary.ts';

/** A FUNC symbol that is not a function start: a miss of it is expected. */
export interface LabelRow {
  readonly addr: string;
  readonly name: string;
  readonly category: ExceptionCategory;
  readonly note: string;
}

/** Real code the ELF does not type as a function: a false entry there is expected. */
export interface UntypedRow {
  readonly addr: string;
  /** The PoC's lists name the ELF function the entry is inside, when there is one. */
  readonly name?: string;
  readonly category: ExceptionCategory;
  readonly note: string;
}

export interface Reveal {
  readonly at: string;
  readonly commit: string;
  readonly reason: string;
}

export interface Dataset {
  readonly name: string;
  /** Paths relative to the benchmark root. */
  readonly rom: string;
  readonly elf: string;
  readonly map?: string;
  readonly sha1: string;
  readonly elfCommit: string;
  /** `bench run` refuses an ELF with another digest (D50). */
  readonly elfSha256: string;
  readonly objectsDir?: string;
  readonly objectsDigest?: string;
  /** The project family: 'kleod', 'sat-r', 'fe-gba', 'pret-gen3', 'zeldaret-tmc', … */
  readonly family: string;
  /** Local changes needed to rebuild the reference (docs/research-notes.md), or 'unchanged'. */
  readonly buildNote: string;
  /** Set when the dataset is created; never edited. */
  readonly heldout: boolean;
  /** Append-only; non-empty makes a held-out dataset tuning data. */
  readonly revealed: readonly Reveal[];
  readonly labels: readonly LabelRow[];
  readonly untyped: readonly UntypedRow[];
}

export type ListName = 'labels' | 'untyped';

/** Problem ids of dataset-check (architecture §8.3); `list` is `dataset` for a file-level problem. */
export type DatasetProblemId =
  | 'unreadable'
  | 'missing-field'
  | 'malformed-address'
  | 'duplicate-address'
  | 'unknown-category'
  | 'not-a-func'
  | 'not-inside-found-function'
  | 'is-a-func'
  | 'stale-exception'
  | 'input-unavailable'
  | 'tuning-set';

export interface DatasetProblem {
  readonly dataset: string;
  readonly list: ListName | 'dataset';
  readonly addr: string;
  readonly problem: DatasetProblemId;
  readonly detail: string;
}

const ADDR = /^0x[0-9A-F]{8}$/;

/** Sealed: held out and never revealed. Its rows never reach results.json (D25). */
export function isSealed(d: Pick<Dataset, 'heldout' | 'revealed'>): boolean {
  return d.heldout && d.revealed.length === 0;
}

/** The address of a well-formed row (0x and eight upper-case hex digits). */
export function rowAddr(addr: string): number {
  const value = parseHexAddr(addr);
  if (value === undefined || !ADDR.test(addr)) throw new Error(`malformed dataset address ${addr}`);
  return value;
}

interface Parsed {
  readonly dataset?: Dataset;
  readonly problems: readonly DatasetProblem[];
}

/**
 * Checks the structure of one dataset value: required fields and their types, `heldout` a boolean,
 * `revealed` an array, every address 0x plus eight upper-case hex digits and listed once per list,
 * every category defined. Returns the dataset when nothing is wrong.
 */
export function parseDataset(value: unknown, file: string): Parsed {
  const fallbackName = file.replace(/^.*\//, '').replace(/\.json$/, '');
  const problems: DatasetProblem[] = [];
  let name = fallbackName;
  const fileProblem = (detail: string, problem: DatasetProblemId = 'missing-field'): void => {
    problems.push({ dataset: name, list: 'dataset', addr: '', problem, detail });
  };
  if (!isRecord(value)) {
    fileProblem(`${file}: a dataset is a JSON object`, 'unreadable');
    return { problems };
  }
  if (typeof value['name'] === 'string' && value['name'] !== '') name = value['name'];
  const text = (key: string, optional = false): string | undefined => {
    const field = value[key];
    if (field === undefined && optional) return undefined;
    if (typeof field !== 'string' || field === '') {
      fileProblem(`${file}: '${key}' must be a non-empty string`);
      return undefined;
    }
    return field;
  };
  const fields = {
    name: text('name'),
    rom: text('rom'),
    elf: text('elf'),
    map: text('map', true),
    sha1: text('sha1'),
    elfCommit: text('elfCommit'),
    elfSha256: text('elfSha256'),
    objectsDir: text('objectsDir', true),
    objectsDigest: text('objectsDigest', true),
    family: text('family'),
    buildNote: text('buildNote'),
  };
  if (fields.sha1 !== undefined && !/^[0-9a-f]{40}$/.test(fields.sha1)) fileProblem(`${file}: 'sha1' must be 40 lower-case hex digits`);
  if (fields.elfSha256 !== undefined && !/^[0-9a-f]{64}$/.test(fields.elfSha256)) fileProblem(`${file}: 'elfSha256' must be 64 lower-case hex digits`);
  const heldout = value['heldout'];
  if (typeof heldout !== 'boolean') fileProblem(`${file}: 'heldout' must be a boolean`);
  const revealed = value['revealed'];
  const reveals: Reveal[] = [];
  if (!Array.isArray(revealed)) fileProblem(`${file}: 'revealed' must be an array`);
  else {
    for (const r of revealed) {
      if (isRecord(r) && typeof r['at'] === 'string' && typeof r['commit'] === 'string' && typeof r['reason'] === 'string') {
        reveals.push({ at: r['at'], commit: r['commit'], reason: r['reason'] });
      } else fileProblem(`${file}: every 'revealed' item is {at, commit, reason}`);
    }
  }
  const lists: { labels: LabelRow[]; untyped: UntypedRow[] } = { labels: [], untyped: [] };
  for (const list of ['labels', 'untyped'] as const) {
    const rows = value[list];
    if (!Array.isArray(rows)) {
      fileProblem(`${file}: '${list}' must be an array`);
      continue;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const rowProblem = (addr: string, problem: DatasetProblemId, detail: string): void => {
        problems.push({ dataset: name, list, addr, problem, detail });
      };
      if (!isRecord(row) || typeof row['addr'] !== 'string') {
        rowProblem('', 'missing-field', `${name}.${list}: a row has no 'addr' string`);
        continue;
      }
      const addr = row['addr'];
      let ok = true;
      if (!ADDR.test(addr)) {
        rowProblem(addr, 'malformed-address', `${name}.${list}: address ${addr} is not 0x plus eight upper-case hex digits`);
        ok = false;
      }
      if (seen.has(addr)) {
        rowProblem(addr, 'duplicate-address', `${name}.${list}: ${addr} listed twice`);
        ok = false;
      }
      seen.add(addr);
      const category = row['category'];
      if (typeof category !== 'string' || !isExceptionCategory(category)) {
        rowProblem(addr, 'unknown-category', `${name}.${list}: ${addr} has unknown category ${String(category)}`);
        continue;
      }
      const note = row['note'];
      if (typeof note !== 'string') {
        rowProblem(addr, 'missing-field', `${name}.${list}: ${addr} has no 'note' string`);
        continue;
      }
      const rowName = row['name'];
      if (list === 'labels') {
        if (typeof rowName !== 'string' || rowName === '') {
          rowProblem(addr, 'missing-field', `${name}.labels: ${addr} has no 'name' string`);
          continue;
        }
        if (ok) lists.labels.push({ addr, name: rowName, category, note });
      } else {
        if (rowName !== undefined && typeof rowName !== 'string') {
          rowProblem(addr, 'missing-field', `${name}.untyped: ${addr} has a 'name' that is not a string`);
          continue;
        }
        if (ok) lists.untyped.push({ addr, ...(rowName === undefined ? {} : { name: rowName }), category, note });
      }
    }
  }
  if (problems.length > 0 || typeof heldout !== 'boolean') return { problems };
  const { name: n, rom, elf, sha1, elfCommit, elfSha256, family, buildNote } = fields;
  if (n === undefined || rom === undefined || elf === undefined || sha1 === undefined || elfCommit === undefined || elfSha256 === undefined || family === undefined || buildNote === undefined) {
    return { problems };
  }
  const dataset: Dataset = {
    name: n,
    rom,
    elf,
    ...(fields.map === undefined ? {} : { map: fields.map }),
    sha1,
    elfCommit,
    elfSha256,
    ...(fields.objectsDir === undefined ? {} : { objectsDir: fields.objectsDir }),
    ...(fields.objectsDigest === undefined ? {} : { objectsDigest: fields.objectsDigest }),
    family,
    buildNote,
    heldout,
    revealed: reveals,
    labels: lists.labels,
    untyped: lists.untyped,
  };
  return { dataset, problems };
}

export interface LoadedDatasets {
  /** Well-formed datasets, sorted by file name. */
  readonly datasets: readonly Dataset[];
  readonly problems: readonly DatasetProblem[];
}

/** Every `*.json` under bench/dataset/real, in code-unit order; nothing else is read (synthetic/ is not). */
export async function loadDatasets(cx: BenchContext): Promise<LoadedDatasets> {
  const dir = datasetDir(cx);
  if (!(await isDirectory(dir))) return { datasets: [], problems: [] };
  const datasets: Dataset[] = [];
  const problems: DatasetProblem[] = [];
  for (const file of await listFiles(dir)) {
    if (file.includes('/') || !file.endsWith('.json')) continue;
    let value: unknown;
    try {
      value = await readJson(join(dir, file));
    } catch (error) {
      problems.push({ dataset: file.replace(/\.json$/, ''), list: 'dataset', addr: '', problem: 'unreadable', detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const parsed = parseDataset(value, `bench/dataset/real/${file}`);
    problems.push(...parsed.problems);
    if (parsed.dataset !== undefined) datasets.push(parsed.dataset);
  }
  return { datasets, problems };
}

/** The tuning datasets (not sealed), optionally only the one named. */
export function tuningDatasets(all: readonly Dataset[], only?: string): Dataset[] {
  return all.filter((d) => !isSealed(d) && (only === undefined || d.name === only));
}
