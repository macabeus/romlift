// ELF32 little-endian ARM reader (System V gABI, ARM ELF): section headers, every SHT_SYMTAB symbol, and the
// SHT_REL and SHT_RELA relocations of a section with their addends (the one REL/RELA addend decoder, with the
// SHT_* and R_ARM_* numbers romlift reads in one place, architecture-r2-2). Ported from the PoC's elf.ts and
// truth.ts. Every read is bounds-checked, so a truncated or corrupt file is an ok:false result, never an exception
// or a read past the buffer.
import type { Span } from '../rom/span.ts';
import { hexSize } from '../util/hex.ts';
import type {
  ElfFile,
  ElfFunction,
  ElfRelocation,
  ElfSection,
  ElfSymbol,
  ElfSymbolBind,
  ElfSymbolType,
  ParseResult,
} from './types.ts';

const EM_ARM = 40;
const ELF_HEADER_SIZE = 52;
const SECTION_HEADER_SIZE = 40;
const SYMBOL_SIZE = 16;

/** The section types the readers know (System V gABI, sh_type). */
export const SHT = { SYMTAB: 2, RELA: 4, NOBITS: 8, REL: 9 } as const;

/** The ARM relocation types romlift reads (ELF for the Arm Architecture, table 4-8). */
export const R_ARM = {
  NONE: 0,
  PC24: 1,
  ABS32: 2,
  REL32: 3,
  ABS16: 5,
  ABS8: 8,
  THM_CALL: 10,
  THM_PC8: 11,
  CALL: 28,
  JUMP24: 29,
  V4BX: 40,
  THM_JUMP11: 102,
  THM_JUMP8: 103,
} as const;

/** The R_ARM_* types whose field is a branch offset: the target is the symbol plus the addend, from the place. */
export const R_ARM_BRANCHES: ReadonlySet<number> = new Set([R_ARM.PC24, R_ARM.THM_CALL, R_ARM.CALL, R_ARM.JUMP24, R_ARM.THM_JUMP11, R_ARM.THM_JUMP8]);

const REL_SIZE = 8;
const RELA_SIZE = 12;
const SHN_UNDEF = 0;
const SHN_LORESERVE = 0xff00;
const SHN_XINDEX = 0xffff;

const SYMBOL_TYPES: Readonly<Record<number, ElfSymbolType>> = { 0: 'notype', 1: 'object', 2: 'func', 3: 'section', 4: 'file' };
const SYMBOL_BINDS: Readonly<Record<number, ElfSymbolBind>> = { 0: 'local', 1: 'global', 2: 'weak' };

const utf8 = new TextDecoder('utf-8');

/** Thrown only inside this file and turned into ok:false by parseElf. */
class Malformed extends Error {}

class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(offset: number, length: number, what: string): void {
    if (!(offset >= 0 && length >= 0 && offset + length <= this.bytes.length)) {
      throw new Malformed(`${what} (${hexSize(offset)}+${hexSize(length)}) lies outside the ${this.bytes.length}-byte file`);
    }
  }

  u8(offset: number): number {
    this.need(offset, 1, 'a byte');
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    this.need(offset, 2, 'a halfword');
    return this.view.getUint16(offset, true);
  }

  u32(offset: number): number {
    this.need(offset, 4, 'a word');
    return this.view.getUint32(offset, true);
  }

  /** The NUL-terminated string at `offset` inside the table [tableStart, tableEnd). */
  cString(tableStart: number, tableEnd: number, offset: number, what: string): string {
    const start = tableStart + offset;
    if (offset >= tableEnd - tableStart) throw new Malformed(`${what}: name offset ${hexSize(offset)} is outside its string table`);
    const end = this.bytes.subarray(start, tableEnd).indexOf(0);
    if (end < 0) throw new Malformed(`${what}: name at ${hexSize(start)} is not NUL-terminated`);
    return utf8.decode(this.bytes.subarray(start, start + end));
  }
}

interface RawSection {
  readonly type: number;
  readonly flags: number;
  readonly addr: number;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
  readonly info: number;
  readonly entsize: number;
  readonly nameOffset: number;
}

function readHeaderIdent(r: Reader): void {
  if (r.bytes.length < 16) throw new Malformed('shorter than the ELF identification');
  if (r.u8(0) !== 0x7f || r.u8(1) !== 0x45 || r.u8(2) !== 0x4c || r.u8(3) !== 0x46) throw new Malformed('not an ELF file');
  if (r.u8(4) !== 1) throw new Malformed('not an ELF32 file');
  if (r.u8(5) !== 1) throw new Malformed('not a little-endian ELF file');
  if (r.bytes.length < ELF_HEADER_SIZE) throw new Malformed('shorter than the ELF32 header');
}

function readRawSections(r: Reader): RawSection[] {
  const shoff = r.u32(0x20);
  const shentsize = r.u16(0x2e);
  let shnum = r.u16(0x30);
  if (shoff === 0) return [];
  if (shentsize < SECTION_HEADER_SIZE) throw new Malformed(`section header size ${shentsize} is below ${SECTION_HEADER_SIZE}`);
  if (shnum === 0) shnum = r.u32(shoff + 0x14); // extended numbering: the count is section 0's sh_size
  r.need(shoff, shnum * shentsize, 'the section header table');
  const sections: RawSection[] = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    sections.push({
      nameOffset: r.u32(o),
      type: r.u32(o + 4),
      flags: r.u32(o + 8),
      addr: r.u32(o + 0x0c),
      offset: r.u32(o + 0x10),
      size: r.u32(o + 0x14),
      link: r.u32(o + 0x18),
      info: r.u32(o + 0x1c),
      entsize: r.u32(o + 0x24),
    });
  }
  return sections;
}

function sectionNames(r: Reader, raw: readonly RawSection[]): ElfSection[] {
  if (raw.length === 0) return [];
  let shstrndx = r.u16(0x32);
  if (shstrndx === SHN_XINDEX) shstrndx = raw[0]?.link ?? SHN_UNDEF;
  const strtab = shstrndx === SHN_UNDEF ? undefined : raw[shstrndx];
  if (shstrndx !== SHN_UNDEF && strtab === undefined) throw new Malformed(`section name table index ${shstrndx} is out of range`);
  if (strtab !== undefined) r.need(strtab.offset, strtab.size, 'the section name table');
  return raw.map((s, index) => ({
    index,
    name: strtab === undefined ? '' : r.cString(strtab.offset, strtab.offset + strtab.size, s.nameOffset, `section ${index}`),
    type: s.type,
    flags: s.flags,
    addr: s.addr,
    offset: s.offset,
    size: s.size,
    link: s.link,
    info: s.info,
    entsize: s.entsize,
  }));
}

function readSymbols(r: Reader, sections: readonly ElfSection[]): ElfSymbol[] {
  const symbols: ElfSymbol[] = [];
  for (const table of sections) {
    if (table.type !== SHT.SYMTAB) continue;
    const entsize = table.entsize === 0 ? SYMBOL_SIZE : table.entsize;
    if (entsize < SYMBOL_SIZE) throw new Malformed(`symbol table ${table.name}: entry size ${entsize} is below ${SYMBOL_SIZE}`);
    r.need(table.offset, table.size, `symbol table ${table.name}`);
    const strtab = sections[table.link];
    if (strtab === undefined) throw new Malformed(`symbol table ${table.name}: string table index ${table.link} is out of range`);
    r.need(strtab.offset, strtab.size, `string table ${strtab.name}`);
    const strEnd = strtab.offset + strtab.size;
    for (let o = table.offset; o + SYMBOL_SIZE <= table.offset + table.size; o += entsize) {
      const shndx = r.u16(o + 14);
      if (shndx === SHN_UNDEF) continue;
      const info = r.u8(o + 12);
      const value = r.u32(o + 4);
      const type = SYMBOL_TYPES[info & 0xf] ?? 'other';
      const func = type === 'func';
      const sectionName = shndx < SHN_LORESERVE ? sections[shndx]?.name : undefined;
      symbols.push({
        name: r.cString(strtab.offset, strEnd, r.u32(o), `symbol at ${hexSize(o)}`),
        value,
        addr: func ? (value & ~1) >>> 0 : value,
        size: r.u32(o + 8),
        type,
        bind: SYMBOL_BINDS[info >> 4] ?? 'other',
        thumb: func && (value & 1) === 1,
        sectionIndex: shndx,
        ...(sectionName === undefined ? {} : { sectionName }),
      });
    }
  }
  return symbols;
}

/** Sections and defined symbols of an ELF32 little-endian ARM file; ok:false for anything else. */
export function parseElf(bytes: Uint8Array): ParseResult<ElfFile> {
  const r = new Reader(bytes);
  try {
    readHeaderIdent(r);
    const machine = r.u16(0x12);
    if (machine !== EM_ARM) throw new Malformed(`machine ${machine} is not ARM (${EM_ARM})`);
    const entry = r.u32(0x18);
    const sections = sectionNames(r, readRawSections(r));
    return { ok: true, value: { machine, entry, sections, symbols: readSymbols(r, sections) } };
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, error: `ELF: ${error.message}` };
    throw error;
  }
}

/** The order elfFunctions lists functions in. */
export type ElfFunctionOrder = 'address' | 'symbol-table';

/**
 * The functions of an ELF inside `within` (a half-open address span, usually the ROM): func symbols
 * merged by address, keeping the first name and the largest size (the PoC's readElfFunctions), in
 * address order, or with `order: 'symbol-table'` in the symbol-table order of each address's first
 * symbol (the order the PoC names the owner of a false entry by).
 */
export function elfFunctions(elf: ElfFile, within: Span, order: ElfFunctionOrder = 'address'): readonly ElfFunction[] {
  const byAddr = new Map<number, ElfFunction>();
  const firstSeen: number[] = [];
  for (const s of elf.symbols) {
    if (s.type !== 'func' || s.addr < within.start || s.addr >= within.end) continue;
    const have = byAddr.get(s.addr);
    if (have === undefined) {
      firstSeen.push(s.addr);
      byAddr.set(s.addr, { addr: s.addr, size: s.size, name: s.name, thumb: s.thumb });
    } else if (s.size > have.size) byAddr.set(s.addr, { ...have, size: s.size });
  }
  const addrs = order === 'address' ? [...firstSeen].sort((a, b) => a - b) : firstSeen;
  return addrs.flatMap((a) => {
    const f = byAddr.get(a);
    return f === undefined ? [] : [f];
  });
}

/** R_ARM_* types that change no byte of their section (ARM ELF, 4.6.1.2): R_ARM_NONE and R_ARM_V4BX. */
const NO_FIELD: ReadonlySet<number> = new Set([R_ARM.NONE, R_ARM.V4BX]);

/** The bytes the field of an R_ARM_* type covers, where it is not a word (ARM ELF, table 4-8). */
const FIELD_BYTES: Readonly<Record<number, number>> = {
  [R_ARM.ABS16]: 2,
  [R_ARM.ABS8]: 1,
  [R_ARM.THM_PC8]: 2,
  [R_ARM.THM_JUMP11]: 2,
  [R_ARM.THM_JUMP8]: 2,
};

/** The width of an R_ARM_* type's field in bytes: 0 for one that changes no byte, a word unless listed. */
export function relocationWidth(type: number): number {
  return NO_FIELD.has(type) ? 0 : (FIELD_BYTES[type] ?? 4);
}

/**
 * The implicit addend of an ARM REL relocation of `type` whose field starts at byte `at` of `view` (ELF for the
 * Arm Architecture, "Addends and PC-bias compensation"): the signed word of R_ARM_ABS32 and R_ARM_REL32, the
 * halfword and byte of R_ARM_ABS16 and R_ARM_ABS8, the branch offset of R_ARM_THM_CALL (a Thumb bl pair, 23
 * bits), R_ARM_PC24, R_ARM_CALL and R_ARM_JUMP24 (24 bits, words), R_ARM_THM_JUMP11 and R_ARM_THM_JUMP8; undefined
 * for any other type, and when the field does not fit the view.
 */
export function implicitAddend(type: number, view: DataView, at: number): number | undefined {
  const width = relocationWidth(type);
  if (at < 0 || width === 0 || at + width > view.byteLength) return undefined;
  switch (type) {
    case R_ARM.ABS32:
    case R_ARM.REL32:
      return view.getInt32(at, true);
    case R_ARM.ABS16:
      return view.getInt16(at, true);
    case R_ARM.ABS8:
      return view.getInt8(at);
    case R_ARM.THM_CALL: {
      const offset = ((view.getUint16(at, true) & 0x7ff) << 12) | ((view.getUint16(at + 2, true) & 0x7ff) << 1);
      return (offset << 9) >> 9;
    }
    case R_ARM.PC24:
    case R_ARM.CALL:
    case R_ARM.JUMP24:
      return ((view.getUint32(at, true) & 0xff_ffff) << 8) >> 6;
    case R_ARM.THM_JUMP11:
      return ((view.getUint16(at, true) & 0x7ff) << 21) >> 20;
    case R_ARM.THM_JUMP8:
      return ((view.getUint16(at, true) & 0xff) << 24) >> 23;
    default:
      return undefined;
  }
}

/**
 * Every SHT_REL and SHT_RELA relocation of `bytes` (the file `elf` was parsed from) that applies to `section`, in file
 * order, each with its addend: a RELA entry's own, a REL entry's implicit one read from the field it relocates
 * (implicitAddend; absent for a type it does not decode, a NOBITS section or a field outside the section's bytes).
 * ok:false when a relocation section lies outside the file or its entry size is below its entry's 8 or 12 bytes.
 */
export function relocationsOf(bytes: Uint8Array, elf: ElfFile, section: ElfSection): ParseResult<readonly ElfRelocation[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inFile = section.type !== SHT.NOBITS && section.offset + section.size <= bytes.length;
  const fieldView = inFile ? new DataView(bytes.buffer, bytes.byteOffset + section.offset, section.size) : undefined;
  const out: ElfRelocation[] = [];
  for (const rel of elf.sections) {
    if ((rel.type !== SHT.REL && rel.type !== SHT.RELA) || rel.info !== section.index) continue;
    const min = rel.type === SHT.RELA ? RELA_SIZE : REL_SIZE;
    const size = rel.entsize === 0 ? min : rel.entsize;
    if (size < min || rel.offset + rel.size > bytes.length) return { ok: false, error: `ELF: relocation section ${rel.name} is malformed` };
    for (let at = rel.offset; at + min <= rel.offset + rel.size; at += size) {
      const offset = view.getUint32(at, true);
      const info = view.getUint32(at + 4, true);
      const type = info & 0xff;
      const addend = rel.type === SHT.RELA ? view.getInt32(at + 8, true) : fieldView === undefined ? undefined : implicitAddend(type, fieldView, offset);
      out.push({ offset, type, symbol: info >>> 8, width: relocationWidth(type), ...(addend === undefined ? {} : { addend }) });
    }
  }
  return { ok: true, value: out };
}
