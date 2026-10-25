// sig.link-order-run (the PoC's step 2, romlift-poc/src/signatures/apply.ts): members that follow each other in one
// reference's link order and tile the ROM contiguously (each starts at the previous one's end, aligned) form a run;
// the runs of a chain are taken longest first, by unmasked bytes, when a run carries at least
// policy.minUnmaskedBytes unmasked bytes and two members, none of them placed elsewhere and not all placed already.
// The four-byte BIOS call stubs and libgcc's thunks are nothing alone; a run of them in link order is the library.
// A run that would place a table whose pointers name other addresses is not taken.
import { alignUp, placeMember, placedAt, pointersAgree } from './state.ts';
import type { Chain, ChainRule, Member, VersionState } from './state.ts';

interface Run {
  readonly members: readonly { readonly member: Member; readonly at: number }[];
  readonly unmasked: number;
}

/** The run from link `i` at `at`, through the nearest later link that continues it each time. */
function runFrom(state: VersionState, chain: Chain, i: number, at: number, memo: Map<string, Run>): Run {
  const key = `${i}:${at}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  const member = chain.links[i]?.member;
  if (member === undefined) return { members: [], unmasked: 0 };
  let best: Run = { members: [{ member, at }], unmasked: member.unmasked };
  const end = at + member.size;
  for (let j = i + 1; j < chain.links.length; j++) {
    const next = chain.links[j]?.member;
    if (next === undefined) continue;
    const want = alignUp(end, next.align);
    const placed = placedAt(state, next);
    if (placed !== undefined ? placed !== want : !next.candidates.includes(want)) continue;
    const rest = runFrom(state, chain, j, want, memo);
    if (rest.unmasked + member.unmasked > best.unmasked) best = { members: [{ member, at }, ...rest.members], unmasked: rest.unmasked + member.unmasked };
    break;
  }
  memo.set(key, best);
  return best;
}

const linkOrderRun: ChainRule = {
  meta: {
    id: 'sig.link-order-run',
    summary: 'members contiguous in one reference link order and on the ROM are placed as a run, the longest first',
    restsOn:
      'the linker lays out the objects of a library archive in the order the reference links them, so members that follow each other there follow each other on every ROM that links them',
    recovers: 'short members (the BIOS call stubs, libgcc thunks) that are ambiguous alone',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'chain',
  place(state: VersionState, chain: Chain): boolean {
    const memo = new Map<string, Run>();
    const runs: Run[] = [];
    chain.links.forEach((link, i) => {
      const placed = placedAt(state, link.member);
      for (const at of placed === undefined ? link.member.candidates : [placed]) runs.push(runFrom(state, chain, i, at, memo));
    });
    runs.sort((x, y) => y.unmasked - x.unmasked);
    let any = false;
    for (const run of runs) {
      if (run.unmasked < state.policy.minUnmaskedBytes || run.members.length < 2) continue;
      const elsewhere = run.members.some(({ member, at }) => {
        const p = placedAt(state, member);
        return p !== undefined && p !== at;
      });
      if (elsewhere) continue;
      const open = run.members.filter(({ member }) => placedAt(state, member) === undefined);
      if (open.length === 0) continue;
      if (!open.every(({ member, at }) => pointersAgree(state, member, at))) continue;
      for (const { member, at } of open) placeMember(state, member, at, 'sig.link-order-run');
      any = true;
    }
    return any;
  },
};

export default linkOrderRun;
