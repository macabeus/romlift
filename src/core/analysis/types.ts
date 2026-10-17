// The analysis types (architecture §3.3, §4.1): what leaves the analysis (FunctionFact, AnalysisResult),
// what the caller passes (AnalysisOptions, Seed, OverrideFact, AnalysisTuning), the internal Reading of
// one walk, the view a rule reads, and one contract per rule kind. Every contract is called by the driver
// at the proof of concept's call site (D48); the per-rule assignments that keep the wave-1 rule
// components from drifting are written next to each contract (D56).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Insn } from '../../foundation/isa/types.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import type { BlSite, CompilerProfile, ProfileId } from '../profile/types.ts';
import type { Provenance, Rejection } from '../provenance/provenance.ts';
import type { RuleId, RuleMeta } from '../provenance/rule-id.ts';
import type { TrailLevel } from '../provenance/trail.ts';
import type { MissReason, Origin } from '../provenance/vocabulary.ts';
import type { AddressMap } from './address-map.ts';
import type { RuleOracle } from './oracle.ts';
import type { PointerIndex } from './pointers.ts';
import type { WalkCursor } from './walk/cursor.ts';

export type { BlSite } from '../profile/types.ts';

// ---------------------------------------------------------------------------------------------------
// Claims and the facts of one function.

/** What a ROM byte is, once claimed. */
export const Claim = { free: 0, code: 1, pool: 2, table: 3, dead: 4, padding: 5, data: 6 } as const;
export type ClaimKind = (typeof Claim)[keyof typeof Claim];

export interface JumpTable {
  readonly base: Addr;
  readonly targets: readonly Addr[];
  readonly thumbBit: boolean;
}

export interface CallSite {
  readonly site: Addr;
  readonly target: Addr;
  readonly mode: Mode;
}

export type BlVerdict = 'call' | 'far' | 'noreturn';

export interface BlVerdictRecord {
  readonly site: Addr;
  readonly target: Addr;
  readonly verdict: BlVerdict;
  readonly rule: RuleId;
}

/** Where control leaves a function. `rule` is the walk or bl rule that decided it, or DECODER_FLOW. */
export interface Exit {
  readonly at: Addr;
  readonly rule: RuleId;
  readonly kind: 'return' | 'tail' | 'noreturn-call' | 'swi-end' | 'reg-jump';
}

/** The rule id of an exit the decoder's Flow decides with no rule (bx lr, pop {.., pc}, mov pc, lr). */
export const DECODER_FLOW: RuleId = 'walk.decoder-flow';

export interface FunctionFact {
  readonly entry: Addr;
  readonly mode: Mode;
  /** Set only inside a runs_at range. */
  readonly runAt?: Addr;
  /** Code plus adjacent pools and tables (claim.adjacent-pools). */
  readonly extent: Span;
  readonly codeEnd: Addr;
  /** Instruction bytes, merged runs. */
  readonly code: readonly Span[];
  /** claim.dead-code-in-extent */
  readonly dead: readonly Span[];
  /** Pool words inside the extent. */
  readonly pools: readonly Addr[];
  /** Pool words claimed outside the extent. */
  readonly farPools: readonly Addr[];
  readonly tables: readonly JumpTable[];
  readonly calls: readonly CallSite[];
  readonly blVerdicts: readonly BlVerdictRecord[];
  readonly exits: readonly Exit[];
  /** Targets of b/bcc inside the function. */
  readonly branchTargets: readonly Addr[];
  readonly adrs: readonly Addr[];
  readonly veneers: readonly Addr[];
  /** gap.adr-block-absorb */
  readonly absorbed: readonly Span[];
  /** Bytes inside the extent no instruction, pool or table covers (tiled holes, ARM mixers). */
  readonly holes: readonly Span[];
  readonly origin: Origin;
  /** The rule that proposed it (`rule`) and, in `note`, the accept rule that took it. */
  readonly accepted: Provenance;
  /** Later proposals of the same entry, one per proposing rule. */
  readonly also: readonly Provenance[];
}

export interface UnlistedFinding {
  readonly entry: Addr;
  readonly mode: Mode;
  readonly origin: Origin;
  readonly provenance: Provenance;
}

export interface ListedInvalid {
  readonly entry: Addr;
  readonly rejection: Rejection;
}

export interface ClaimRun {
  readonly span: Span;
  readonly kind: ClaimKind;
  readonly owner?: Addr;
}

export interface StartupRegion {
  readonly span: Span;
  readonly entries: readonly Addr[];
}

interface AnalysisCommon {
  readonly schema: 'romlift/analysis@1';
  readonly rom: { readonly sha1: string; readonly end: Addr };
  readonly profile: ProfileId;
  /** The serialisable public options; tuning is never recorded. */
  readonly options: AnalysisOptionsRecord;
  /** Sorted by entry. */
  readonly functions: readonly FunctionFact[];
  /** Runs of claimed bytes in address order, split at function extents. */
  readonly claims: readonly ClaimRun[];
  readonly startup: StartupRegion;
  readonly codeEnd: Addr;
  /** Sorted by (at, mode). */
  readonly rejections: readonly Rejection[];
  readonly diagnostics: readonly Diagnostic[];
}

export type AnalysisResult =
  | (AnalysisCommon & { readonly mode: 'discover' })
  | (AnalysisCommon & {
      readonly mode: 'confirm';
      readonly unlisted: readonly UnlistedFinding[];
      readonly listedInvalid: readonly ListedInvalid[];
    });

// ---------------------------------------------------------------------------------------------------
// Options and tuning.

export interface Seed {
  readonly entry: Addr;
  readonly mode: Mode;
  readonly rule: 'seed.listed' | 'seed.override' | 'seed.evidence-hint';
  readonly name?: string;
  readonly size?: number;
  readonly label?: boolean;
}

export interface OverrideFact {
  readonly span: Span;
  readonly kind: 'code' | 'data';
  readonly mode?: Mode;
  readonly runsAt?: Addr;
}

export interface AnalysisOptions {
  readonly mode: 'discover' | 'confirm';
  /** Confirm: exactly the TOML's [functions]; discover: evidence only. */
  readonly seeds: readonly Seed[];
  readonly overrides: readonly OverrideFact[];
  readonly trail: TrailLevel;
  /** explain: keep only events touching this span. */
  readonly trailFilter?: Span;
}

/** The options as the result records them: the public options, never the tuning. */
export interface AnalysisOptionsRecord {
  readonly mode: 'discover' | 'confirm';
  readonly seeds: readonly Seed[];
  readonly overrides: readonly OverrideFact[];
  readonly trail: TrailLevel;
  readonly trailFilter?: Span;
}

/** Internal (romlift/internal, outside semver, D37). */
export interface AnalysisTuning {
  /** The ascending worklist (D10); the PoC's 'poc-lifo' was deleted when phase 2 landed. */
  readonly worklist: 'ascending';
  /** §4.2, D13 */
  readonly cache: 'epoch' | 'epoch-reuse';
  /** `analyze --disable`, `bench ablate`: these rules are skipped. */
  readonly disabled: readonly RuleId[];
  /** Lockstep against the PoC's recorded answers (§4.5). */
  readonly oracle?: RuleOracle;
}

// ---------------------------------------------------------------------------------------------------
// The reading of one walk (internal to core/analysis; built only by reading.ts's makeReading).

/** One decoded instruction: its address and length. */
export interface InsnSpan {
  readonly addr: Addr;
  readonly len: number;
}

/** A literal-pool word the walk loaded, and its value. */
export interface PoolWord {
  readonly addr: Addr;
  readonly value: number;
}

/** Why a walk path stopped as not code (the PoC's error kinds). */
export interface ReadingError {
  readonly reason: 'out-of-rom' | 'not-code' | 'bl-out-of-rom' | 'pool-out-of-rom';
  readonly at: Addr;
}

/** Instruction length by address: a Map, or the walk's own index (walk/insn-index.ts). */
export interface InsnLookup {
  has(a: Addr): boolean;
  get(a: Addr): number | undefined;
  readonly size: number;
}

/**
 * The walk of one entry under the claims and function set at the time it was taken. Immutable;
 * `codeEnd`, `end` and the holes are computed once, when it is built (milestone M2 step (a)).
 */
export interface Reading {
  readonly entry: Addr;
  readonly mode: Mode;
  /** Every instruction, sorted by address. */
  readonly insns: readonly InsnSpan[];
  /** Instruction length by address. */
  readonly insnAt: InsnLookup;
  /** Pool words in the order the walk first loaded them (the PoC's Map order). */
  readonly pools: readonly PoolWord[];
  /** Pool value by address. */
  readonly poolAt: ReadonlyMap<Addr, number>;
  /** Jump tables in the order the walk found them. */
  readonly tables: readonly JumpTable[];
  /** By target, then mode ('arm' first), then site: the PoC's `calls` getter order. */
  readonly calls: readonly CallSite[];
  /** Every bl the walk passed as a call, in walk order. */
  readonly blSites: readonly BlSite[];
  /** bl sites followed by non-code, sorted. */
  readonly deadEnd: readonly Addr[];
  /** The stack delta at each return or tail exit (Thumb), in walk order. */
  readonly balance: readonly number[];
  /** Returns, tail exits, register jumps and swi ends. */
  readonly returns: number;
  /** In walk order. */
  readonly errors: readonly ReadingError[];
  /** ARM entries after `bx pc`, sorted. */
  readonly veneers: readonly Addr[];
  /** Targets of adr (ARM) and add rd, pc, #imm (Thumb), sorted. */
  readonly adrs: readonly Addr[];
  /** Targets of branches that leave into another function, sorted. */
  readonly tails: readonly Addr[];
  /** How many of `returns` are tail branches. */
  readonly tailExits: number;
  /** bl sites walked as jumps, sorted. */
  readonly far: readonly Addr[];
  /** bl sites that never return, sorted. */
  readonly noret: readonly Addr[];
  /** The verdict of every bl the settle loop decided, sorted by site. */
  readonly blVerdicts: readonly BlVerdictRecord[];
  readonly exits: readonly Exit[];
  /** Targets of b/bcc followed inside the function, sorted. */
  readonly branchTargets: readonly Addr[];
  /** ARM code the Thumb walk switches into inline (walk.inline-arm-switch): each [target, end of its ARM reading), sorted. */
  readonly armTails: readonly Span[];
  /** The walk slot's answers the walk applied, in walk order; empty unless the walk was traced (WalkEnv.trace: a trail is on). */
  readonly steps: readonly WalkDecision[];
  /** One past the last instruction byte (the entry when there is none). */
  readonly codeEnd: Addr;
  /** The extent's end: code plus adjacent pools and tables (claim.adjacent-pools' extentEnd). */
  readonly end: Addr;
  /** Uncovered bytes of [entry, end), not counting zero padding before a covered halfword (the PoC's dense()). */
  readonly holes: readonly Span[];
  readonly holeBytes: number;
}

/** What an extent rule reads of a reading under construction. */
export interface ReadingShape {
  readonly entry: Addr;
  readonly codeEnd: Addr;
  /** Pool word addresses in walk order. */
  readonly pools: readonly Addr[];
  readonly tables: readonly JumpTable[];
  /** The inline ARM tails (Reading.armTails). */
  readonly armTails?: readonly Span[];
}

// ---------------------------------------------------------------------------------------------------
// The view: what a rule may read. The driver owns all state.

export interface AnalysisView {
  readonly rom: Rom;
  readonly profile: CompilerProfile;
  readonly addresses: AddressMap;
  readonly round: number;
  readonly epoch: number;
  /** The options' seeds and overrides, for the seed rules (D56). */
  readonly seeds: readonly Seed[];
  readonly overrides: readonly OverrideFact[];
  /** The claim of a byte; free outside the ROM. */
  claimAt(a: Addr): ClaimKind;
  /** The innermost accepted extent covering a (§9.3). */
  owner(a: Addr): FunctionFact | undefined;
  /** discover: accepted; confirm: listed or accepted (§4.2). */
  isFunction(a: Addr): boolean;
  /** Accepted entries in acceptance order (D56). */
  functions(): readonly Addr[];
  /** The reading an entry was accepted with, merged with any absorbed block (D56). */
  accepted(entry: Addr): Reading | undefined;
  /** Thumb: the settled reading, memoised for the epoch; ARM: a fresh walk, as the PoC's analyzeArm. */
  read(entry: Addr, mode: Mode): Reading;
  /** The driver's validity service: optimistic memo, intrinsic failures kept (driver/validity.ts). */
  valid(entry: Addr): boolean;
  /** The first failing validity rule, computed now without the memo (the PoC's whyInvalid, D56). */
  whyInvalid(entry: Addr): ValidityFailure | undefined;
  /** Intrinsic failures, remembered for the whole analysis. */
  neverValid(entry: Addr): boolean;
  /** The entry's bl verdicts are being settled up the stack (D56). */
  inProgress(entry: Addr): boolean;
  /** The accepted Thumb function whose `add rd, pc, #imm` names a (D56). */
  adrOwner(a: Addr): Addr | undefined;
  readonly pointers: PointerIndex;
}

export interface Candidate {
  readonly entry: Addr;
  readonly mode: Mode;
  readonly proposedBy: RuleId;
  readonly cites: readonly Addr[];
}

// ---------------------------------------------------------------------------------------------------
// Rule contracts, one per kind. The driver calls each at the PoC call site named in its comment.

/**
 * Round 0, in pipeline.seed order; a rule's seeds are computed once, after the earlier rules' seeds
 * were accepted, and each candidate is accepted with its own worklist before the next.
 * seed.rom-entry (origin rom-entry): the ROM's first word is an ARM `b`; propose 0x08000000 then its
 * target, both ARM. seed.startup-pointer (origin startup-pointer): for each accepted ARM function in
 * acceptance order (v.functions()), each pool value of its accepted reading in walk order that is an odd
 * pointer to a word-aligned ROM address, as Thumb.
 * seed.listed / seed.override / seed.evidence-hint (origins listed, override, evidence): the
 * options' seeds whose `rule` is the rule's id, sorted by entry.
 */
export interface SeedRule {
  readonly kind: 'seed';
  seeds(v: AnalysisView): readonly Candidate[];
}

/**
 * One snapshot per grow round (pointerCandidates), sorted ascending; `earlier` holds the addresses of
 * the slots before it. seed.pool-pointer (origin pool-pointer): odd pool values of accepted functions
 * pointing at word-aligned ROM addresses that are not functions. seed.data-pointer (origin
 * data-pointer): pointer-index targets not accepted, not in `earlier`, not neverValid, with at least
 * one referring word that is not claimed code.
 */
export interface HarvestRule {
  readonly kind: 'harvest';
  harvest(v: AnalysisView, earlier: ReadonlySet<Addr>): readonly Addr[];
}

/**
 * At accept, in pipeline.queue order, pushed onto the LIFO worklist. seed.call (origin call): every
 * call of the function in `calls` order. seed.veneer (origin veneer): every veneer, ascending, as ARM.
 * seed.adr (origin adr): for an ARM function, every adr target in the ROM, word-aligned and above the
 * entry, ascending, as ARM.
 */
export interface QueueRule {
  readonly kind: 'queue';
  queue(f: FunctionFact, v: AnalysisView): readonly Candidate[];
}

/**
 * What one walk step does when a policy answers (first answer wins). Without an answer the walker
 * follows the decoder's Flow: next, adr, swi and an unanswered pool load continue; a branch is followed
 * (and ends the path when unconditional); bl follows the settle verdicts; a return ends the path as a
 * return (DECODER_FLOW); `bx rN` ends it as a reg-jump (DECODER_FLOW); any other indirect jump (mov, add,
 * ldr or ldm to pc) and invalid stop the walk as not code.
 * An end-path answer on a conditional instruction (Thumb bcc, ARM cond ≠ AL) counts the exit and the
 * path goes on. `continue` and `padding` are D56 additions.
 */
/** One walk-slot answer a walk applied: the rule, the instruction it answered for, and the step it gave (a 'verdict' trail event). */
export interface WalkDecision {
  readonly at: Addr;
  readonly rule: RuleId;
  readonly step: WalkStep['step'];
}

export type WalkStep =
  /** Control leaves here. At a stop: noreturn-call marks the last bl, swi-end counts a return. */
  | { readonly step: 'end-path'; readonly exit: Exit['kind'] }
  /** The instruction loads a literal-pool word (Thumb: a pool past the ROM end is a decode error). */
  | { readonly step: 'pool'; readonly addr: Addr }
  /** A jump table: its targets are walked, the path ends. */
  | { readonly step: 'table'; readonly table: JumpTable }
  /** `bx pc`: ARM code at target is a veneer; the path ends as a return. */
  | { readonly step: 'switch-mode'; readonly target: Addr }
  /** The instruction does not end the path (an indirect call). */
  | { readonly step: 'continue' }
  /** At a Thumb stop: the last instruction of the run is padding; drop it and ask again. */
  | { readonly step: 'padding' }
  /** Thumb `bx rN` into ARM code right after it: the ARM code at target is this function's tail; the Thumb path ends as a register jump. */
  | { readonly step: 'arm-tail'; readonly target: Addr };

/**
 * Asked for every decoded instruction (cursor.phase 'insn') and, in Thumb, at a stop on non-code with
 * the last instruction of the run (cursor.phase 'stop'). Assignments: walk.pc-load-is-pool: a pool load
 * → pool (both modes). walk.table-by-register: Thumb mov/add pc → table from
 * profile.idioms.matchTableJump(cursor.run, cursor.run.length - 1). walk.mov-lr-pc-bx-is-call: ARM bx
 * whose previous instruction is `mov lr, pc` → continue. walk.mov-pc-without-table: an indirect jump
 * through mov/add pc (both modes) or ARM ldr/ldm pc → end-path reg-jump. walk.bx-pc-veneer: Thumb `bx
 * pc` → switch-mode. walk.branch-into-function: a branch to an address not yet walked that is a function
 * or claimed code (ARM: or below the entry), other than the entry → end-path tail.
 * walk.trailing-zero-padding: stop phase, a zero halfword → padding. walk.noreturn-call-before-noncode:
 * stop phase, a bl → end-path noreturn-call. walk.swi-before-noncode: stop phase, swi → end-path swi-end.
 */
export interface WalkPolicy {
  readonly kind: 'walk';
  onInsn(insn: Insn, cursor: WalkCursor): WalkStep | undefined;
}

/**
 * settle(), per bl site of the current round's reading. Verdict rules (no `refines`) are asked first,
 * first answer wins; a site with no answer is deferred. Then, for a site that is a call or deferred and
 * in caller.deadEnd, the refining rules may answer 'noreturn'. Assignments: bl.self-or-accepted: target
 * is the entry or a function → call. bl.target-before-entry: target < entry → call. bl.near-is-call:
 * !profile.idioms.matchFarJump → call. bl.target-inside-caller: target < caller.codeEnd → far.
 * bl.target-has-prologue: idioms.isPrologue(target, thumb) → call. bl.target-pops-unpushed-frame:
 * target in progress → defer; else far when v.read(target, 'thumb') pops more than it pushed, call
 * otherwise. bl.noreturn-before-noncode (refines): site in caller.deadEnd → noreturn.
 */
export interface BlVerdictRule {
  readonly kind: 'bl';
  /** True: a refinement asked after the verdict (D56). */
  readonly refines?: boolean;
  decide(site: BlSite, caller: Reading, v: AnalysisView): BlVerdict | 'defer' | undefined;
}

/** The first validity rule a Thumb entry fails. */
export interface ValidityFailure {
  readonly rule: RuleId;
  readonly reason: MissReason;
  readonly intrinsic: boolean;
  readonly detail: string;
}

/**
 * whyInvalid(), in pipeline.validity order; `check` returns the detail of a failure. A rule with
 * `checkEntry` judges the entry before any reading exists, and its `check` is never called (D56).
 * Reasons: valid.in-rom-unclaimed 'inside-code' (checkEntry: outside the ROM, odd, or claimed);
 * valid.decodes 'decode-error' (no instruction, or an error); valid.balanced-stack 'pops-frame';
 * valid.returns-or-prologue 'no-return-no-prologue' (no return and !idioms.opensWithPushLr);
 * valid.no-claimed-code 'pool-claimed' (an instruction byte claimed); valid.pool-not-code
 * 'pool-claimed' (a pool word claimed as code); valid.not-pointer-table 'pointer-table'
 * (profile.pointerWords); valid.dense 'not-dense'; valid.calls-code 'calls-non-code' (a Thumb call
 * that is not a function and could not be code), the only one with intrinsic false.
 */
export interface ValidityRule {
  readonly kind: 'valid';
  readonly reason: MissReason;
  readonly intrinsic: boolean;
  check(r: Reading, v: AnalysisView): string | undefined;
  checkEntry?(entry: Addr, v: AnalysisView): string | undefined;
}

/**
 * acceptable(), in pipeline.accept order, for a valid harvest candidate (proposedBy names the harvest
 * rule): the first that holds accepts it. accept.tiles-after-accepted: anchored at start.
 * accept.prologue-and-loaded: prologue and proposed by seed.pool-pointer. accept.prologue-and-end-anchored:
 * prologue and anchored at end. accept.pointer-table-run: proposed by seed.data-pointer and in a run of
 * profile.pointerTableRun Thumb pointers to functions or valid entries (inPointerTable).
 */
export interface AcceptRule {
  readonly kind: 'accept';
  readonly reason: 'unanchored';
  holds(c: Candidate, r: Reading, v: AnalysisView): Provenance | undefined;
}

/**
 * The tiny-candidate veto of thumbCandidate() (D56), applied to the forward pair's candidates.
 * accept.tiny-anchored-at-start: a gap.forward-chain candidate with fewer than tinyFunctionInsns
 * instructions is vetoed unless it is anchored at start and does not open with b, bcc or bl.
 */
export interface AcceptVeto {
  readonly kind: 'accept-veto';
  readonly reason: 'unanchored';
  vetoes(c: Candidate, r: Reading, v: AnalysisView): string | undefined;
}

/** One claim write. 'always' overwrites; 'start-free' writes the span when its first byte is free; 'free-bytes' writes only free bytes. */
export interface ClaimEdit {
  readonly span: Span;
  readonly kind: ClaimKind;
  readonly when: 'always' | 'start-free' | 'free-bytes';
}

/**
 * claim(), after the driver claims the instruction bytes as code, in pipeline.claim order. `r` is the
 * reading being claimed: the accepted function's, or an absorbed block's (then `f` is its owner).
 * claim.adjacent-pools: pools in [entry, end) start-free as pool, tables always as table, and
 * `extentEnd` (the PoC's Func.end: extend codeEnd by every pool or table starting within
 * profile.extentPoolGap bytes of it). claim.far-pools: pools outside the extent, start-free as pool.
 * claim.dead-code-in-extent: when the reading is dense, its free bytes in [entry, end) as dead.
 */
export interface ClaimRule {
  readonly kind: 'claim';
  claims(f: FunctionFact, r: Reading, v: AnalysisView): readonly ClaimEdit[];
  /** The extent end of a reading under construction; the first claim rule that has it is used (D56). */
  extentEnd?(shape: ReadingShape, profile: CompilerProfile): Addr;
}

/**
 * After the passes, in pipeline.region order; edits apply to the final claims. region.startup: the
 * startup region (`startup`, D56): rom-entry, adr and veneer functions tiling the ROM from its start.
 * region.padding, region.data-after-code: padding and data claims.
 */
export interface RegionRule {
  readonly kind: 'region';
  classify(v: AnalysisView): readonly ClaimEdit[];
  startup?(v: AnalysisView): StartupRegion | undefined;
}

/**
 * The cursor of fillGaps(). `gap` is the free run found; `end` the current end, which the end-anchor and
 * backward loops shrink; `at` the position asked about. `head`: for the endAnchor slot, the gap's head
 * reading; for the forward proposers after the pair, the head rule's reading at `at` (the PoC's
 * tryTiledHole); otherwise undefined.
 */
export interface GapCursor {
  readonly gap: Span;
  readonly at: Addr;
  readonly end: Addr;
  readonly head?: Reading;
  readonly pass: 'patient' | 'impatient';
}

/** absorbBlock(): gap.adr-block-absorb (origin gap-scan). The block at `at` is merged into `into`. */
export interface GapAbsorb {
  readonly kind: 'gap-absorb';
  absorb(c: GapCursor, v: AnalysisView): { readonly into: Addr; readonly span: Span } | undefined;
}

/** holeHead(): gap.tiled-hole (origin tiled-hole). The Thumb reading at `at` when it is a function in every respect but density or stack balance. */
export interface GapHead {
  readonly kind: 'gap-head';
  head(c: GapCursor, v: AnalysisView): Reading | undefined;
}

/**
 * The forward chain, the end anchor and the backward chain. gap.forward-chain (origin gap-scan):
 * thumbCandidate() at `at`. gap.arm-scan (origin arm-gap-scan, reason 'arm-unreached'): armAhead() from
 * `at`. gap.tiled-hole-inner (origin tiled-hole): cursor.head fills the hole to `end` within fillSlack,
 * or is anchored at end. gap.end-anchor (origin gap-scan): the best candidate below `end` (one per call;
 * the driver accepts it and shrinks `end`). gap.backward-prologue-chain (origin gap-scan): the highest
 * `push {.., lr}` below `end`, within prologueDistance, whose reading fills to `end`.
 */
export interface GapProposer {
  readonly kind: 'gap';
  readonly reason?: MissReason;
  propose(c: GapCursor, v: AnalysisView): Candidate | undefined;
}

/** The comparison of the forward pair: gap.arm-over-prologueless-thumb (origin arm-gap-scan). */
export interface GapPrefer {
  readonly kind: 'gap-prefer';
  prefer(thumb: Reading, arm: Reading, v: AnalysisView): 'thumb' | 'arm';
}

/** gap.skip-padding-and-pointers (origin gap-scan): the next cursor over a zero or pointer word, or stop. */
export interface GapSkip {
  readonly kind: 'gap-skip';
  skip(c: GapCursor, v: AnalysisView): Addr | undefined;
}

// ---------------------------------------------------------------------------------------------------
// The registry.

export type RuleContract =
  | SeedRule
  | HarvestRule
  | QueueRule
  | WalkPolicy
  | BlVerdictRule
  | ValidityRule
  | AcceptRule
  | AcceptVeto
  | ClaimRule
  | RegionRule
  | GapAbsorb
  | GapHead
  | GapProposer
  | GapPrefer
  | GapSkip;

export type RuleKind = RuleContract['kind'];

/** A rule as its file exports it: its contract and its metadata. */
export type RegisteredRule = RuleContract & { readonly meta: RuleMeta };

/** The registered rule of one contract kind. */
export type RuleOfKind<K extends RuleKind> = Extract<RegisteredRule, { readonly kind: K }>;

/** The kinds each family's rules may have. */
export interface FamilyKinds {
  readonly seed: 'seed' | 'harvest' | 'queue';
  readonly walk: 'walk';
  readonly bl: 'bl';
  readonly valid: 'valid';
  readonly accept: 'accept' | 'accept-veto';
  readonly gap: 'gap-absorb' | 'gap-head' | 'gap' | 'gap-prefer' | 'gap-skip';
  readonly claim: 'claim';
  readonly region: 'region';
}

export type AnalysisFamily = keyof FamilyKinds;

/** A rule of one family. */
export type FamilyRule<F extends AnalysisFamily> = RuleOfKind<FamilyKinds[F]>;

/** Every rule by id (core/analysis/rules/index.ts). */
export type RuleRegistry = Readonly<Record<RuleId, RegisteredRule>>;
