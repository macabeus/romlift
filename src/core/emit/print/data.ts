// Data and padding inside code (architecture §5 "Padding", "Data in code", D16): zero bytes up to a word
// boundary print `.align 2, 0`, so pools stay aligned when a neighbouring C function changes size; any
// other bytes print as `.byte`/`.2byte`/`.4byte` lines, each carrying the note of its item (`@ dead`,
// `@ mixer hole`, `@ unreached`). A run is split into naturally aligned pieces: a leading odd byte, a
// halfword up to the word boundary, words four to a line, then a trailing halfword and byte.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { u16, u32, u8 } from '../../../foundation/rom/rom.ts';
import type { Span } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';
import type { DataNote } from '../../model/types.ts';

/** The comment text of each data note. */
export const DATA_NOTE_TEXT: Readonly<Record<DataNote, string>> = { dead: 'dead', 'mixer-hole': 'mixer hole', unreached: 'unreached' };

/** The most words one `.4byte` line holds. */
const WORDS_PER_LINE = 4;

/** The directive that pads to a word boundary with zeros (D16). */
export const ALIGN_LINE = '\t.align 2, 0';

function withComment(line: string, comment: string | undefined): string {
  return comment === undefined ? line : `${line} @ ${comment}`;
}

/** The bytes of `span` as data lines, each ending with `@ <comment>` when one is given. */
export function dataLines(rom: Rom, span: Span, comment?: string): readonly string[] {
  const out: string[] = [];
  let a = span.start;
  const end = span.end;
  if (a < end && (a & 1) === 1) {
    out.push(withComment(`\t.byte 0x${hex(u8(rom, a), 2)}`, comment));
    a += 1;
  }
  if (a + 2 <= end && (a & 2) === 2) {
    out.push(withComment(`\t.2byte 0x${hex(u16(rom, a), 4)}`, comment));
    a += 2;
  }
  while (a + 4 <= end) {
    const words: string[] = [];
    while (a + 4 <= end && words.length < WORDS_PER_LINE) {
      words.push(`0x${hex(u32(rom, a))}`);
      a += 4;
    }
    out.push(withComment(`\t.4byte ${words.join(', ')}`, comment));
  }
  if (a + 2 <= end) {
    out.push(withComment(`\t.2byte 0x${hex(u16(rom, a), 4)}`, comment));
    a += 2;
  }
  if (a < end) out.push(withComment(`\t.byte 0x${hex(u8(rom, a), 2)}`, comment));
  return out;
}

/** The lines of a data item's bytes `span` with its note. */
export function noteLines(rom: Rom, span: Span, note: DataNote | undefined): readonly string[] {
  return dataLines(rom, span, note === undefined ? undefined : DATA_NOTE_TEXT[note]);
}

/** Whether `span` is zeros that end on a word boundary, less than a word: what `.align 2, 0` reproduces. */
export function isAlignPadding(rom: Rom, span: Span): boolean {
  if (span.end - span.start >= 4 || span.end <= span.start || (span.end & 3) !== 0) return false;
  for (let a = span.start; a < span.end; a++) if (u8(rom, a) !== 0) return false;
  return true;
}

/**
 * A padding item: `.align 2, 0` when its bytes are what that directive emits, else (a model that broke the
 * padding invariant) its bytes as data noted `padding`, so the text still reproduces the ROM.
 */
export function paddingLines(rom: Rom, span: Span): readonly string[] {
  return isAlignPadding(rom, span) ? [ALIGN_LINE] : dataLines(rom, span, 'padding');
}
