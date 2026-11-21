// The truth of the real tier (architecture §8.1): the FUNC symbols of the reference ELF that lie inside
// the ROM, merged by address with the Thumb bit cleared, the first name and the largest size kept:
// romlift's elfFunctions (the PoC's truth.ts rule), in symbol-table order of first appearance, because
// the PoC names the owner of a false entry by the first containing function in that order.
import { type ElfFile, type ElfFunction, ROM_BASE, elfFunctions } from 'romlift';

export type TruthFunction = ElfFunction;

export interface Truth {
  /** In symbol-table order of first appearance. */
  readonly functions: readonly TruthFunction[];
  readonly byAddr: ReadonlyMap<number, TruthFunction>;
  /**
   * The addresses inside the ROM where an unsized function's code ends, ascending: data mapping symbols
   * (`$d...`) and typed symbols (FUNC, with the Thumb bit cleared, OBJECT, SECTION). elfCodeEnd reads it.
   */
  readonly ends: readonly number[];
  /** The addresses inside the ROM of the typed symbols alone, ascending: where an unsized function's own code can last run to. */
  readonly typed: readonly number[];
  /** The addresses inside the ROM of the code mapping symbols (`$t...`, `$a...`), ascending: where code resumes after a `$d`. */
  readonly code: readonly number[];
}

type Symbol = ElfFile['symbols'][number];

const isTyped = (s: Symbol): boolean => s.type === 'func' || s.type === 'object' || s.type === 'section';
const isMapping = (s: Symbol, kind: string): boolean => s.name === `$${kind}` || s.name.startsWith(`$${kind}.`);

/** Whether a symbol marks where the code before it ends: a data mapping symbol or a typed symbol. */
function endsCode(s: Symbol): boolean {
  return isMapping(s, 'd') || isTyped(s);
}

/** The ELF's functions inside `[ROM_BASE, ROM_BASE + romSize)`. */
export function elfTruth(elf: ElfFile, romSize: number): Truth {
  const functions = elfFunctions(elf, { start: ROM_BASE, end: ROM_BASE + romSize }, 'symbol-table');
  const end = ROM_BASE + romSize;
  const addrs = (keep: (s: Symbol) => boolean): number[] =>
    [...new Set(elf.symbols.filter((s) => keep(s) && s.addr >= ROM_BASE && s.addr <= end).map((s) => s.addr))].sort(
      (a, b) => a - b,
    );
  return {
    functions,
    byAddr: new Map(functions.map((f) => [f.addr, f] as const)),
    ends: addrs(endsCode),
    typed: addrs(isTyped),
    code: addrs((s) => isMapping(s, 't') || isMapping(s, 'a')),
  };
}

/** The index of the first address of `list` (ascending) above `addr` (list.length when there is none). */
function firstAbove(list: readonly number[], addr: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((list[mid] ?? 0) <= addr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where the code of the unsized function at `addr` ends: the first data mapping or typed symbol after the
 * last code mapping symbol in [addr, the next typed symbol) (addr itself when there is none), or undefined
 * when nothing follows. An inline pool mid-function (`.ltorg`, `.pool`: a `$d`, then a `$t` or `$a` where
 * the code resumes) does not end it; the `$d` that closes its last code run does.
 */
function unsizedEnd(truth: Pick<Truth, 'ends' | 'typed' | 'code'>, addr: number): number | undefined {
  const limit = truth.typed[firstAbove(truth.typed, addr)] ?? Number.POSITIVE_INFINITY;
  const resumed = truth.code[firstAbove(truth.code, limit - 1) - 1];
  const from = resumed !== undefined && resumed > addr ? resumed : addr;
  return truth.ends[firstAbove(truth.ends, from)];
}

/**
 * The end of the ELF's code, one convention for every ROM, tuning and sealed, in the tuning and the sealed
 * scorer and the rescoring of the PoC's dumps (D60 j; the owner's answer to Q5 on 18 October 2026, "Use
 * $d for every ROM", D61 a): the largest end of its functions, where a sized function ends at addr + size
 * (agbcc's .size, its literal pool included) and an unsized one (hand-written asm without .size, size 0)
 * at the `$d` (or typed symbol) that closes its last run of code before the next typed symbol (unsizedEnd).
 * A `$d` followed by more code of the same function is an inline pool, not its end; a trailing pool of
 * hand-written asm is data the file's functions share, so it is not given to the last of them.
 */
export function elfCodeEnd(truth: Pick<Truth, 'functions' | 'ends' | 'typed' | 'code'>): number {
  return truth.functions.reduce(
    (e, t) => Math.max(e, t.size > 0 ? t.addr + t.size : (unsizedEnd(truth, t.addr) ?? t.addr)),
    0,
  );
}

/**
 * The PoC's code end (the largest addr + size, an unsized function ending where it starts). No scorer uses
 * it (D61 a): poc-check reads it only to check that the PoC's own rows carry it, so that the harness still
 * reproduces the PoC's numbers under the PoC's ruler (poc-check.ts asScored).
 */
export function pocCodeEnd(truth: Pick<Truth, 'functions'>): number {
  return truth.functions.reduce((e, t) => Math.max(e, t.addr + t.size), 0);
}
