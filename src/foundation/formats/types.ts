// The frozen types of the pure file-format parsers (D4): ELF, GNU ld map and canonical JSON.

/** A parser's answer: a value, or why the input is not one. Parsers never throw for content. */
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

// ELF

export type ElfSymbolType = 'func' | 'object' | 'notype' | 'section' | 'file' | 'other';
export type ElfSymbolBind = 'local' | 'global' | 'weak' | 'other';

export interface ElfSection {
  readonly index: number;
  readonly name: string;
  /** sh_type (1 PROGBITS, 2 SYMTAB, 3 STRTAB, 8 NOBITS, ...). */
  readonly type: number;
  readonly flags: number;
  readonly addr: number;
  readonly offset: number;
  readonly size: number;
  readonly link: number;
  readonly info: number;
  readonly entsize: number;
}

/** One SHT_REL entry of an ARM ELF that applies to a section. */
export interface ElfRelocation {
  /** r_offset: the byte offset in the section it applies to. */
  readonly offset: number;
  /** ELF32_R_TYPE(r_info): the R_ARM_* type. */
  readonly type: number;
  /** ELF32_R_SYM(r_info): the symbol table index. */
  readonly symbol: number;
  /** The bytes the relocation's field covers in the section (0 for a type that changes no byte). */
  readonly width: number;
  /** A RELA entry's addend, or a REL entry's implicit one (elf.ts implicitAddend); absent when it cannot be read. */
  readonly addend?: number;
}

export interface ElfSymbol {
  readonly name: string;
  /** The raw st_value. */
  readonly value: number;
  /** `value` with bit 0 cleared for func symbols only; equal to `value` for every other type. */
  readonly addr: number;
  readonly size: number;
  readonly type: ElfSymbolType;
  readonly bind: ElfSymbolBind;
  /** A func symbol whose value is odd. */
  readonly thumb: boolean;
  /** st_shndx (never 0: undefined symbols are not listed). */
  readonly sectionIndex: number;
  /** The name of section `sectionIndex`, when that index names a section of the file. */
  readonly sectionName?: string;
}

export interface ElfFile {
  /** e_machine (40 is ARM). */
  readonly machine: number;
  readonly entry: number;
  readonly sections: readonly ElfSection[];
  /** Defined symbols only (st_shndx != 0) of every SHT_SYMTAB section, in table order. */
  readonly symbols: readonly ElfSymbol[];
}

/** A function of an ELF: its func symbols merged by address (the PoC's truth.ts semantics). */
export interface ElfFunction {
  readonly addr: number;
  /** The largest size among the func symbols at `addr`. */
  readonly size: number;
  /** The name of the first func symbol at `addr`, in table order. */
  readonly name: string;
  readonly thumb: boolean;
}

// GNU ld map

export interface GnuMapSymbol {
  readonly name: string;
  readonly address: number;
}

export interface GnuMapInput {
  readonly section: string;
  readonly address: number;
  readonly size: number;
  /** The input file as ld printed it; for an archive member, the archive's path. */
  readonly file: string;
  /** The archive member, for `lib.a(member.o)`. */
  readonly member?: string;
  readonly symbols: readonly GnuMapSymbol[];
}

export interface GnuMapSection {
  readonly name: string;
  readonly address: number;
  readonly size: number;
  readonly loadAddress?: number;
  readonly inputs: readonly GnuMapInput[];
}

export interface GnuMap {
  readonly sections: readonly GnuMapSection[];
  /** The operands of the LOAD lines, in order. */
  readonly loads: readonly string[];
}

// Canonical JSON

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };
