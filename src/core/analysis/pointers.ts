// The pointer index (the PoC constructor's dataRefs, architecture §9.3): every word-aligned ROM word v
// that is a Thumb pointer (v odd) to a word-aligned ROM address v - 1, as compressed rows from the target
// to the ROM offsets of the words that point at it, ascending.
//
// Inside a runs_at range (address-map.ts, §6.7) code is named by its run address: a pool word equal to a run address
// inside a range, plus the Thumb bit, points at the code loaded there (thumbPointerTarget maps it to that load
// address), and a word equal to a load address inside a range is the copy's source, never an entry. The index stays
// the ROM's own words at their values; the rules that read it leave out the targets inside a range.
import { csrFromPairs, csrHas, csrRow } from '../../foundation/util/csr.ts';
import type { Csr } from '../../foundation/util/csr.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { runsElsewhere, toLoad } from './address-map.ts';
import type { AddressMap } from './address-map.ts';

/** Target bus address -> ROM offsets of the words that hold target | 1. */
export type PointerIndex = Csr;

/** Whether the word `v` is a Thumb pointer to a word-aligned address inside `rom`. */
export function isThumbPointer(rom: Rom, v: number): boolean {
  const t = v - 1;
  return (v & 1) === 1 && t >= ROM_BASE && t < rom.end && (t & 3) === 0;
}

/**
 * The load address of the Thumb function the word `v` points at, under the address map: inside a runs_at range by its
 * run address (v - 1 in the range's run span, mapped to its load address, which must be word-aligned as isThumbPointer
 * requires); never at a load address inside a range (the copy's source); else isThumbPointer's target. Undefined when
 * `v` is no such pointer. On the identity map it is exactly isThumbPointer.
 */
export function thumbPointerTarget(rom: Rom, m: AddressMap, v: number): Addr | undefined {
  if (m.ranges.length === 0) return isThumbPointer(rom, v) ? v - 1 : undefined;
  const run = v - 1;
  if ((v & 1) !== 1 || runsElsewhere(m, run)) return undefined;
  const load = toLoad(m, run);
  return load !== undefined && load >= ROM_BASE && load < rom.end && (load & 3) === 0 ? load : undefined;
}

/** Scans every aligned word of the ROM. */
export function buildPointerIndex(rom: Rom): PointerIndex {
  const b = rom.bytes;
  const words = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const targets: number[] = [];
  const offsets: number[] = [];
  for (let off = 0; off + 4 <= b.length; off += 4) {
    const v = words.getUint32(off, true);
    if (isThumbPointer(rom, v)) {
      targets.push(v - 1);
      offsets.push(off);
    }
  }
  return csrFromPairs(targets, offsets);
}

/** The ROM offsets of the words pointing at `target`, ascending. */
export function pointersTo(index: PointerIndex, target: Addr): Uint32Array {
  return csrRow(index, target);
}

/** Whether any word points at `target`. */
export function isPointedAt(index: PointerIndex, target: Addr): boolean {
  return csrHas(index, target);
}

/** Every target, ascending. */
export function pointerTargets(index: PointerIndex): Uint32Array {
  return index.keys;
}
