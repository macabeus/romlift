// The model (architecture §3.4, §6.2, D19, D62): the plain-data result of buildModel, everything a writer,
// a self-check or `model --json` reads. Items are a struct of typed arrays (ItemTable), decoded on demand by
// itemAt (item-table.ts); every other member is plain, deeply readonly data. Addresses are load addresses
// unless a member is named `runAt`; a Label holds the run address, which equals the load address outside a
// runs_at range (D46).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Insn, RawReason, SpecId } from '../../foundation/isa/types.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import type { UnlistedFinding } from '../analysis/types.ts';
import type { BuildCompilerId } from '../config/compilers.ts';
import type { ExtentSource } from '../layout/borders.ts';

// ---------------------------------------------------------------------------------------------------
// Items.

/** The kind code stored in ItemTable.kind. */
export const ItemKind = { insn: 0, rawInsn: 1, pool: 2, tableEntry: 3, padding: 4, data: 5 } as const;
export type ItemKindCode = (typeof ItemKind)[keyof typeof ItemKind];

/** Why an instruction prints raw: the ISA's encoding reasons, plus the model's one (D15, D45). */
export type ItemRawReason = RawReason | 'cross-module-short-branch';

/** The code of each raw reason in ItemTable.aux of a rawInsn item: its index here. */
export const ITEM_RAW_REASONS: readonly ItemRawReason[] = ['undefined', 'unpredictable', 'sbz-set', 'as-alias', 'no-roundtrip', 'cross-module-short-branch'];

/**
 * The note of a `data` item inside an extent: `dead` (claim.dead-code-in-extent), `mixer-hole` (a tiled
 * hole or ARM mixer bytes kept inside the extent, FunctionFact.holes), `unreached` (bytes no walk reached).
 */
export type DataNote = 'dead' | 'mixer-hole' | 'unreached';

/** The code of each note in ItemTable.aux of a data item: its index here plus one; 0 is no note. */
export const DATA_NOTES: readonly DataNote[] = ['dead', 'mixer-hole', 'unreached'];

/** ItemTable.spec of an item that names no isa row. */
export const NO_SPEC = 0xffff;

/**
 * Every item of the model as a struct of arrays (about 17 bytes per item, §9.4). The items tile
 * [rom.base, rom.end) in address order: every ROM byte is in exactly one item (checked by
 * core/verify/tiling.ts).
 */
export interface ItemTable {
  readonly count: number;
  /** ItemKindCode per item. */
  readonly kind: Uint8Array;
  /** Load address per item. */
  readonly start: Uint32Array;
  /** Byte length per item (a data item may span megabytes, hence 32 bits). */
  readonly length: Uint32Array;
  /** The isa row index (item-table.ts specIndex) of an insn or rawInsn item; NO_SPEC otherwise. */
  readonly spec: Uint16Array;
  /**
   * pool: the word's value; tableEntry: the target with bit 0 set when the stored value carries the Thumb
   * bit; rawInsn: the ITEM_RAW_REASONS index; data: the DATA_NOTES index plus one (0: no note); 0 otherwise.
   */
  readonly aux: Uint32Array;
}

/** One item, decoded by itemAt(items, i, rom). `span` is in load addresses; an Insn's addresses are run addresses. */
export type Item =
  | { readonly kind: 'insn'; readonly span: Span; readonly insn: Insn }
  | { readonly kind: 'raw-insn'; readonly span: Span; readonly insn?: Insn; readonly reason: ItemRawReason }
  | { readonly kind: 'pool'; readonly span: Span; readonly value: number }
  | { readonly kind: 'table-entry'; readonly span: Span; readonly target: Addr; readonly thumbBit: boolean }
  /** Zeros up to a word boundary, printed `.align 2, 0` (D16). */
  | { readonly kind: 'padding'; readonly span: Span }
  /** Bytes printed as data; inside an extent they carry a note ('dead' | 'mixer-hole' | 'unreached'). */
  | { readonly kind: 'data'; readonly span: Span; readonly note?: DataNote };

// ---------------------------------------------------------------------------------------------------
// Chunks, modules, labels, functions.

export type ChunkKind = 'header' | 'startup' | 'function' | 'orphan' | 'data';

/** A run of items written as one unit: one file for a function or orphan chunk (§6.2). */
export interface Chunk {
  readonly span: Span;
  readonly kind: ChunkKind;
  readonly name: string;
  /** The mode the chunk opens in; null for header and data chunks. */
  readonly mode: Mode | null;
  readonly module: string;
  /** Its items: indexes [first, first + count) of Model.items. */
  readonly items: { readonly first: number; readonly count: number };
  /** `label = true` entries and second entries inside the chunk, sorted by addr then name. */
  readonly innerLabels: readonly Label[];
  readonly runAt?: Addr;
}

/** A link unit (§6.2, §6.3). Module.dataStart (the phase-5 C data range) lands with ModuleConfig's in phase 5 (D62). */
export interface Module {
  readonly name: string;
  /** Load addresses; modules tile the ROM in order. */
  readonly span: Span;
  readonly kind: 'asm' | 'c' | 'data';
  /** false: its files are never written nor deleted (WritePlanInputs.retained). */
  readonly generated: boolean;
  readonly compiler: BuildCompilerId;
  readonly cflags: readonly string[];
  readonly library?: { readonly name: string; readonly version: string };
  /** Set for a runs_at range: the run address of span.start (§6.7). */
  readonly runAt?: Addr;
  /** Its chunks: indexes [first, first + count) of Model.chunks. */
  readonly chunks: { readonly first: number; readonly count: number };
}

export type LabelKind = 'func' | 'local' | 'pool' | 'table' | 'data';

export interface Label {
  /** The run address; equals the load address outside runs_at. */
  readonly addr: Addr;
  readonly name: string;
  readonly kind: LabelKind;
  /** A Thumb label: `.4byte Name` of a Thumb `func` label links to addr | 1 (resolver.ts wordValueOf). */
  readonly thumb: boolean;
  /** global: referenced from another module; module: visible inside its own module only. */
  readonly scope: 'global' | 'module';
}

/** Where a name came from: romlift's default spelling, or the TOML (with its `from` key, a sourceKey). */
export type NameSource = { readonly kind: 'default' } | { readonly kind: 'toml'; readonly from?: string };

export interface ModelFunction {
  readonly entry: Addr;
  readonly extent: Span;
  readonly mode: Mode;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly runAt?: Addr;
  readonly source: {
    readonly name: NameSource;
    /** analysis: the reading's extent; toml-size: the TOML's size; override: a code override; next-listed: up to the next listed entry. */
    readonly extent: ExtentSource;
  };
}

/** A data or RAM symbol of the TOML's [symbols] (§6.5). */
export interface ModelSymbol {
  readonly addr: Addr;
  readonly name: string;
  readonly size?: number;
}

export interface Model {
  readonly schema: 'romlift/model@1';
  readonly rom: { readonly sha1: string; readonly end: Addr };
  readonly build: { readonly name: string };
  /** Sorted by entry. */
  readonly functions: readonly ModelFunction[];
  /** In ROM order; they tile the ROM. */
  readonly chunks: readonly Chunk[];
  /** In ROM (link) order. */
  readonly modules: readonly Module[];
  readonly items: ItemTable;
  /** Sorted by addr, then name (code units). */
  readonly labels: readonly Label[];
  /** Sorted by addr, then name. */
  readonly symbols: readonly ModelSymbol[];
  readonly unlisted: readonly UnlistedFinding[];
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------------------------------
// The public JSON contract of `model --json` (D19): NDJSON, one ModelJsonHeader line, then one
// ModelJsonChunk line per chunk in ROM order. Addresses are spelled as the analysis codec spells them:
// '0x' and eight upper-case hex digits. Object keys are canonical (sorted by code unit); optional members
// are left out when absent.

/** '0x' followed by eight upper-case hex digits (foundation/util/hex.ts hexAddr). */
export type HexAddr = string;

export interface ModelJsonSpan {
  readonly start: HexAddr;
  readonly end: HexAddr;
}

export interface ModelJsonModule {
  readonly name: string;
  readonly span: ModelJsonSpan;
  readonly kind: Module['kind'];
  readonly generated: boolean;
  readonly compiler: BuildCompilerId;
  readonly cflags: readonly string[];
  readonly library?: { readonly name: string; readonly version: string };
  readonly runAt?: HexAddr;
  readonly chunks: { readonly first: number; readonly count: number };
}

export interface ModelJsonLabel {
  readonly addr: HexAddr;
  readonly name: string;
  readonly kind: LabelKind;
  readonly thumb: boolean;
  readonly scope: Label['scope'];
}

export interface ModelJsonFunction {
  readonly entry: HexAddr;
  readonly extent: ModelJsonSpan;
  readonly mode: Mode;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly runAt?: HexAddr;
  readonly source: ModelFunction['source'];
}

export interface ModelJsonSymbol {
  readonly addr: HexAddr;
  readonly name: string;
  readonly size?: number;
}

export interface ModelJsonUnlisted {
  readonly entry: HexAddr;
  readonly mode: Mode;
  readonly origin: string;
  readonly provenance: { readonly rule: string; readonly round: number; readonly cites: readonly HexAddr[]; readonly note?: string };
}

export interface ModelJsonDiagnostic {
  readonly code: string;
  readonly severity: Diagnostic['severity'];
  readonly message: string;
  readonly addr?: HexAddr;
  readonly span?: ModelJsonSpan;
  readonly path?: string;
  readonly cites?: readonly HexAddr[];
  readonly rule?: string;
}

/** The first line of `model --json`. */
export interface ModelJsonHeader {
  readonly schema: 'romlift/model-json@1';
  readonly rom: { readonly sha1: string; readonly end: HexAddr };
  readonly build: { readonly name: string };
  readonly modules: readonly ModelJsonModule[];
  readonly functions: readonly ModelJsonFunction[];
  readonly labels: readonly ModelJsonLabel[];
  readonly symbols: readonly ModelJsonSymbol[];
  readonly unlisted: readonly ModelJsonUnlisted[];
  readonly diagnostics: readonly ModelJsonDiagnostic[];
}

/** One item of a chunk line: [ItemKindCode, start, length, the row's SpecId or null, aux] (ItemTable's meaning of aux). */
export type ModelJsonItem = readonly [kind: ItemKindCode, start: HexAddr, length: number, spec: SpecId | null, aux: number];

/** Every line after the header: one chunk with its items inline. */
export interface ModelJsonChunk {
  readonly span: ModelJsonSpan;
  readonly kind: ChunkKind;
  readonly name: string;
  readonly mode: Mode | null;
  readonly module: string;
  readonly innerLabels: readonly ModelJsonLabel[];
  readonly runAt?: HexAddr;
  readonly items: readonly ModelJsonItem[];
}
