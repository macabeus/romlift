// The ARM walk (the PoC's analyzeArm): recursive descent over a LIFO of paths with no stack tracking,
// decoding through foundation/isa, whose rows are the only source of the flow classes (architecture §5).
// The PoC classed a few encodings otherwise (`add/sub pc, pc, #imm` as adr, the encodings the ARMv4T
// leaves undefined as other or pc_write; test/local/poc-decoder-differential.test.ts lists them); the
// walk follows the table, which changed no reading on the five original tuning ROMs or the synthetic
// fixtures when it was measured (D59). Re-measured on tmc (18 October 2026, every instruction of the
// accepted ARM readings of the six tuning ROMs decoded): one instruction is classed otherwise, an
// `add pc, pc, #imm` that ends the reading of one listed false entry of tmc, where the PoC's class (adr)
// would have read on into the next function; no other accepted ARM reading holds such an encoding.
import { decode, isConditional, rowFor } from '../../../foundation/isa/decode.ts';
import type { Insn } from '../../../foundation/isa/types.ts';
import { contains, u32 } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { insnAligned } from '../../../foundation/rom/span.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { toRun } from '../address-map.ts';
import { LIMITS } from '../limits.ts';
import { DECODER_FLOW } from '../types.ts';
import type { Reading, WalkStep } from '../types.ts';
import { askWalk, asksWalk, externalTarget, toLoadInsn, walkCursor } from './cursor.ts';
import type { WalkEnv } from './cursor.ts';
import { WalkRecord } from './record.ts';

/** The ARM instruction at load address `pc`, its Flow's targets at load addresses. */
export function decodeArmAt(env: WalkEnv, pc: Addr): Insn {
  const { rom, addresses } = env.view;
  return toLoadInsn(decode('arm', u32(rom, pc), toRun(addresses, pc)), addresses, pc);
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
    let zeros = 0;
    const run: Addr[] = [];
    runs.current = run;
    while (!rec.insns.has(pc)) {
      if (pc !== entry && view.isBoundary(pc)) break;
      if (view.inDataOverride(pc)) break; // a data override, which no walk enters (correctness-b0-3)
      if (!contains(rom, pc, 4) || !insnAligned('arm', pc) || rec.pools.has(pc)) {
        rec.errors.push({ reason: 'not-code', at: pc });
        break;
      }
      const word = u32(rom, pc);
      // A path over more than LIMITS.zeroRun zero words is in a zero-filled region: not code.
      zeros = word === 0 ? zeros + 1 : 0;
      if (zeros > LIMITS.zeroRun) {
        rec.errors.push({ reason: 'zero-run', at: pc });
        break;
      }
      // A row whose Flow is next needs no decode: nothing to ask or record but the instruction.
      const insn = rowFor('arm', word).spec.flow === 'next' ? undefined : decodeArmAt(env, pc);
      if (insn?.flow.kind === 'invalid') {
        rec.errors.push({ reason: 'not-code', at: pc });
        break;
      }
      if (!rec.insn(pc, 4)) {
        work.length = 0;
        break;
      }
      run.push(pc);
      if (insn === undefined) {
        pc += 4;
        continue;
      }
      const conditional = isConditional(insn);
      const flow = insn.flow;
      let ends = false;
      if (flow.kind === 'bl') {
        // A bl from a runs_at range to RAM outside every range returns like any call and names no function (§6.7).
        if (!externalTarget(view, pc, flow.target)) rec.calls.push({ site: pc, target: flow.target, mode: 'arm' });
      } else if (flow.kind === 'adr') rec.adrs.push(flow.target);
      else if (asksWalk(flow)) {
        cursor.at = pc;
        cursor.conditional = conditional;
        const answer = askWalk(env, insn, cursor);
        ends = answer === undefined ? follow(rec, insn, conditional, work, isFunction, env) : apply(rec, insn, conditional, answer.id, answer.step, work, isFunction, env);
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

function follow(rec: WalkRecord, insn: Insn, conditional: boolean, work: Addr[], isFunction: (a: Addr) => boolean, env: WalkEnv): boolean {
  const flow = insn.flow;
  switch (flow.kind) {
    case 'branch':
      // A branch from a runs_at range to RAM outside every range leaves the function (§6.7).
      if (externalTarget(env.view, insn.addr, flow.target)) return exitHere(rec, insn, conditional, 'tail', DECODER_FLOW, isFunction);
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
