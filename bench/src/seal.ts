// The sealed held-out tier (architecture §8.4 "Held-out runs", D25, D53): the counts a sealed run keeps,
// the per-ROM thresholds (the verdict across sealed ROMs and the D60 waiver are
// test/gates/held-out-verdict.ts, which g2.held-out calls), the guard that keeps addresses and names out
// of a sealed entry, the append-only reveal log, `adopt`'s refusal and the shape of a dataset created
// sealed. Pure: plain data in, plain data out; the bench commands do the reading and the printing.

import type { Dataset, Reveal } from './dataset.ts';
import { classifier, classifyFalseEntry, classifyMiss, gluedWhere as whereGlued, type ClassifyInput } from './classify.ts';
import { extentAgrees } from './score.ts';

/** What a sealed run stores and prints for one dataset: counts only (g2.held-out reads exactly this). */
export interface SealedCounts {
  readonly name: string;
  /** Found entries from the end of the startup region. */
  readonly entries: number;
  /** ELF functions from the end of the startup region. */
  readonly elfFunctions: number;
  readonly tp: number;
  readonly glued: number;
  /**
   * Where the glued misses lie, which tells a glued split from code never reached without revealing an
   * address: strictly inside a found function's extent, in no found extent below the run's code end, or
   * at or past the run's code end. The three sum to `glued`. Optional when read from an older artifact.
   */
  readonly gluedWhere?: { readonly insideExtent: number; readonly outsideExtents: number; readonly pastCodeEnd: number };
  readonly labelCandidates: number;
  /**
   * False entries per class; startup ones are outside `entries`, the others count against precision and
   * sum to entries - tp. `other` is optional when read from an artifact written before it was counted.
   */
  readonly falseEntries: {
    readonly startup: number;
    readonly veneer: number;
    readonly adrCallback: number;
    readonly insideElfFunction: number;
    readonly other?: number;
  };
  readonly extents: { readonly sized: number; readonly agree: number };
  /** The run's code end minus the ELF's (the end of its last function). */
  readonly codeEnd: { readonly delta: number };
}

export interface SealedInput extends ClassifyInput {
  readonly name: string;
  /** The code end the run reported. */
  readonly codeEnd: number;
  /** The ELF's code end (truth.ts elfCodeEnd, the convention every ROM is scored with, D60 j). */
  readonly elfCodeEnd: number;
}

/** The counts of one sealed run, scored as score.ts scores a tuning run. */
export function sealedCounts(input: SealedInput): SealedCounts {
  const cx = classifier(input);
  const { startupEnd } = input;
  const elfSize = new Map<number, number>();
  for (const t of input.truth) elfSize.set(t.addr, Math.max(t.size, elfSize.get(t.addr) ?? 0));
  const foundEntries = new Set(input.found.map((f) => f.entry));

  let entries = 0;
  let tp = 0;
  let sized = 0;
  let agree = 0;
  const falseEntries = { startup: 0, veneer: 0, adrCallback: 0, insideElfFunction: 0, other: 0 };
  for (const f of input.found) {
    if (f.entry >= startupEnd) entries++;
    const size = elfSize.get(f.entry);
    if (size === undefined) {
      const kind = classifyFalseEntry(cx, f);
      if (kind === 'startup') falseEntries.startup++;
      else if (kind === 'veneer') falseEntries.veneer++;
      else if (kind === 'adr-callback') falseEntries.adrCallback++;
      else if (kind === 'inside-elf-function') falseEntries.insideElfFunction++;
      else falseEntries.other++;
      continue;
    }
    if (f.entry < startupEnd) continue;
    tp++;
    if (size === 0) continue;
    sized++;
    if (extentAgrees(size, f.extent.end - f.entry)) agree++;
  }

  let elfFunctions = 0;
  let glued = 0;
  let labelCandidates = 0;
  const gluedWhere = { insideExtent: 0, outsideExtents: 0, pastCodeEnd: 0 };
  for (const addr of elfSize.keys()) {
    if (addr < startupEnd) continue;
    elfFunctions++;
    if (foundEntries.has(addr)) continue;
    if (classifyMiss(cx, addr) !== 'glued') {
      labelCandidates++;
      continue;
    }
    glued++;
    const where = whereGlued(cx, addr, input.codeEnd);
    if (where === 'inside-extent') gluedWhere.insideExtent++;
    else if (where === 'past-code-end') gluedWhere.pastCodeEnd++;
    else gluedWhere.outsideExtents++;
  }

  return {
    name: input.name,
    entries,
    elfFunctions,
    tp,
    glued,
    gluedWhere,
    labelCandidates,
    falseEntries,
    extents: { sized, agree },
    codeEnd: { delta: input.codeEnd - input.elfCodeEnd },
  };
}

/** The per-ROM thresholds of architecture §8.4 (D25): the tuning set's floors and maxima. */
export const SEALED_THRESHOLDS = {
  /** Raw precision, tp / entries. */
  minPrecision: 0.997,
  /** Raw recall, tp / ELF functions: Klonoa's 556 of 559, the tuning floor. */
  minRecall: 0.9946,
  maxGlued: 0,
  /** The tuning set's maximum (FE7J). */
  maxLabelCandidates: 11,
  minExtents: 0.999,
  maxCodeEndDelta: 16,
} as const;

export type SealedFailure = 'precision' | 'recall' | 'glued' | 'label-candidates' | 'extents' | 'code-end';

export interface SealedVerdict {
  readonly pass: boolean;
  /** The thresholds the counts miss, in the order of SEALED_THRESHOLDS. */
  readonly failures: readonly SealedFailure[];
}

function share(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

/** Whether one sealed ROM passes; shares of an empty denominator are 0, so an empty run fails. */
export function sealedPasses(counts: SealedCounts): SealedVerdict {
  const t = SEALED_THRESHOLDS;
  const failures: SealedFailure[] = [];
  if (share(counts.tp, counts.entries) < t.minPrecision) failures.push('precision');
  if (share(counts.tp, counts.elfFunctions) < t.minRecall) failures.push('recall');
  if (counts.glued > t.maxGlued) failures.push('glued');
  if (counts.labelCandidates > t.maxLabelCandidates) failures.push('label-candidates');
  if (share(counts.extents.agree, counts.extents.sized) < t.minExtents) failures.push('extents');
  if (Math.abs(counts.codeEnd.delta) > t.maxCodeEndDelta) failures.push('code-end');
  return { pass: failures.length === 0, failures };
}

/** The lowest address of the GBA map (EWRAM): a number this large in a sealed entry is an address, not a count. */
const ADDRESS_SIZED = 0x02000000;

/**
 * Throws unless `value` holds counts only: objects of finite numbers below address size and booleans,
 * with one string, the top-level `name`. Arrays (rows), any other string (an address or a symbol name)
 * and address-sized numbers are rejected; the error names the field, never its value.
 */
export function assertCountsOnly(value: unknown): void {
  const visit = (v: unknown, path: string, top: boolean): void => {
    if (typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Math.abs(v) >= ADDRESS_SIZED) throw new Error(`sealed field ${path} is not a count`);
      return;
    }
    if (typeof v === 'string') {
      if (top && path === 'name') return;
      throw new Error(`sealed field ${path} is a string; a sealed entry holds counts only`);
    }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`sealed field ${path === '' ? '(root)' : path} is not a count or a record of counts`);
    for (const [key, child] of Object.entries(v)) visit(child, path === '' ? key : `${path}.${key}`, path === '');
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('a sealed entry is a record of counts');
  if (typeof (value as Record<string, unknown>)['name'] !== 'string') throw new Error('a sealed entry carries its dataset name');
  visit(value, '', true);
}

/**
 * The dataset with `reveal` appended to its `revealed` log; earlier entries are kept as they are. Throws
 * for a dataset that is not held out or a reveal with an empty field (callers check their arguments).
 */
export function appendReveal(dataset: Dataset, reveal: Reveal): Dataset {
  if (!dataset.heldout) throw new Error(`${dataset.name} is not a held-out dataset; only a held-out dataset is revealed`);
  for (const key of ['at', 'commit', 'reason'] as const) {
    if (reveal[key].trim() === '') throw new Error(`a reveal of ${dataset.name} needs a non-empty '${key}'`);
  }
  return { ...dataset, revealed: [...dataset.revealed, { at: reveal.at, commit: reveal.commit, reason: reveal.reason }] };
}

/** Why `bench adopt` refuses the dataset, or undefined when it may seed its lists: a sealed dataset is never adopted (D25). */
export function adoptRefusal(dataset: Pick<Dataset, 'name' | 'heldout' | 'revealed'>): string | undefined {
  if (dataset.heldout && dataset.revealed.length === 0) {
    return `${dataset.name} is sealed (held out, never revealed): adopt refuses it; reveal it first with bench run --reveal ${dataset.name} --reason <text>, which makes it tuning data`;
  }
  return undefined;
}

export interface SealedDatasetFields {
  readonly name: string;
  readonly rom: string;
  readonly elf: string;
  readonly map: string;
  readonly sha1: string;
  readonly elfCommit: string;
  readonly elfSha256: string;
  readonly family: string;
  readonly buildNote: string;
}

/** A dataset created sealed: held out, never revealed, no lists; keys in the order of the committed datasets. */
export function sealedDataset(f: SealedDatasetFields): Dataset {
  return {
    name: f.name,
    rom: f.rom,
    elf: f.elf,
    map: f.map,
    sha1: f.sha1,
    elfCommit: f.elfCommit,
    elfSha256: f.elfSha256,
    family: f.family,
    buildNote: f.buildNote,
    heldout: true,
    revealed: [],
    labels: [],
    untyped: [],
  };
}
