// The ARM walk (the PoC's analyzeArm): recursive descent over a LIFO of paths with no stack tracking,
// decoding through foundation/isa. Where the table and the PoC classify an encoding differently on
// purpose (test/local/poc-decoder-differential.test.ts), the walk uses the PoC's class so readings stay
// equal: `add/sub pc, pc, #imm` is an adr, and the encodings ARMv4T leaves undefined that the PoC files as
// `other` or `pc_write` walk as such.
import { decode, rowFor } from '../../../foundation/isa/decode.ts';
import type { Flow, Insn } from '../../../foundation/isa/types.ts';
import { contains, u32 } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { toRun } from '../address-map.ts';
import { DECODER_FLOW } from '../types.ts';
import type { Reading, WalkStep } from '../types.ts';
import { askWalk, asksWalk, toLoadInsn, walkCursor, WalkRecord } from './cursor.ts';
import type { WalkEnv } from './cursor.ts';

/** The rows the ARMv4T leaves undefined that the PoC files as `other` or `pc_write`. */
const V4T_UNDEFINED: ReadonlySet<string> = new Set([
  'arm.misc_undefined',
  'arm.mul_undefined',
  'arm.swp_undefined',
  'arm.ldrd_strd',
  'arm.media_undefined',
  'arm.msr_imm_sbo',
  'arm.msr_reg_sbo',
  'arm.mrs_sbo',
  'arm.bx_sbo',
]);

/** The PoC's pc_write test (romlift-poc/src/arm.ts), for the rows above. */
function pocWritesPc(w: number): boolean {
  const writesPc = ((w >>> 12) & 0xf) === 0xf;
  const isMultiply = (w & 0x02000000) === 0 && (w & 0x90) === 0x90;
  const opcode = (w >>> 21) & 0xf;
  if ((w & 0x0c000000) === 0 && writesPc && (opcode < 8 || opcode > 11) && !isMultiply) return true;
  return ((w & 0x0c100000) === 0x04100000 && writesPc) || ((w & 0x0e100000) === 0x08100000 && (w & 0x8000) !== 0);
}

/** The PoC's undefined spaces: coprocessor and media. */
function pocInvalid(w: number): boolean {
  return (w & 0x0e000000) === 0x0c000000 || (w & 0x0f000000) === 0x0e000000 || (w & 0x0e000010) === 0x06000010;
}

/** The rotated immediate of a data-processing word. */
function rotatedImmediate(w: number): number {
  const rot = ((w >>> 8) & 0xf) * 2;
  const imm8 = w & 0xff;
  return rot === 0 ? imm8 : ((imm8 >>> rot) | (imm8 << (32 - rot))) >>> 0;
}

/** The Flow the walk uses for `insn`: the decoder's, except where the PoC classifies it otherwise on purpose. */
export function walkFlow(insn: Insn): Flow {
  const w = insn.word >>> 0;
  if (w >>> 28 === 0xf) return insn.flow;
  const op = w & 0x0fff0000;
  if ((op === 0x028f0000 || op === 0x024f0000) && insn.flow.kind !== 'adr') {
    const imm = rotatedImmediate(w);
    return { kind: 'adr', target: (insn.addr + 8 + (op === 0x028f0000 ? imm : -imm)) >>> 0 };
  }
  if (V4T_UNDEFINED.has(insn.specId)) {
    if (pocWritesPc(w)) return { kind: 'indirect', reg: 15, via: 'mov-pc' };
    return pocInvalid(w) ? { kind: 'invalid' } : { kind: 'next' };
  }
  return insn.flow;
}

/** The ARM instruction at load address `pc`, with its walk Flow. */
export function decodeArmAt(env: WalkEnv, pc: Addr): Insn {
  const { rom, addresses } = env.view;
  const insn = toLoadInsn(decode('arm', u32(rom, pc), toRun(addresses, pc)), addresses, pc);
  const flow = walkFlow(insn);
  return flow === insn.flow ? insn : { ...insn, flow };
}

/** Counts an exit; true when the path ends here (an unconditional instruction). */
function exitHere(rec: WalkRecord, insn: Insn, conditional: boolean, kind: 'return' | 'tail' | 'reg-jump', rule: RuleId, isFunction: (a: Addr) => boolean): boolean {
  if (kind === 'tail' && insn.flow.kind === 'branch' && isFunction(insn.flow.target)) {
    rec.calls.push({ site: insn.addr, target: insn.flow.target, mode: 'arm' });
  }
  rec.returns += 1;
  rec.exit(insn.addr, kind, rule);
  return !conditional;
}

/** Walks the ARM function at `entry` under the current claims and function set. */
export function walkArm(env: WalkEnv, entry: Addr): Reading {
  const { view } = env;
  const rom = view.rom;
  const rec = new WalkRecord(entry, 'arm', env.trace === true);
  const work: Addr[] = [entry];
  const isFunction = (a: Addr): boolean => view.isFunction(a);
  const runs = { current: [] as Addr[] };
  const cursor = walkCursor(view, entry, 'arm', (a) => rec.insns.has(a), () => runs.current, (a) => decodeArmAt(env, a));
  for (let next = work.pop(); next !== undefined; next = work.pop()) {
    let pc = next;
    const run: Addr[] = [];
    runs.current = run;
    while (!rec.insns.has(pc)) {
      if (pc !== entry && view.isFunction(pc)) break;
      if (!contains(rom, pc, 4) || (pc & 3) !== 0 || rec.pools.has(pc)) {
        rec.errors.push({ reason: 'not-code', at: pc });
        break;
      }
      const word = u32(rom, pc);
      if (rowFor('arm', word).spec.flow === 'next' && word >>> 28 !== 0xf) {
        // The decoder's Flow is next, and the PoC agrees (the differential): nothing to ask or record.
        rec.insn(pc, 4);
        run.push(pc);
        pc += 4;
        continue;
      }
      const insn = decodeArmAt(env, pc);
      if (insn.flow.kind === 'invalid') {
        rec.errors.push({ reason: 'not-code', at: pc });
        break;
      }
      rec.insn(pc, 4);
      run.push(pc);
      const conditional = insn.word >>> 28 !== 0xe;
      const flow = insn.flow;
      let ends = false;
      if (flow.kind === 'bl') rec.calls.push({ site: pc, target: flow.target, mode: 'arm' });
      else if (flow.kind === 'adr') rec.adrs.push(flow.target);
      else if (asksWalk(flow)) {
        cursor.at = pc;
        cursor.conditional = conditional;
        const answer = askWalk(env, insn, cursor);
        ends = answer === undefined ? follow(rec, insn, conditional, work, isFunction) : apply(rec, insn, conditional, answer.id, answer.step, work, isFunction, env);
      }
      if (ends) break;
      pc += 4;
    }
  }
  return rec.finish(env);
}

function apply(rec: WalkRecord, insn: Insn, conditional: boolean, id: RuleId, step: WalkStep, work: Addr[], isFunction: (a: Addr) => boolean, env: WalkEnv): boolean {
  rec.step(insn.addr, id, step);
  switch (step.step) {
    case 'pool':
      if (contains(env.view.rom, step.addr, 4)) rec.pool(step.addr, u32(env.view.rom, step.addr));
      return false;
    case 'table':
      rec.tables.push(step.table);
      for (const t of step.table.targets) work.push(t);
      return true;
    case 'switch-mode':
      rec.veneers.push(step.target);
      return exitHere(rec, insn, conditional, 'return', id, isFunction);
    case 'continue':
    case 'padding':
    case 'arm-tail':
      return false;
    case 'end-path':
      return exitHere(rec, insn, conditional, step.exit === 'tail' || step.exit === 'reg-jump' ? step.exit : 'return', id, isFunction);
  }
}

function follow(rec: WalkRecord, insn: Insn, conditional: boolean, work: Addr[], isFunction: (a: Addr) => boolean): boolean {
  const flow = insn.flow;
  switch (flow.kind) {
    case 'branch':
      rec.branchTargets.push(flow.target);
      work.push(flow.target);
      return !conditional;
    case 'return':
      return exitHere(rec, insn, conditional, 'return', DECODER_FLOW, isFunction);
    case 'indirect':
      if (flow.via === 'bx') return exitHere(rec, insn, conditional, 'reg-jump', DECODER_FLOW, isFunction);
      rec.errors.push({ reason: 'not-code', at: insn.addr });
      return true;
    default:
      return false;
  }
}
