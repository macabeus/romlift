// The agbcc profile: the proof of concept's numbers (romlift-poc/src/analysis.ts) and its call order of
// every rule slot (D12, D48). Changing a number or an order here is a reviewed diff with its bench diff.
import { contains, u16, u32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import type { Insn } from '../../foundation/isa/types.ts';
import { registerEffect } from '../../foundation/isa/registers.ts';
import type { BlSite, CompilerProfile, JumpTableMatch, Pipeline, ReadingSummary } from './types.ts';

/** The proof of concept's call order of every rule (§4.1): each analysis rule id in exactly one slot. */
export const AGBCC_PIPELINE: Pipeline = {
  // run(): the cartridge entry, then the Thumb pointers of the startup code; then what the project lists.
  seed: ['seed.rom-entry', 'seed.startup-pointer', 'seed.listed', 'seed.override', 'seed.evidence-hint'],
  // pointerCandidates(): the pool list, then the data list filtered by it.
  harvest: ['seed.pool-pointer', 'seed.data-pointer'],
  // accept(): calls, then veneers, then ARM adr targets, in push order; then the entries of code copied to IWRAM (D60 e).
  queue: ['seed.call', 'seed.veneer', 'seed.adr', 'seed.ram-copy'],
  walk: [
    'walk.pc-load-is-pool',
    'walk.table-by-register',
    'walk.mov-lr-pc-bx-is-call',
    'walk.mov-pc-without-table',
    'walk.bx-pc-veneer',
    'walk.inline-arm-switch',
    'walk.branch-into-function',
    'walk.trailing-zero-padding',
    'walk.noreturn-call-before-noncode',
    'walk.swi-before-noncode',
  ],
  // settle(): the verdict ladder in order, then the refinement of calls that never return.
  bl: [
    'bl.self-or-accepted',
    'bl.target-before-entry',
    'bl.near-is-call',
    'bl.target-inside-caller',
    'bl.target-has-prologue',
    'bl.target-beyond-callee',
    'bl.target-pops-unpushed-frame',
    'bl.noreturn-before-noncode',
  ],
  // whyInvalid(), in its order.
  validity: [
    'valid.in-rom-unclaimed',
    'valid.decodes',
    'valid.balanced-stack',
    'valid.returns-or-prologue',
    'valid.no-claimed-code',
    'valid.pool-not-code',
    'valid.not-pointer-table',
    'valid.dense',
    'valid.calls-code',
  ],
  // acceptable(), in its order; then the tiny-candidate veto of thumbCandidate().
  accept: [
    'accept.tiles-after-accepted',
    'accept.prologue-and-loaded',
    'accept.prologue-and-end-anchored',
    'accept.pointer-table-run',
    'accept.prologue-and-calls-accepted',
    'accept.tiny-anchored-at-start',
  ],
  // claim(): pools in the extent, pools beyond it, then the dead bytes of a dense extent.
  claim: ['claim.adjacent-pools', 'claim.far-pools', 'claim.dead-code-in-extent'],
  gap: {
    absorb: 'gap.adr-block-absorb',
    head: 'gap.tiled-hole',
    forward: { thumb: 'gap.forward-chain', arm: 'gap.arm-scan', after: ['gap.tiled-hole-inner'] },
    prefer: 'gap.arm-over-prologueless-thumb',
    skip: 'gap.skip-padding-and-pointers',
    endAnchor: 'gap.end-anchor',
    backward: 'gap.backward-prologue-chain',
  },
  region: ['region.startup', 'region.padding', 'region.data-after-code'],
  passes: ['patient', 'impatient'],
};

const FAR_JUMP = { minDistance: 1536, requiresPushedLr: false } as const;
const TABLE_JUMP = { maxBaseDistance: 0x400, maxEntries: 2048, maxTargetSpan: 0x10000 } as const;

/** Thumb `push {.., lr}`: the high byte of the halfword is 0xB5. */
function pushLr(rom: Rom, a: Addr): boolean {
  return contains(rom, a, 2) && (u16(rom, a) & 0xff00) === 0xb500;
}

function isPrologue(rom: Rom, a: Addr, mode: Mode): boolean {
  if (mode === 'thumb') return pushLr(rom, a) && (a & 3) === 0;
  return (a & 3) === 0 && contains(rom, a, 4) && ((u32(rom, a) & 0xffff4000) >>> 0) === 0xe92d4000;
}

/** The proof of concept's padding: a zero byte, or a byte of a 0x46C0 halfword (`mov r8, r8`). */
function isPadding(rom: Rom, a: Addr): boolean {
  if (!contains(rom, a)) return false;
  const even = a - (a & 1);
  const b = rom.bytes;
  const off = a - rom.base;
  if ((b[off] ?? 1) === 0) return true;
  return contains(rom, even, 2) && b[even - rom.base] === 0xc0 && b[even - rom.base + 1] === 0x46;
}

/** A word the jump may index: a word-aligned ROM address just ahead of the jump at `pc`. */
function isTableBase(rom: Rom, v: number, pc: Addr): boolean {
  return contains(rom, v) && (v & 3) === 0 && v - pc > 0 && v - pc < TABLE_JUMP.maxBaseDistance;
}

/**
 * The register that reaches the jump, followed back through the run: through moves, adds and the word
 * load of the table slot to the pc-relative loads that set it, nearest first. The first of those loads
 * whose word is a table base names the table; a register written any other way (a constant, other
 * arithmetic, a call) is no longer followed, and the search ends when no register is.
 */
function tableBase(insns: readonly Insn[], cursor: number, rom: Rom): { readonly base: Addr; readonly load: Addr } | undefined {
  const jump = insns[cursor];
  if (jump === undefined || jump.flow.kind !== 'indirect') return undefined;
  let tracked = 1 << jump.flow.reg;
  for (let i = cursor - 1; i >= 0 && tracked !== 0; i--) {
    const insn = insns[i];
    if (insn === undefined) continue;
    if (insn.flow.kind === 'pool-load') {
      const rd = insn.flow.rd;
      if ((tracked & (1 << rd)) === 0) continue;
      tracked &= ~(1 << rd);
      if (contains(rom, insn.flow.pool, 4) && isTableBase(rom, u32(rom, insn.flow.pool), jump.addr)) return { base: u32(rom, insn.flow.pool), load: insn.addr };
      continue;
    }
    const effect = registerEffect(insn);
    if ((effect.writes & tracked) === 0) continue;
    tracked &= ~effect.writes;
    for (const r of effect.from) tracked |= 1 << r;
  }
  return undefined;
}

/**
 * agbcc's switch: the table base the jump register is followed back to (tableBase), then the words from
 * that base while each is an even ROM address near the jump and the slot stays below the lowest target
 * past the base.
 */
function matchTableJump(insns: readonly Insn[], cursor: number, rom: Rom): JumpTableMatch | undefined {
  const jump = insns[cursor];
  const found = tableBase(insns, cursor, rom);
  if (jump === undefined || found === undefined) return undefined;
  const { base, load } = found;
  const pc = jump.addr;
  const targets: Addr[] = [];
  let lowest: Addr | undefined;
  while (targets.length < TABLE_JUMP.maxEntries) {
    const slot = base + 4 * targets.length;
    if ((lowest !== undefined && slot >= lowest) || slot + 4 > rom.end) break;
    const t = u32(rom, slot);
    if (!contains(rom, t) || (t & 1) !== 0 || Math.abs(t - pc) > TABLE_JUMP.maxTargetSpan) break;
    targets.push(t);
    if (t > base && (lowest === undefined || t < lowest)) lowest = t;
  }
  return targets.length === 0 ? undefined : { base, targets, load };
}

function matchFarJump(site: BlSite, caller: ReadingSummary): boolean {
  if (Math.abs(site.target - site.site) < FAR_JUMP.minDistance) return false;
  return !FAR_JUMP.requiresPushedLr || caller.prologue;
}

export const AGBCC: CompilerProfile = {
  id: 'agbcc',
  pipeline: AGBCC_PIPELINE,
  // agbcc needs bl as a jump only beyond `b` range; the shortest seen in five ROMs is 1,960 bytes.
  farJump: FAR_JUMP,
  tableJump: TABLE_JUMP,
  density: { minHoles: 8, holeShift: 4 },
  pointerTableRun: 3,
  tinyFunctionInsns: 3,
  pointerWords: { minPointers: 4, minShare: 0.25 },
  anchorSlack: 3,
  extentPoolGap: 8,
  // seed.ram-copy (D60 e): agbcc builds each of a call's three argument registers in at most two
  // instructions (a pool load, then one copy, add, subtract, shift or mask), and guards a call made only
  // for a non-zero size with one `cmp; beq` pair: 3 x 2 + 2 = 8. Measured, the longest argument setup of
  // a copy call on the six tuning ROMs is 7 (tmc's InitOverlays: ldr; ldr; subs; cmp; beq; ldr; adds);
  // the m4aSoundInit CpuSet of the other five is 6 (ldr; movs; negs; ands; ldr; ldr). The same window
  // bounds the jump after an IWRAM pointer load.
  ramCopy: { argInsns: 8 },
  gapScan: {
    backwardWindow: 4096,
    fillSlack: 3,
    armFrontPoolWords: 16,
    armMinInsnsForSkip: 16,
    prologueDistance: 4096,
    minInsns: 3,
  },
  // agbcc emits `.align 2, 0` before every function and literal pool; hand-written Thumb may sit on 2.
  alignment: { thumbFunction: 2, armFunction: 4, cFunction: 4, pool: 4, object: 4 },
  idioms: { isPrologue, opensWithPushLr: pushLr, isPadding, matchTableJump, matchFarJump },
};
