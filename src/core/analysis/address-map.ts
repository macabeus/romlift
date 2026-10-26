// Load and run addresses (architecture §3.3, §6.7, D46, D91). A byte's load address is where it sits in the ROM;
// its run address is where the CPU executes it. They differ only inside an [[overrides]] range with `runs_at`, which
// a person writes by hand (the trace that would have proposed one was dropped by the owner, D91): the range's load
// span runs from its `runsAt`. Without such an override the map is the identity, the path every result, golden and
// bench row of phases 2 to 4 was measured on.
//
// The map holds sorted, disjoint ranges. A range that overlaps an earlier one (by load start) in load or in run
// space is left out of the map, so toRun and toLoad stay functions; whether such a config is legal is not the
// analysis' question: the model refuses a runs_at range that is not its own module (E_OVERRIDE_INVALID,
// core/model/modules.ts), the one owner of that refusal.
import { ROM_BASE, ROM_MAX_SIZE } from '../../foundation/rom/rom.ts';
import type { Rom, RomBytes } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import type { OverrideFact } from './types.ts';

/** One load span and the run address of its first byte. */
export interface AddressRange {
  readonly load: Span;
  readonly run: Addr;
}

export interface AddressMap {
  /** Sorted, disjoint load ranges with the run address of their first byte. */
  readonly ranges: readonly AddressRange[];
}

/** The map with no range: every address runs where it is loaded. */
const IDENTITY: AddressMap = { ranges: [] };

/** The range of `o` when it is a usable runs_at range (safe integers, a non-empty span), else undefined. */
function runsAtRange(o: OverrideFact): AddressRange | undefined {
  const run = o.runsAt;
  if (run === undefined || !Number.isSafeInteger(run) || run < 0) return undefined;
  const { start, end } = o.span;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end) return undefined;
  return { load: { start, end }, run };
}

function lengthOf(r: AddressRange): number {
  return r.load.end - r.load.start;
}

/** Whether two ranges share a load byte or a run byte. */
function overlaps(a: AddressRange, b: AddressRange): boolean {
  const load = a.load.start < b.load.end && b.load.start < a.load.end;
  const run = a.run < b.run + lengthOf(b) && b.run < a.run + lengthOf(a);
  return load || run;
}

/**
 * The address map of the overrides: one range per override with runsAt, sorted by load start (then end, then run
 * address); a range overlapping one kept before it is left out (see the header). The identity when none sets runsAt.
 */
export function addressMap(overrides: readonly OverrideFact[]): AddressMap {
  const candidates = overrides.flatMap((o) => {
    const r = runsAtRange(o);
    return r === undefined ? [] : [r];
  });
  if (candidates.length === 0) return IDENTITY;
  candidates.sort((a, b) => a.load.start - b.load.start || a.load.end - b.load.end || a.run - b.run);
  const kept: AddressRange[] = [];
  for (const r of candidates) if (!kept.some((k) => overlaps(k, r))) kept.push(r);
  return { ranges: kept };
}

/** The range whose load span holds `load`, or undefined. */
export function rangeAtLoad(m: AddressMap, load: Addr): AddressRange | undefined {
  for (const r of m.ranges) if (load >= r.load.start && load < r.load.end) return r;
  return undefined;
}

/** The range whose run span holds `run`, or undefined. */
function rangeAtRun(m: AddressMap, run: Addr): AddressRange | undefined {
  for (const r of m.ranges) if (run >= r.run && run < r.run + lengthOf(r)) return r;
  return undefined;
}

/** Whether load address `load` runs from another address (it lies in a runs_at range); false on the identity. */
export function runsElsewhere(m: AddressMap, load: Addr): boolean {
  return m.ranges.length !== 0 && rangeAtLoad(m, load) !== undefined;
}

/** The run address of a load address. */
export function toRun(m: AddressMap, load: Addr): Addr {
  if (m.ranges.length === 0) return load;
  const r = rangeAtLoad(m, load);
  return r === undefined ? load : r.run + (load - r.load.start);
}

/** The load address of a run address; undefined when no cartridge byte runs there (a RAM reference). */
export function toLoad(m: AddressMap, run: Addr): Addr | undefined {
  const r = m.ranges.length === 0 ? undefined : rangeAtRun(m, run);
  if (r !== undefined) return r.load.start + (run - r.run);
  return run >= ROM_BASE && run < ROM_BASE + ROM_MAX_SIZE ? run : undefined;
}

/** The ROM's bytes as code inside the runs_at ranges reads them (loadSpaceImage): bounds and bytes, no identity. */
export type LoadSpaceImage = RomBytes;

/** The load-space image of each (map, ROM) pair loadSpaceImage built, so a run builds it once. */
const LOAD_SPACE = new WeakMap<AddressMap, { readonly rom: Rom; readonly image: LoadSpaceImage }>();

/**
 * The ROM as code inside the ranges reads it in load space: each aligned word inside a range's load span whose value
 * is a run address of that range holds its load address instead (a pool word naming a jump table, a table entry naming
 * a case). A reader that compares absolute words with load addresses (a jump-table idiom of the profile) then reads
 * code that runs from RAM as it reads any other code. A byte view with no sha1 or header (architecture-9: rewritten
 * bytes are never a Rom); the ROM's own bytes on the identity map; built once per pair.
 */
export function loadSpaceImage(m: AddressMap, rom: Rom): LoadSpaceImage {
  if (m.ranges.length === 0) return { base: rom.base, bytes: rom.bytes, end: rom.end };
  const cached = LOAD_SPACE.get(m);
  if (cached !== undefined && cached.rom === rom) return cached.image;
  const bytes = rom.bytes.slice();
  const words = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const r of m.ranges) {
    const end = Math.min(r.load.end, rom.end);
    for (let a = (Math.max(r.load.start, rom.base) + 3) & ~3; a + 4 <= end; a += 4) {
      const v = words.getUint32(a - rom.base, true);
      if (v >= r.run && v < r.run + lengthOf(r)) words.setUint32(a - rom.base, r.load.start + (v - r.run), true);
    }
  }
  const image: LoadSpaceImage = { base: rom.base, bytes, end: rom.end };
  LOAD_SPACE.set(m, { rom, image });
  return image;
}
