// The Thumb walk (the PoC's analyzeThumb): recursive descent over a LIFO of (pc, sp) paths, decoding
// through foundation/isa and tracking the stack delta from each row's `stack` function. Every decision a
// walk rule names goes through the walk slot (first answer wins); without an answer the decoder's Flow
// decides (types.ts, WalkStep). The bl verdicts come from the settle loop: `far` sites are walked as
// jumps, `noret` sites end their path.
import { decode, fieldsOf, rowFor, thumbWordAt } from '../../../foundation/isa/decode.ts';
import type { Insn } from '../../../foundation/isa/types.ts';
import { contains, u32 } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import { insnAligned } from '../../../foundation/rom/span.ts';
import type { RuleId } from '../../provenance/rule-id.ts';
import { toRun } from '../address-map.ts';
import { LIMITS } from '../limits.ts';
import { DECODER_FLOW } from '../types.ts';
import type { Reading, WalkStep } from '../types.ts';
import { walkArm } from './arm.ts';
import { askWalk, asksWalk, toLoadInsn, walkCursor } from './cursor.ts';
import { WalkRecord } from './record.ts';
import type { MutableCursor, WalkCursor, WalkEnv } from './cursor.ts';

/** The Thumb instruction at load address `pc`. */
export function decodeThumbAt(env: WalkEnv, pc: Addr): Insn {
  const { addresses } = env.view;
  return toLoadInsn(decode('thumb', thumbWordAt(env.view.rom, pc), toRun(addresses, pc)), addresses, pc);
}

interface Path {
  readonly rec: WalkRecord;
  readonly env: WalkEnv;
  /** The addresses of the current path's straight-line run; the cursor decodes them when a rule reads `run`. */
  readonly run: Addr[];
  readonly work: [pc: Addr, sp: number][];
  readonly cursor: MutableCursor;
}

function cursorFor(path: Path, insn: Insn, sp: number, phase: 'insn' | 'stop', at: Addr, stop?: 'invalid' | 'pool'): WalkCursor {
  const c = path.cursor;
  c.phase = phase;
  c.stop = stop;
  c.at = at;
  c.sp = sp;
  c.conditional = insn.flow.kind === 'branch' && insn.flow.conditional;
  return c;
}

/** A Thumb path stopped at non-code `pc`: padding is dropped, then a bl or swi before it ends the path. */
function stopAt(path: Path, pc: Addr, sp: number, stop: 'invalid' | 'pool'): void {
  const { rec, run } = path;
  for (;;) {
    const at = run[run.length - 1];
    if (at === undefined) break;
    const last = decodeThumbAt(path.env, at);
    const answer = askWalk(path.env, last, cursorFor(path, last, sp, 'stop', pc, stop));
    if (answer?.step.step === 'padding') {
      rec.step(last.addr, answer.id, answer.step);
      rec.drop(last.addr);
      run.pop();
      continue;
    }
    if (answer?.step.step === 'end-path' && answer.step.exit === 'noreturn-call') {
      rec.step(last.addr, answer.id, answer.step);
      rec.deadEnd.push(last.addr);
      rec.exit(last.addr, 'noreturn-call', answer.id);
      return;
    }
    if (answer?.step.step === 'end-path' && answer.step.exit === 'swi-end') {
      rec.step(last.addr, answer.id, answer.step);
      rec.returns += 1;
      rec.exit(last.addr, 'swi-end', answer.id);
      return;
    }
    break;
  }
  rec.errors.push({ reason: 'not-code', at: pc });
}

/** Counts an exit; true when the path ends here. */
function exitHere(path: Path, insn: Insn, sp: number, kind: 'return' | 'tail' | 'reg-jump', rule: RuleId): boolean {
  const { rec } = path;
  if (kind === 'tail' && insn.flow.kind === 'branch') {
    const target = insn.flow.target;
    if (path.env.view.isFunction(target)) rec.calls.push({ site: insn.addr, target, mode: 'thumb' });
    rec.tailExits += 1;
    rec.tails.push(target);
  }
  rec.returns += 1;
  rec.balance.push(sp);
  rec.exit(insn.addr, kind, rule);
  return !(insn.flow.kind === 'branch' && insn.flow.conditional);
}

/** Applies a policy's answer; true when the path ends here. */
function apply(path: Path, insn: Insn, sp: number, id: RuleId, step: WalkStep): boolean {
  const { rec, env } = path;
  const rom = env.view.rom;
  rec.step(insn.addr, id, step);
  switch (step.step) {
    case 'pool':
      if (!contains(rom, step.addr, 4)) {
        rec.errors.push({ reason: 'pool-out-of-rom', at: insn.addr });
        return true;
      }
      rec.pool(step.addr, u32(rom, step.addr));
      return false;
    case 'table':
      rec.tables.push(step.table);
      for (const t of step.table.targets) path.work.push([t, sp]);
      return true;
    case 'switch-mode':
      rec.veneers.push(step.target);
      rec.returns += 1;
      rec.balance.push(sp);
      rec.exit(insn.addr, 'return', id);
      return true;
    case 'continue':
    case 'padding':
      return false;
    case 'end-path':
      return exitHere(path, insn, sp, step.exit === 'tail' || step.exit === 'reg-jump' ? step.exit : 'return', id);
    case 'arm-tail': {
      // The ARM code is walked for its extent only; it stays free for its own discovery.
      const tail = walkArm(env, step.target);
      if (tail.errors.length === 0 && tail.returns > 0 && tail.insns.length > 0) rec.armTails.push({ start: step.target, end: tail.end });
      return exitHere(path, insn, sp, 'reg-jump', id);
    }
  }
}

/** The decoder's Flow when no policy answered; true when the path ends here. */
function follow(path: Path, insn: Insn, sp: number): boolean {
  const { rec } = path;
  const flow = insn.flow;
  switch (flow.kind) {
    case 'branch':
      rec.branchTargets.push(flow.target);
      path.work.push([flow.target, sp]);
      return !flow.conditional;
    case 'return':
    case 'mode-switch':
      return exitHere(path, insn, sp, 'return', DECODER_FLOW);
    case 'indirect':
      if (flow.via === 'bx') return exitHere(path, insn, sp, 'reg-jump', DECODER_FLOW);
      rec.errors.push({ reason: 'not-code', at: insn.addr });
      return true;
    default:
      return false;
  }
}

/** The bl at `insn`, as the settle loop decided it; true when the path ends here. */
function call(path: Path, insn: Insn, sp: number, target: Addr, far: ReadonlySet<Addr>, noret: ReadonlyMap<Addr, RuleId>): boolean {
  const { rec, env } = path;
  if (!contains(env.view.rom, target)) {
    rec.errors.push({ reason: 'bl-out-of-rom', at: insn.addr });
    return true;
  }
  if (far.has(insn.addr)) {
    path.work.push([target, sp]);
    return true;
  }
  rec.blSites.push({ site: insn.addr, target });
  rec.calls.push({ site: insn.addr, target, mode: 'thumb' });
  const rule = noret.get(insn.addr);
  if (rule === undefined) return false;
  rec.exit(insn.addr, 'noreturn-call', rule);
  return true;
}

/** Walks the Thumb function at `entry` under the current claims and function set. */
export function walkThumb(env: WalkEnv, entry: Addr, far: ReadonlySet<Addr>, noret: ReadonlyMap<Addr, RuleId>): Reading {
  const { view } = env;
  const rom = view.rom;
  const rec = new WalkRecord(entry, 'thumb', env.trace === true);
  const work: [Addr, number][] = [[entry, 0]];
  const runs = { current: [] as Addr[] };
  const cursor = walkCursor(view, entry, 'thumb', (a) => rec.insns.has(a), () => runs.current, (a) => decodeThumbAt(env, a));
  for (let item = work.pop(); item !== undefined; item = work.pop()) {
    let [pc, sp] = item;
    let zeros = 0;
    const path: Path = { rec, env, run: [], work, cursor };
    runs.current = path.run;
    while (!rec.insns.has(pc)) {
      if (pc !== entry && view.isFunction(pc)) break; // fell into the next function
      if (!contains(rom, pc, 2) || !insnAligned('thumb', pc)) {
        rec.errors.push({ reason: 'out-of-rom', at: pc });
        break;
      }
      const pool = rec.pools.size !== 0 && (rec.pools.has(pc) || rec.pools.has(pc & ~3));
      const word = thumbWordAt(rom, pc);
      const row = rowFor('thumb', word);
      const spec = row.spec;
      if (pool || spec.flow === 'invalid') {
        stopAt(path, pc, sp, pool ? 'pool' : 'invalid');
        break;
      }
      // A path over more than LIMITS.zeroRun zero halfwords is in a zero-filled region: not code.
      zeros = (word & 0xffff) === 0 ? zeros + 1 : 0;
      if (zeros > LIMITS.zeroRun) {
        rec.errors.push({ reason: 'zero-run', at: pc });
        break;
      }
      if (!rec.insn(pc, spec.size)) {
        work.length = 0;
        break;
      }
      path.run.push(pc);
      if (spec.stack !== undefined) sp += spec.stack(fieldsOf(row, spec.size === 2 ? word & 0xffff : word));
      if (spec.flow === 'next') {
        // The decoder's Flow is next: no rule is asked, nothing but the stack is recorded.
        pc += spec.size;
        continue;
      }
      const insn = decodeThumbAt(env, pc);
      let ends: boolean;
      if (insn.flow.kind === 'bl') ends = call(path, insn, sp, insn.flow.target, far, noret);
      else if (insn.flow.kind === 'adr') {
        rec.adrs.push(insn.flow.target);
        ends = false;
      } else if (asksWalk(insn.flow)) {
        const answer = askWalk(env, insn, cursorFor(path, insn, sp, 'insn', pc));
        ends = answer === undefined ? follow(path, insn, sp) : apply(path, insn, sp, answer.id, answer.step);
      } else ends = false;
      if (ends) break;
      pc += insn.size;
    }
  }
  return rec.finish(env);
}
