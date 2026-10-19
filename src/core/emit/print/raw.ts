// The raw printer's body (architecture §5 "Raw printer", D62): the proof of concept's rawLines
// (romlift-poc src/emit.ts), ported rule for rule, so `--printer raw` keeps the PoC's all-data emission as
// the bisection baseline and wave 3 can compare the two outputs line for line.
//
// The rules, in the PoC's order at each address `a` of [start, end):
//   - a label strictly inside the range flushes the pending run and prints `name: @ ADDR[, note]`;
//   - a word-aligned pool or table-entry word that fits the range and is not cut by a label at a + 2 prints
//     `\t.4byte 0xXXXXXXXX`;
//   - otherwise a halfword joins the pending `\t.2byte 0xXXXX, ...` run, flushed at 8 values and before a
//     label at a + 2;
//   - an odd last byte prints `\t.byte 0xXX`.
// Upper-case hex throughout, as the PoC. Labels at `start` or outside the range are not printed (the caller
// prints the chunk's own label); two labels at one address keep the later one, as the PoC's Map does.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { u16, u32, u8 } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';

/** A label the raw printer places inside a range, with the PoC's optional note. */
export interface RawLabel {
  readonly addr: Addr;
  readonly name: string;
  readonly note?: string;
}

/** The most halfwords one `.2byte` line holds. */
const RUN_LENGTH = 8;

/**
 * The bytes of [start, end) as data lines, exactly as the PoC's rawLines prints them. `isWord(a)` says
 * whether the byte at `a` belongs to a pool word or a table entry.
 */
export function printRawRange(rom: Rom, isWord: (addr: Addr) => boolean, start: Addr, end: Addr, labels: readonly RawLabel[]): readonly string[] {
  const out: string[] = [];
  const marks = new Map<Addr, RawLabel>(labels.filter((l) => l.addr > start && l.addr < end).map((l) => [l.addr, l] as const));
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      out.push(`\t.2byte ${run.join(', ')}`);
      run = [];
    }
  };
  let a = start;
  while (a < end) {
    const mark = marks.get(a);
    if (mark !== undefined) {
      flush();
      out.push(`${mark.name}: @ ${hex(a)}${mark.note === undefined || mark.note === '' ? '' : `, ${mark.note}`}`);
    }
    const wordOk = (a & 3) === 0 && a + 4 <= end && !marks.has(a + 2);
    if (wordOk && isWord(a)) {
      flush();
      out.push(`\t.4byte 0x${hex(u32(rom, a))}`);
      a += 4;
    } else if (a + 2 <= end) {
      run.push(`0x${hex(u16(rom, a), 4)}`);
      if (run.length === RUN_LENGTH || marks.has(a + 2)) flush();
      a += 2;
    } else {
      flush();
      out.push(`\t.byte 0x${hex(u8(rom, a), 2)}`);
      a += 1;
    }
  }
  flush();
  return out;
}
