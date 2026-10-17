// The pointer index (the PoC constructor's dataRefs, architecture §9.3): every word-aligned ROM word v
// that is a Thumb pointer (v odd) to a word-aligned ROM address v - 1, as compressed rows from the target
// to the ROM offsets of the words that point at it, ascending.
import { csrFromPairs, csrHas, csrRow } from '../../foundation/util/csr.ts';
import type { Csr } from '../../foundation/util/csr.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';

/** Target bus address -> ROM offsets of the words that hold target | 1. */
export type PointerIndex = Csr;

/** Whether the word `v` is a Thumb pointer to a word-aligned address inside `rom`. */
export function isThumbPointer(rom: Rom, v: number): boolean {
  const t = v - 1;
  return (v & 1) === 1 && t >= ROM_BASE && t < rom.end && (t & 3) === 0;
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
