// D8's resettle stage (architecture §4.2): after the passes, in both modes, every accepted function is read
// again under the final function set, its bl verdicts recomputed, until no reading changes. Each function
// is read with its own claims released, as when it was taken; once stable every function's reading is
// claimed again in acceptance order (the code of an entry inside another's old reading stays claimed). A
// function with absorbed blocks keeps its merged reading (an absorbed block is no reading of its own).
import { sortedKeys } from '../../../foundation/util/sorted.ts';
import { fixpointLimit, LIMITS } from '../limits.ts';
import type { Reading } from '../types.ts';
import { Claim } from '../types.ts';
import { claim, write } from './accept.ts';
import { beginEpoch } from './epoch.ts';
import { analyzeArm, settle } from './settle.ts';
import type { DriverState } from './state.ts';

function shape(r: Reading): string {
  return JSON.stringify([r.mode, r.insns.map((i) => [i.addr, i.len]), r.pools.map((p) => p.addr), r.codeEnd, r.end, r.far, r.noret]);
}

/** Re-reads every accepted function until stable; returns how many readings changed in all. */
export function resettle(s: DriverState): number {
  let changes = 0;
  for (let round = 0; ; round++) {
    if (round === LIMITS.fixpointRounds) {
      s.diagnostics.push(fixpointLimit('the resettle stage', round));
      break;
    }
    beginEpoch(s);
    const entries = sortedKeys(s.funcs);
    for (const e of entries) if (s.funcs.get(e)?.absorbed.length === 0) s.settled.delete(e);
    let changed = 0;
    for (const e of entries) {
      const f = s.funcs.get(e);
      if (f === undefined || f.absorbed.length > 0) continue;
      // The function's own claims are released while it is read again, as they were when it was taken.
      const old = f.reading;
      const freed = [...old.insns.map((i) => ({ start: i.addr, end: i.addr + i.len })), ...old.pools.map((p) => ({ start: p.addr, end: p.addr + 4 })), { start: old.entry, end: old.end }];
      const saved = freed.map((sp) => ({ sp, bytes: s.claims.slice(Math.max(sp.start - s.rom.base, 0), Math.max(sp.end - s.rom.base, 0)) }));
      for (const sp of freed) write(s, { span: sp, kind: Claim.free, when: 'always' });
      const r = old.mode === 'thumb' ? settle(s, e) : analyzeArm(s, e);
      if (shape(r) !== shape(old)) {
        f.reading = r;
        changed += 1;
        claim(s, e, r);
      } else for (const { sp, bytes } of saved) s.claims.set(bytes, Math.max(sp.start - s.rom.base, 0));
    }
    changes += changed;
    if (changed === 0) break;
  }
  if (changes > 0) {
    for (const e of s.order) {
      const f = s.funcs.get(e);
      if (f !== undefined) claim(s, e, f.reading);
    }
  }
  s.ownerIndex = undefined;
  return changes;
}
