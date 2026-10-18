// The emission stream's data (architecture §3.4, §6.3, D17, D62): what a writer yields, the context it
// runs in, the printer's statistics, and the writer contract. Plain data, no closures, except the Writer
// contract itself, which is code (like the analysis rule contracts) and never serialised.
//
// Stream order (frozen): emitTree (core/emit/emit-tree.ts) yields, for each module in ROM order whose
// `generated` is true, the FileEntries of every module-scoped writer for that module, sorted by path (code
// units); then the entries of the global writers (ldscript.txt, symbols.ld), sorted by path. A module whose
// `generated` is false yields nothing (its files are WritePlanInputs.retained). The stream is
// deterministic and re-callable: the check pass and the write pass each run it once (§6.4).
import type { Rom } from '../../foundation/rom/rom.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import type { Model } from '../model/types.ts';

export type WriterId =
  | 'header'
  | 'crt0'
  | 'function'
  | 'orphan'
  | 'module'
  | 'data'
  | 'ldscript'
  | 'symbols'
  | 'modules-mk'
  | 'expected'
  | 'objdiff'
  | 'c-stub'
  | 'scaffold';

/** Every WriterId, in the order of the writers table of §6.3. */
export const WRITER_IDS: readonly WriterId[] = [
  'header',
  'crt0',
  'function',
  'orphan',
  'module',
  'data',
  'ldscript',
  'symbols',
  'modules-mk',
  'c-stub',
  'scaffold',
  'expected',
  'objdiff',
];

/** One edit of a reconciled file, in UTF-16 offsets of its base text. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly reason: 'add-stub' | 'remove-stub' | 'move-stub' | 'rename';
}

/** One file of the tree; `path` is relative to the project root, with '/' separators. */
export type FileEntry =
  | { readonly ownership: 'generated'; readonly path: string; readonly text: string; readonly writer: WriterId }
  | { readonly ownership: 'scaffold'; readonly path: string; readonly text: string; readonly writer: 'scaffold' | 'c-stub' }
  | { readonly ownership: 'reconciled'; readonly path: string; readonly baseSha1: string; readonly edits: readonly TextEdit[] };

/** Names defined in src/*.c, derived by the workflow with the reconciler's tokenizer (phase 5 decides matchings). */
export interface DecompState {
  readonly defined: ReadonlySet<string>;
}

/** readable: mnemonics, labels and directives (§5); raw: the PoC's all-data emission, the bisection baseline. */
export type Printer = 'readable' | 'raw';

export const DEFAULT_PRINTER: Printer = 'readable';

export interface EmitContext {
  readonly decomp: DecompState;
  /** Default DEFAULT_PRINTER ('readable'); `verify --printer raw` passes 'raw'. */
  readonly printer?: Printer;
}

/**
 * What the printer emitted for code items, the readability family's inputs (§8.4). `insns` counts
 * instruction items (insn and rawInsn), `rawInsns` the ones printed raw, with their reasons (ItemRawReason
 * keys); `branches` the b, bcc, bl and blx-immediate instructions of code items, `symbolicBranches` the ones
 * printed to a label; `poolLoads` the PC-relative loads, `symbolicPoolLoads` the ones printed to a label.
 */
export interface PrintStats {
  readonly insns: number;
  readonly rawInsns: number;
  readonly branches: number;
  readonly symbolicBranches: number;
  readonly poolLoads: number;
  readonly symbolicPoolLoads: number;
  readonly rawReasons: Readonly<Record<string, number>>;
}

/** One chunk as printed: its lines (no trailing newlines) and its statistics. */
export interface PrintedChunk {
  readonly lines: readonly string[];
  readonly stats: PrintStats;
}

/** The statistics of nothing printed. */
export function emptyPrintStats(): PrintStats {
  return { insns: 0, rawInsns: 0, branches: 0, symbolicBranches: 0, poolLoads: 0, symbolicPoolLoads: 0, rawReasons: {} };
}

/** The sum of two statistics; rawReasons keys in code-unit order. */
export function addPrintStats(a: PrintStats, b: PrintStats): PrintStats {
  const reasons: Record<string, number> = {};
  const keys = [...Object.keys(a.rawReasons), ...Object.keys(b.rawReasons)].sort(compareCodeUnits);
  for (const key of keys) reasons[key] = (a.rawReasons[key] ?? 0) + (b.rawReasons[key] ?? 0);
  return {
    insns: a.insns + b.insns,
    rawInsns: a.rawInsns + b.rawInsns,
    branches: a.branches + b.branches,
    symbolicBranches: a.symbolicBranches + b.symbolicBranches,
    poolLoads: a.poolLoads + b.poolLoads,
    symbolicPoolLoads: a.symbolicPoolLoads + b.symbolicPoolLoads,
    rawReasons: reasons,
  };
}

/**
 * The writer contract (§6.3). A module-scoped writer is called once per generated module with its index in
 * Model.modules and yields that module's files of its kind (any order: emitTree sorts them); a global writer
 * is called once with `module` null. A writer reads everything from the Model (names, modules, compilers,
 * labels) and the ROM; it never invents a name.
 */
export interface Writer {
  readonly id: WriterId;
  readonly scope: 'module' | 'global';
  emit(rom: Rom, model: Model, cx: EmitContext, module: number | null): Iterable<FileEntry>;
}
