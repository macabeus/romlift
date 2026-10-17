// The compiler profile (architecture §4.3, D12): every constant the analysis rules read, the order of
// every rule slot, and the compiler idioms as functions. It lives below the analysis so the model and
// the layout can read alignment from it. Rules read the profile only through the view (`v.profile`).
import type { Insn } from '../../foundation/isa/types.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import type { RuleId } from '../provenance/rule-id.ts';

/** A registry key of core/profile/registry.ts; 'agbcc' ships. */
export type ProfileId = string;

/** One `bl` of a caller: the instruction address and its target. */
export interface BlSite {
  readonly site: Addr;
  readonly target: Addr;
}

/** What a far-jump idiom may know of the caller. */
export interface ReadingSummary {
  readonly entry: Addr;
  readonly mode: Mode;
  readonly codeEnd: Addr;
  readonly end: Addr;
  /** The caller opens with `push {.., lr}` (idioms.isPrologue). */
  readonly prologue: boolean;
}

/** A jump table found behind a computed jump: its base and its targets in slot order. */
export interface JumpTableMatch {
  readonly base: Addr;
  readonly targets: readonly Addr[];
  /** The pool load that named the base. */
  readonly load: Addr;
}

/**
 * Every rule order of the analysis, as data (D7). Each analysis rule id sits in exactly one slot.
 * The driver calls each slot at the proof of concept's call site (D48); the semantics per slot are in
 * core/analysis/types.ts next to the contracts.
 */
export interface Pipeline {
  /** Round 0, in order: SeedRule (and the confirm-mode seeds). */
  readonly seed: readonly RuleId[];
  /** Per grow round, in order, from one snapshot: HarvestRule. */
  readonly harvest: readonly RuleId[];
  /** At accept, in push order: QueueRule (callees, veneers, adr targets). */
  readonly queue: readonly RuleId[];
  /** First answer wins: WalkPolicy. */
  readonly walk: readonly RuleId[];
  /** First answer wins: BlVerdictRule (verdicts, then the refinements). */
  readonly bl: readonly RuleId[];
  /** First failure is the rejection: ValidityRule. */
  readonly validity: readonly RuleId[];
  /** First that holds: AcceptRule; AcceptVeto rules are applied to the forward-chain pair. */
  readonly accept: readonly RuleId[];
  /** In order, after the code bytes are claimed: ClaimRule. */
  readonly claim: readonly RuleId[];
  readonly gap: {
    readonly absorb: RuleId;
    readonly head: RuleId;
    /** The forward chain: the pair asked at the same cursor (`thumb`, `arm`), then `after` in order (the hole head's proposers). */
    readonly forward: { readonly thumb: RuleId; readonly arm: RuleId; readonly after: readonly RuleId[] };
    readonly prefer: RuleId;
    readonly skip: RuleId;
    readonly endAnchor: RuleId;
    readonly backward: RuleId;
  };
  /** After the passes, in order: RegionRule. */
  readonly region: readonly RuleId[];
  /** Each runs grow and fillGaps until neither adds a function. */
  readonly passes: readonly ('patient' | 'impatient')[];
}

export interface CompilerProfile {
  readonly id: ProfileId;
  readonly pipeline: Pipeline;
  /** A `bl` used as a jump: only beyond this distance, and (when required) from a caller that pushed lr. */
  readonly farJump: { readonly minDistance: number; readonly requiresPushedLr: boolean };
  /** A jump table behind `mov pc`/`add pc`: its base within maxBaseDistance ahead, at most maxEntries targets within maxTargetSpan of the jump. */
  readonly tableJump: {
    readonly maxBaseDistance: number;
    readonly maxEntries: number;
    readonly maxTargetSpan: number;
  };
  /** A function is dense when its holes stay within max(minHoles, extent >> holeShift) bytes. */
  readonly density: { readonly minHoles: number; readonly holeShift: number };
  /** Consecutive Thumb pointers that make a pointer table. */
  readonly pointerTableRun: number;
  /** A candidate with fewer instructions is a stub that needs its own evidence. */
  readonly tinyFunctionInsns: number;
  /** Words inside a reading that look like a pointer table: at least minPointers, and pointers ≥ minShare × words. */
  readonly pointerWords: { readonly minPointers: number; readonly minShare: number };
  /** Padding bytes allowed between a function and the claimed bytes that anchor it. */
  readonly anchorSlack: number;
  /** A pool or table belongs to the extent when it starts within this many bytes of the extent's end. */
  readonly extentPoolGap: number;
  /**
   * Code copied to IWRAM (seed.ram-copy): the arguments of a copy call and the jump after an IWRAM
   * pointer load are looked for within argInsns straight-line instructions; a copy of more than maxBytes
   * is not a code block.
   */
  readonly ramCopy: { readonly argInsns: number; readonly maxBytes: number };
  readonly gapScan: {
    /** How far below a gap's end the end-anchor scan looks. */
    readonly backwardWindow: number;
    /** A reading fills a gap when it ends within this many bytes of the gap's end. */
    readonly fillSlack: number;
    /** How many words ahead of the cursor an ARM function may start, past its own pools. */
    readonly armFrontPoolWords: number;
    /** An ARM function one word ahead of the cursor is taken without front pools at this size. */
    readonly armMinInsnsForSkip: number;
    /** How far below a gap's end the backward chain of prologues looks. */
    readonly prologueDistance: number;
    /** The fewest instructions a gap reading (hole head, end anchor, ARM candidate) may have. */
    readonly minInsns: number;
  };
  readonly alignment: {
    readonly thumbFunction: number;
    readonly armFunction: number;
    readonly cFunction: number;
    readonly pool: number;
    readonly object: number;
  };
  readonly idioms: {
    /** The entry opens with a pushed frame: Thumb `push {.., lr}` on a word boundary, ARM `stmdb sp!, {.., lr}`. */
    isPrologue(rom: Rom, a: Addr, mode: Mode): boolean;
    /** The raw Thumb halfword at `a` is `push {.., lr}`, at any alignment. */
    opensWithPushLr(rom: Rom, a: Addr): boolean;
    /** The unclaimed byte at `a` is padding: zero, or a byte of a `mov r8, r8` (0x46C0) halfword; the caller checks that `a` itself is unclaimed. */
    isPadding(rom: Rom, a: Addr): boolean;
    /** The jump table of the computed jump at insns[cursor], read from the ROM. */
    matchTableJump(insns: readonly Insn[], cursor: number, rom: Rom): JumpTableMatch | undefined;
    /** Whether a `bl` may be a jump (call verdicts aside): its distance and the caller's frame. */
    matchFarJump(site: BlSite, caller: ReadingSummary): boolean;
  };
}
