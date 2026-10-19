// ELF32 little-endian ARM reader (System V gABI, ARM ELF): section headers and every SHT_SYMTAB
// symbol. Ported from the PoC's elf.ts and truth.ts. Every read is bounds-checked, so a truncated or
// corrupt file is an ok:false result, never an exception or a read past the buffer.
import type { Span } from '../rom/span.ts';
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
const SHT_SYMTAB = 2;
const SHT_REL = 9;
const REL_SIZE = 8;
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
      throw new Malformed(`${what} (0x${offset.toString(16)}+0x${length.toString(16)}) lies outside the ${this.bytes.length}-byte file`);
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
    if (offset >= tableEnd - tableStart) throw new Malformed(`${what}: name offset 0x${offset.toString(16)} is outside its string table`);
    const end = this.bytes.subarray(start, tableEnd).indexOf(0);
    if (end < 0) throw new Malformed(`${what}: name at 0x${start.toString(16)} is not NUL-terminated`);
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
    if (table.type !== SHT_SYMTAB) continue;
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
        name: r.cString(strtab.offset, strEnd, r.u32(o), `symbol at 0x${o.toString(16)}`),
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
const NO_FIELD: ReadonlySet<number> = new Set([0, 40]);

/** The bytes the field of an R_ARM_* type covers, where it is not a word (ARM ELF, table 4-8). */
const FIELD_BYTES: Readonly<Record<number, number>> = {
  5: 2, // R_ARM_ABS16
  8: 1, // R_ARM_ABS8
  11: 2, // R_ARM_THM_PC8
  102: 2, // R_ARM_THM_JUMP11
  103: 2, // R_ARM_THM_JUMP8
};

/** The width of an R_ARM_* type's field in bytes: 0 for one that changes no byte, a word unless listed. */
export function relocationWidth(type: number): number {
  return NO_FIELD.has(type) ? 0 : (FIELD_BYTES[type] ?? 4);
}

/**
 * Every SHT_REL relocation of `bytes` (the file `elf` was parsed from) that applies to `section`, in file order;
 * ok:false when a relocation section lies outside the file or its entry size is below 8 bytes.
 */
export function relocationsOf(bytes: Uint8Array, elf: ElfFile, section: ElfSection): ParseResult<readonly ElfRelocation[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ElfRelocation[] = [];
  for (const rel of elf.sections) {
    if (rel.type !== SHT_REL || rel.info !== section.index) continue;
    const size = rel.entsize === 0 ? REL_SIZE : rel.entsize;
    if (size < REL_SIZE || rel.offset + rel.size > bytes.length) return { ok: false, error: `ELF: relocation section ${rel.name} is malformed` };
    for (let at = rel.offset; at + REL_SIZE <= rel.offset + rel.size; at += size) {
      const info = view.getUint32(at + 4, true);
      const type = info & 0xff;
      out.push({ offset: view.getUint32(at, true), type, symbol: info >>> 8, width: relocationWidth(type) });
    }
  }
  return { ok: true, value: out };
}
