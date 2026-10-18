// The reference build's relocatable objects (architecture §8.2 `objectsDir`/`objectsDigest`, §8.4 objdiff,
// D34, D50): their digest, an index from symbol name to the object that defines it, the relocations of one
// object (the objdiff family asks whether a relocation's reference side names a symbol or a section), and
// whether the objects under a directory are the ones the reference map links.
//
// `objectsDigest` is test/gates/gate.ts `objectsDigest` over nodeIo, written again here because the bench
// cannot import test/gates (D37); test/unit/bench/objects.test.ts runs both on one directory and requires
// the same digest.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  compareCodeUnits,
  parseElf,
  sortedKeys,
  type ElfFile,
  type ElfSymbol,
  type ElfSymbolBind,
  type ElfSymbolType,
  type GnuMap,
  type ParseResult,
} from 'romlift';

// ---------------------------------------------------------------------------------------------------
// The digest

/**
 * Every `*.o` under `dir`, as `/`-separated paths relative to it, in code-unit order. Directories are walked
 * by their directory-entry type, so a symbolic link is never followed, as test/gates/gate.ts does.
 */
export async function listObjectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (absolute: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(absolute, entry.name), relative);
      else if (entry.isFile() && entry.name.endsWith('.o')) out.push(relative);
    }
  };
  await walk(dir, '');
  return out.sort(compareCodeUnits);
}

/** sha256 over every `*.o` under `dir`: for each, in code-unit order, its relative path, NUL, then its bytes. */
export async function objectsDigest(dir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await listObjectFiles(dir)) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(join(dir, file)));
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------------------------------
// Symbol to object

/** One definition of a symbol name: the object (relative to the objects directory) and how it binds. */
export interface SymbolDefinition {
  readonly object: string;
  readonly bind: ElfSymbolBind;
  readonly type: ElfSymbolType;
}

/** Which objects define each symbol name. Addresses play no part: an object's symbols are section offsets. */
export interface ObjectSymbolIndex {
  /** Per name, its definitions in code-unit order of the object path. */
  readonly definitions: ReadonlyMap<string, readonly SymbolDefinition[]>;
}

/** The symbols of one object, as `parseElf` lists them (defined symbols only). */
export interface ObjectSymbols {
  readonly object: string;
  readonly symbols: readonly ElfSymbol[];
}

const SHN_LORESERVE = 0xff00;

/**
 * Whether a symbol names code or data the objdiff family can pair: a function, an object or an untyped
 * label in a real section; never a section or file symbol, an ARM mapping symbol (`$a`, `$t`, `$d`), an
 * assembler-local `.L` label, or an absolute or common symbol.
 */
export function isIndexedSymbol(symbol: ElfSymbol): boolean {
  if (symbol.name === '' || symbol.name.startsWith('$') || symbol.name.startsWith('.L')) return false;
  if (symbol.type !== 'func' && symbol.type !== 'object' && symbol.type !== 'notype') return false;
  return symbol.sectionIndex < SHN_LORESERVE;
}

/** The index over `objects`; pure, so a test builds it from hand-made symbol lists. */
export function indexObjectSymbols(objects: readonly ObjectSymbols[]): ObjectSymbolIndex {
  const definitions = new Map<string, SymbolDefinition[]>();
  const sorted = [...objects].sort((a, b) => compareCodeUnits(a.object, b.object));
  for (const { object, symbols } of sorted) {
    const seen = new Set<string>();
    for (const symbol of symbols) {
      if (!isIndexedSymbol(symbol) || seen.has(symbol.name)) continue;
      seen.add(symbol.name);
      const list = definitions.get(symbol.name) ?? [];
      list.push({ object, bind: symbol.bind, type: symbol.type });
      definitions.set(symbol.name, list);
    }
  }
  return { definitions };
}

/**
 * The object that defines `symbol`: the only global or weak definition, or, when no object defines it
 * globally, the only local one. Undefined when nothing defines it or the name is ambiguous (two global
 * definitions, or two static ones and no global).
 */
export function objectFor(index: ObjectSymbolIndex, symbol: string): string | undefined {
  const all = index.definitions.get(symbol) ?? [];
  const global = all.filter((d) => d.bind === 'global');
  if (global.length > 0) return global.length === 1 ? global[0]?.object : undefined;
  const weak = all.filter((d) => d.bind === 'weak');
  if (weak.length > 0) return weak.length === 1 ? weak[0]?.object : undefined;
  return all.length === 1 ? all[0]?.object : undefined;
}

/** Every definition of `symbol`, for a report that names an ambiguous one. */
export function definitionsOf(index: ObjectSymbolIndex, symbol: string): readonly SymbolDefinition[] {
  return index.definitions.get(symbol) ?? [];
}

export interface ReadObjectIndex {
  readonly index: ObjectSymbolIndex;
  /** Objects that are not ARM ELF32 files, with the parser's reason; they define nothing in the index. */
  readonly unreadable: readonly { readonly object: string; readonly error: string }[];
}

/** Reads the symbol table of every object under `objectsDir` and indexes them. */
export async function readObjectSymbolIndex(objectsDir: string): Promise<ReadObjectIndex> {
  const objects: ObjectSymbols[] = [];
  const unreadable: { object: string; error: string }[] = [];
  for (const object of await listObjectFiles(objectsDir)) {
    const parsed = parseElf(new Uint8Array(await readFile(join(objectsDir, object))));
    if (parsed.ok) objects.push({ object, symbols: parsed.value.symbols });
    else unreadable.push({ object, error: parsed.error });
  }
  return { index: indexObjectSymbols(objects), unreadable };
}

// ---------------------------------------------------------------------------------------------------
// Relocations

/** The symbol a relocation refers to. A section symbol is named by its section. */
export interface RelocationSymbol {
  readonly name: string;
  readonly type: ElfSymbolType;
  readonly bind: ElfSymbolBind;
  /** False for an undefined (external) symbol. */
  readonly defined: boolean;
}

/** One entry of a `.rel`/`.rela` section of a relocatable object. */
export interface ObjectRelocation {
  /** The section the relocation applies to, e.g. `.text`. */
  readonly section: string;
  readonly offset: number;
  /** ELF32 ARM relocation type (2 R_ARM_ABS32, 10 R_ARM_THM_CALL, ...). */
  readonly type: number;
  readonly symbol: RelocationSymbol;
}

const SHT_RELA = 4;
const SHT_REL = 9;
const SYMBOL_SIZE = 16;
const SYMBOL_TYPES: readonly ElfSymbolType[] = ['notype', 'object', 'func', 'section', 'file'];
const SYMBOL_BINDS: readonly ElfSymbolBind[] = ['local', 'global', 'weak'];

class Malformed extends Error {}

function relocationSymbol(bytes: Uint8Array, view: DataView, elf: ElfFile, symtabIndex: number, index: number): RelocationSymbol {
  const symtab = elf.sections[symtabIndex];
  if (symtab === undefined) throw new Malformed(`symbol table index ${symtabIndex} is out of range`);
  const strtab = elf.sections[symtab.link];
  if (strtab === undefined) throw new Malformed(`string table index ${symtab.link} is out of range`);
  const entsize = symtab.entsize === 0 ? SYMBOL_SIZE : symtab.entsize;
  const at = symtab.offset + index * entsize;
  if (index * entsize + SYMBOL_SIZE > symtab.size || at + SYMBOL_SIZE > bytes.length) throw new Malformed(`symbol ${index} is outside ${symtab.name}`);
  const info = view.getUint8(at + 12);
  const shndx = view.getUint16(at + 14, true);
  const type = SYMBOL_TYPES[info & 0xf] ?? 'other';
  const bind = SYMBOL_BINDS[info >> 4] ?? 'other';
  const nameOffset = view.getUint32(at, true);
  let name = '';
  if (nameOffset !== 0) {
    if (nameOffset >= strtab.size) throw new Malformed(`symbol ${index}: name offset 0x${nameOffset.toString(16)} is outside its string table`);
    const start = strtab.offset + nameOffset;
    const end = bytes.subarray(start, strtab.offset + strtab.size).indexOf(0);
    if (end < 0) throw new Malformed(`symbol ${index}: name is not NUL-terminated`);
    name = new TextDecoder().decode(bytes.subarray(start, start + end));
  }
  if (type === 'section' && name === '' && shndx < SHN_LORESERVE) name = elf.sections[shndx]?.name ?? '';
  return { name, type, bind, defined: shndx !== 0 };
}

/**
 * The relocations of a relocatable ARM ELF32 object, by section and offset, each with the symbol it
 * refers to. ok:false when the file is not an ARM ELF32 object or a table is out of bounds.
 */
export function objectRelocations(bytes: Uint8Array): ParseResult<readonly ObjectRelocation[]> {
  const parsed = parseElf(bytes);
  if (!parsed.ok) return parsed;
  const elf = parsed.value;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: ObjectRelocation[] = [];
  try {
    for (const table of elf.sections) {
      if (table.type !== SHT_REL && table.type !== SHT_RELA) continue;
      const target = elf.sections[table.info];
      if (target === undefined) throw new Malformed(`${table.name}: target section ${table.info} is out of range`);
      const entsize = table.entsize === 0 ? (table.type === SHT_REL ? 8 : 12) : table.entsize;
      if (table.offset + table.size > bytes.length) throw new Malformed(`${table.name} is outside the file`);
      for (let at = table.offset; at + entsize <= table.offset + table.size; at += entsize) {
        const info = view.getUint32(at + 4, true);
        out.push({
          section: target.name,
          offset: view.getUint32(at, true),
          type: info & 0xff,
          symbol: relocationSymbol(bytes, view, elf, table.link, info >>> 8),
        });
      }
    }
  } catch (error) {
    if (error instanceof Malformed) return { ok: false, error: `ELF relocations: ${error.message}` };
    throw error;
  }
  out.sort((a, b) => compareCodeUnits(a.section, b.section) || a.offset - b.offset);
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------------------------------
// The objects the map links

/** The sections whose sizes say whether an object is the one the map links: code and data, never debug info. */
const COMPARED_SECTION = /^\.(text|rodata|data)/;

/** One relocatable object the map links (not an archive member), with the summed sizes of its compared sections. */
export interface LinkedObject {
  /** The path as ld printed it, relative to the directory ld ran in. */
  readonly file: string;
  readonly sections: ReadonlyMap<string, number>;
}

export interface MapObjects {
  /** In code-unit order of the path. */
  readonly objects: readonly LinkedObject[];
  /** `archive(member)` inputs, which lie outside every objects directory; in code-unit order. */
  readonly archiveMembers: readonly string[];
}

/** The objects a GNU ld map links, from its input-section lines; pure. */
export function mapObjects(map: GnuMap): MapObjects {
  const objects = new Map<string, Map<string, number>>();
  const members = new Set<string>();
  for (const section of map.sections) {
    for (const input of section.inputs) {
      if (input.member !== undefined) {
        members.add(`${input.file}(${input.member})`);
        continue;
      }
      if (!input.file.endsWith('.o')) continue;
      const sizes = objects.get(input.file) ?? new Map<string, number>();
      objects.set(input.file, sizes);
      if (COMPARED_SECTION.test(input.section)) sizes.set(input.section, (sizes.get(input.section) ?? 0) + input.size);
    }
  }
  return {
    objects: sortedKeys(objects).map((file) => ({ file, sections: objects.get(file) ?? new Map<string, number>() })),
    archiveMembers: sortedKeys(members),
  };
}

/**
 * Why `elf` is not the object the map linked as `linked`: each compared section whose size differs from the
 * map's. Empty when they agree.
 */
export function linkedSectionMismatches(linked: LinkedObject, elf: ElfFile): string[] {
  const have = new Map<string, number>();
  for (const s of elf.sections) {
    if (COMPARED_SECTION.test(s.name)) have.set(s.name, (have.get(s.name) ?? 0) + s.size);
  }
  const problems: string[] = [];
  for (const name of sortedKeys(linked.sections)) {
    const want = linked.sections.get(name) ?? 0;
    const size = have.get(name) ?? 0;
    if (size !== want) problems.push(`${linked.file} ${name} is 0x${size.toString(16)} bytes, the map links 0x${want.toString(16)}`);
  }
  return problems;
}
