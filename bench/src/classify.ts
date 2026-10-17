// The classifiers of a sealed held-out run (architecture §8.4 "Held-out runs", D25). A sealed dataset has
// no exception lists, so its misses and false entries are judged by rules the ELF can check:
//
// - a miss M (an ELF FUNC the run did not report) is a `label-candidate` only when it lies strictly inside
//   the extent of a found function F whose entry is itself an ELF FUNC, M does not open with the
//   profile's prologue, and (a) M is the address right after a `bl`/`swi` site of F judged never-returning
//   (up to the next 4-byte boundary), or (b) M is the target of a `b`/`bcc` inside F, never of a `bl`, or
//   (c) M lies in one of F's holes (a tiled hole or ARM mixer code); every other miss is `glued`;
// - a false entry is `startup`, `veneer`, `adr-callback`, `inside-elf-function` or `other`.
//
// Pure, on bench-local input types (plain numbers, no romlift analysis types): the bench adapts whatever
// the analysis reports into these shapes. Every address is a ROM address with the Thumb bit cleared.

/** A half-open address range `[start, end)`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A `bl` (or `swi`) the run judged never-returning: the instruction's address and its size in bytes. */
export interface NoReturnSite {
  readonly site: number;
  readonly size: number;
}

/** A function the run reported. */
export interface FoundFunction {
  readonly entry: number;
  readonly mode: 'thumb' | 'arm';
  /** The function's extent; it starts at `entry`. */
  readonly extent: Span;
  /** Tiled holes and ARM mixer ranges inside the extent. */
  readonly holes: readonly Span[];
  /** Targets of the `b` and `bcc` instructions of the function (never of a `bl`). */
  readonly branchTargets: readonly number[];
  /** The `bl` sites judged never-returning and the `swi` sites that end the function. */
  readonly noReturnSites: readonly NoReturnSite[];
  /** Targets of the `bl` instructions of the function; a `bl` target is never a label (D25). */
  readonly callTargets?: readonly number[];
  /** The rule origin that reported the entry (`call`, `veneer`, `adr`, …). */
  readonly origin: string;
}

/** An ELF FUNC symbol, merged by address (romlift's elfFunctions). */
export interface TruthFunction {
  readonly addr: number;
  readonly size: number;
  readonly thumb: boolean;
}

export interface ClassifyInput {
  readonly found: readonly FoundFunction[];
  readonly truth: readonly TruthFunction[];
  /** The end of the startup region; entries below it are startup. */
  readonly startupEnd: number;
  /** Whether the code at `addr` opens with the profile's prologue. */
  readonly isPrologue: (addr: number) => boolean;
}

export type MissClass = 'label-candidate' | 'glued';

/** Which of the three meanings of a label (D25) makes a miss a label candidate. */
export type LabelClause = 'after-no-return' | 'branch-target' | 'in-hole';

export type FalseEntryClass = 'startup' | 'veneer' | 'adr-callback' | 'inside-elf-function' | 'other';

/** The input, indexed once for many queries. */
export interface Classifier {
  readonly input: ClassifyInput;
  readonly elfEntries: ReadonlySet<number>;
}

export function classifier(input: ClassifyInput): Classifier {
  return { input, elfEntries: new Set(input.truth.map((t) => t.addr)) };
}

/** `addr` rounded up to a multiple of 4. */
function alignUp4(addr: number): number {
  return addr + ((4 - (addr & 3)) & 3);
}

function strictlyInside(addr: number, span: Span): boolean {
  return addr > span.start && addr < span.end;
}

function within(addr: number, span: Span): boolean {
  return addr >= span.start && addr < span.end;
}

/** (a): the instruction after a never-returning site, or that address padded to the next 4-byte boundary. */
function followsNoReturnSite(m: number, f: FoundFunction): boolean {
  return f.noReturnSites.some(({ site, size }) => {
    const after = site + size;
    return m === after || m === alignUp4(after);
  });
}

/** The clause of `f` that makes miss `m` a label, when `m` lies inside `f`; checked in the order (a), (b), (c). */
function clauseOf(m: number, f: FoundFunction): LabelClause | undefined {
  if (followsNoReturnSite(m, f)) return 'after-no-return';
  if (f.branchTargets.includes(m) && !(f.callTargets ?? []).includes(m)) return 'branch-target';
  if (f.holes.some((h) => within(m, h))) return 'in-hole';
  return undefined;
}

/**
 * The clause that makes miss `m` a label candidate, or undefined when `m` is glued: the first found
 * function, in entry order, that contains `m` strictly inside its extent, has an ELF FUNC entry and
 * gives `m` one of the three meanings, provided `m` does not open with the prologue.
 */
export function labelClause(cx: Classifier, m: number): LabelClause | undefined {
  if (cx.input.isPrologue(m)) return undefined;
  let best: { readonly entry: number; readonly clause: LabelClause } | undefined;
  for (const f of cx.input.found) {
    if (f.entry === m || !strictlyInside(m, f.extent) || !cx.elfEntries.has(f.entry)) continue;
    const clause = clauseOf(m, f);
    if (clause !== undefined && (best === undefined || f.entry < best.entry)) best = { entry: f.entry, clause };
  }
  return best?.clause;
}

/** A miss is a label candidate when a clause holds, and glued otherwise (a glued miss fails the ROM). */
export function classifyMiss(cx: Classifier, m: number): MissClass {
  return labelClause(cx, m) === undefined ? 'glued' : 'label-candidate';
}

/**
 * A found entry that is not an ELF FUNC: below the startup end it is `startup`; otherwise by origin
 * (`veneer`, `adr` as `adr-callback`), then `inside-elf-function` when it lies in another ELF FUNC's
 * `[addr, addr + size)`, else `other`.
 */
export function classifyFalseEntry(cx: Classifier, f: Pick<FoundFunction, 'entry' | 'origin'>): FalseEntryClass {
  if (f.entry < cx.input.startupEnd) return 'startup';
  if (f.origin === 'veneer') return 'veneer';
  if (f.origin === 'adr') return 'adr-callback';
  if (cx.input.truth.some((t) => t.addr !== f.entry && within(f.entry, { start: t.addr, end: t.addr + t.size }))) return 'inside-elf-function';
  return 'other';
}
