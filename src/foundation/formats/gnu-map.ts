// Parser of the "Linker script and memory map" part of a GNU ld -Map file: output sections, their
// input sections (with archive members), the symbols ld lists under each input, and the LOAD lines.
// Fill, pattern, PROVIDE, ASSERT and assignment lines are skipped. The line shapes (ld 2.x):
//
//   .text           0x08000000       0x20                    output section (column 0)
//   .data           0x03000000        0x4 load address 0x08000028
//   ewram                                                    a long or empty name alone, then
//                   0x02000000    0x40000                    its address and size on the next line
//    tiny.o(.text)                                           a pattern: skipped
//    .text          0x08000000       0x18 tiny.o             input section (indented)
//    .rodata.a_long_section_name                             a long name alone, then
//                   0x08000020        0x8 tiny.o             its address, size and file on the next line
//                   0x08000008                thumb_one      a symbol of the input above
//                   0x08000020                        . = ALIGN (0x10)    an assignment: skipped
//    *fill*         0x0800001c        0x4                    skipped
//   LOAD tiny.o
//
// An output section ld printed without an address (empty, or /DISCARD/) is not reported, and lines
// under it are dropped. Never throws: text without the map part is an ok:false result.
import type { GnuMap, GnuMapInput, GnuMapSection, GnuMapSymbol, ParseResult } from './types.ts';

const START_MARKER = 'Linker script and memory map';
const END_MARKER = 'Cross Reference Table';

/** A column-0 output section, with its address and size when they fit on the line. */
const OUTPUT_LINE = /^(\S+)(?:\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)(?:\s+(\S.*?))?)?\s*$/;
/** An indented input section, with its address, size and file when they fit on the line. */
const INPUT_LINE = /^\s+(\S+)(?:\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)(?:\s+(\S.*?))?)?\s*$/;
/** The second line of a wrapped section: address, size and the rest (a file or a load address). */
const CONTINUATION_LINE = /^\s+0x([0-9a-fA-F]+)\s+0x([0-9a-fA-F]+)(?:\s+(\S.*?))?\s*$/;
/** A symbol ld lists under an input section: an address and one name. */
const SYMBOL_LINE = /^\s+0x([0-9a-fA-F]+)\s+(\S+)\s*$/;
const LOAD_ADDRESS = /^load address 0x([0-9a-fA-F]+)$/;
const LOAD_LINE = /^LOAD\s+(\S.*?)\s*$/;
const ARCHIVE_MEMBER = /^(.+)\(([^()]+)\)$/;

interface InputBuilder {
  readonly section: string;
  readonly address: number;
  readonly size: number;
  readonly file: string;
  readonly member?: string;
  readonly symbols: GnuMapSymbol[];
}

interface SectionBuilder {
  readonly name: string;
  readonly address: number;
  readonly size: number;
  readonly loadAddress?: number;
  readonly inputs: InputBuilder[];
}

type Pending = { readonly kind: 'none' } | { readonly kind: 'output' | 'input'; readonly name: string };

const NONE: Pending = { kind: 'none' };

function hexValue(digits: string): number {
  return Number.parseInt(digits, 16);
}

function makeSection(name: string, address: string, size: string, rest: string | undefined): SectionBuilder {
  const load = rest === undefined ? undefined : LOAD_ADDRESS.exec(rest)?.[1];
  return {
    name,
    address: hexValue(address),
    size: hexValue(size),
    ...(load === undefined ? {} : { loadAddress: hexValue(load) }),
    inputs: [],
  };
}

function makeInput(section: string, address: string, size: string, file: string | undefined): InputBuilder {
  const member = file === undefined ? undefined : ARCHIVE_MEMBER.exec(file);
  const archive = member?.[1];
  const memberName = member?.[2];
  return {
    section,
    address: hexValue(address),
    size: hexValue(size),
    file: archive ?? file ?? '',
    ...(memberName === undefined ? {} : { member: memberName }),
    symbols: [],
  };
}

/** Whether an indented first token is a fill, a pattern or a PROVIDE marker rather than a section name. */
function isSkippedToken(token: string): boolean {
  return token.startsWith('*') || token.startsWith('[') || token.startsWith('0x') || token.includes('(');
}

class MapBuilder {
  readonly sections: SectionBuilder[] = [];
  readonly loads: string[] = [];
  section: SectionBuilder | undefined = undefined;
  input: InputBuilder | undefined = undefined;
  pending: Pending = NONE;

  openSection(section: SectionBuilder | undefined): void {
    this.section = section;
    this.input = undefined;
    if (section !== undefined) this.sections.push(section);
  }

  openInput(input: InputBuilder): void {
    this.input = input;
    this.section?.inputs.push(input);
  }

  /** A line that starts in column 0: an output section, LOAD, or another top-level command. */
  topLevel(line: string): void {
    this.pending = NONE;
    const load = LOAD_LINE.exec(line);
    if (load?.[1] !== undefined) {
      this.loads.push(load[1]);
      this.openSection(undefined);
      return;
    }
    const m = OUTPUT_LINE.exec(line);
    const name = m?.[1];
    if (m === null || name === undefined || name.includes('(')) {
      this.openSection(undefined); // OUTPUT(...), START GROUP, END GROUP and the like
      return;
    }
    if (m[2] !== undefined && m[3] !== undefined) {
      this.openSection(makeSection(name, m[2], m[3], m[4]));
    } else {
      this.openSection(undefined);
      this.pending = { kind: 'output', name };
    }
  }

  /** An indented line whose first token is an address: a wrapped section's second line, a symbol, or an assignment. */
  addressLine(line: string): void {
    const pending = this.pending;
    this.pending = NONE;
    const c = CONTINUATION_LINE.exec(line);
    if (c?.[1] !== undefined && c[2] !== undefined) {
      if (pending.kind === 'output') this.openSection(makeSection(pending.name, c[1], c[2], c[3]));
      else if (pending.kind === 'input') this.openInput(makeInput(pending.name, c[1], c[2], c[3]));
      return;
    }
    const s = SYMBOL_LINE.exec(line);
    if (s?.[1] !== undefined && s[2] !== undefined) {
      this.input?.symbols.push({ name: s[2], address: hexValue(s[1]) });
    }
  }

  /** Any other indented line: an input section, a wrapped input section's name, a fill or a pattern. */
  inputLine(line: string): void {
    this.pending = NONE;
    const m = INPUT_LINE.exec(line);
    const name = m?.[1];
    if (m === null || name === undefined || isSkippedToken(name)) return;
    if (m[2] !== undefined && m[3] !== undefined) this.openInput(makeInput(name, m[2], m[3], m[4]));
    else this.pending = { kind: 'input', name };
  }

  line(line: string): void {
    if (line.trim() === '') {
      this.pending = NONE;
    } else if (!/^\s/.test(line)) {
      this.topLevel(line);
    } else if (/^\s+0x/.test(line)) {
      this.addressLine(line);
    } else {
      this.inputLine(line);
    }
  }

  build(): GnuMap {
    const sections: GnuMapSection[] = this.sections.map((s) => ({
      ...s,
      inputs: s.inputs.map((i): GnuMapInput => ({ ...i, symbols: [...i.symbols] })),
    }));
    return { sections, loads: [...this.loads] };
  }
}

/** The output sections, input sections, symbols and LOAD lines of a GNU ld map file. */
export function parseGnuMap(text: string): ParseResult<GnuMap> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === START_MARKER);
  if (start < 0) return { ok: false, error: `GNU map: no "${START_MARKER}" line` };
  const builder = new MapBuilder();
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trimEnd() === END_MARKER) break;
    builder.line(line);
  }
  return { ok: true, value: builder.build() };
}
