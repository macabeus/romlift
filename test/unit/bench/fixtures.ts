// Builders for the bench tests: in-memory ELF files, datasets, PoC dumps, rows and artifacts, and
// temporary directories. Nothing here is derived from a ROM.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ElfFile, ElfSymbol } from 'romlift';

import type { Results, ResultsMeta } from '../../../bench/src/artifact.ts';
import type { Dataset } from '../../../bench/src/dataset.ts';
import type { BenchRow } from '../../../bench/src/row.ts';
import { SCORED_SCHEMA, type DumpFunction, type ScoredRun } from '../../../bench/src/scored-run.ts';

export interface SymbolSpec {
  readonly name: string;
  readonly value: number;
  readonly size: number;
  readonly type?: ElfSymbol['type'];
}

/** An ELF value holding only the given symbols (func by default; odd values are Thumb). */
export function elfFile(symbols: readonly SymbolSpec[]): ElfFile {
  return {
    machine: 40,
    entry: 0x0800_0000,
    sections: [],
    symbols: symbols.map((s) => {
      const type = s.type ?? 'func';
      const func = type === 'func';
      return {
        name: s.name,
        value: s.value,
        addr: func ? (s.value & ~1) >>> 0 : s.value,
        size: s.size,
        type,
        bind: 'global',
        thumb: func && (s.value & 1) === 1,
        sectionIndex: 1,
      };
    }),
  };
}

export function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    name: 'tiny',
    rom: 'tiny/tiny.gba',
    elf: 'tiny/tiny.elf',
    map: 'tiny/tiny.map',
    sha1: '0'.repeat(40),
    elfCommit: 'abc1234',
    elfSha256: '0'.repeat(64),
    family: 'synthetic',
    buildNote: 'unchanged',
    heldout: false,
    revealed: [],
    labels: [],
    untyped: [],
    ...overrides,
  };
}

export const fn = (entry: string, end: string, origin = 'call', mode: 'thumb' | 'arm' = 'thumb'): DumpFunction => ({ entry, end, origin, mode });

export function dump(overrides: Partial<ScoredRun> = {}): ScoredRun {
  return {
    schema: SCORED_SCHEMA,
    rom: 'tiny',
    sha1: '0'.repeat(40),
    pocSourceDigest: 'p'.repeat(64),
    analysis: { functions: [], startup: { end: '0x08000000', entries: [] }, codeRange: ['0x08000000', '0x08000000'] },
    misses: [],
    digests: ['d'.repeat(64), 'd'.repeat(64)],
    scaffold: { ok: true, summary: 'built' },
    pocRow: {},
    ...overrides,
  };
}

export function row(overrides: Partial<BenchRow> = {}): BenchRow {
  return {
    name: 'tiny',
    sha1: '0'.repeat(40),
    elfCommit: 'abc1234',
    elfFunctions: 10,
    entries: 10,
    startup: { end: '0x08000100', pieces: 2, elfFunctions: 1 },
    thumb: 9,
    arm: 1,
    tp: 10,
    precision: 1,
    recall: 1,
    misses: [],
    falseEntries: [],
    extents: { sized: 10, agree: 10, mismatches: [] },
    codeEnd: { found: '0x08001000', elf: '0x08001000', delta: 0 },
    deterministic: true,
    scaffold: { ok: true },
    ...overrides,
  };
}

export function meta(overrides: Partial<ResultsMeta> = {}): ResultsMeta {
  return {
    commit: null,
    dirty: false,
    sourceDigest: 's'.repeat(64),
    nodeMajor: 24,
    romliftVersion: '0.0.0',
    inputs: { tiny: { sha1: '0'.repeat(40), elfSha256: '0'.repeat(64) }, pocSourceDigest: 'p'.repeat(64) },
    toolchain: { as: 'as 1', ld: 'ld 1', objcopy: 'objcopy 1' },
    families: { tiny: ['code-end', 'entries', 'extents', 'scaffold'] },
    source: 'poc',
    ...overrides,
  };
}

export function results(rows: readonly BenchRow[] = [row()], overrides: Partial<Results> = {}): Results {
  return { meta: meta(), gates: { real: [] }, roms: rows, ...overrides };
}

/** Runs `body` with a fresh temporary directory, removed afterwards. */
export async function withTempDir<T>(prefix: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
