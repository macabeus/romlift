// sig.link-order-run (the PoC's step 2, romlift-poc/src/signatures/apply.ts): members that follow each other in one
// reference's link order and tile the ROM contiguously (each starts at the previous one's end, aligned) form a run;
// the runs are taken longest first, by unmasked bytes, when a run carries at least policy.minUnmaskedBytes unmasked
// bytes and two members, none of them placed elsewhere and not all placed already. The four-byte BIOS call stubs and
// libgcc's thunks are nothing alone; a run of them in link order is the library. A run that would place a table whose
// pointers name other addresses is not taken.
//
// Four refinements of the PoC's step (phase 6's closing run, docs/phase-6.md): the runs of every chain of the version
// are weighed together (ties in chain, then link order), not one chain after another, so one reference's short run
// does not take bytes another reference's longer run explains; an object is linked whole, so a run skips a link (a
// member this ROM does not link there) only when the skipped member's object is neither the object of the member
// before the gap nor the object of the member after it; where one object ends and the next begins, the next starts at
// its own alignment or at the next word, the padding the linker puts before a word-aligned input section; and a run
// never places a member over the bytes of a member of the version already placed, nor a member whose every byte is
// masked without a pointer that proves it (state.ts, overlapsPlaced and evidenced).
import { alignUp, evidenced, objectOf, overlapsPlaced, placeMember, placedAt, pointersAgree } from './state.ts';
import type { Chain, ChainRule, Member, VersionState } from './state.ts';

interface Run {
  readonly members: readonly { readonly member: Member; readonly at: number }[];
  readonly unmasked: number;
}

/** Where `next` may start after `member` ends at `end`: its alignment, and the next word across an object border. */
function startsAfter(member: Member, next: Member, end: number): readonly number[] {
  const aligned = alignUp(end, next.align);
  const word = alignUp(end, 4);
  return objectOf(member.id) !== objectOf(next.id) && word !== aligned ? [aligned, word] : [aligned];
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
  const own = objectOf(member.id);
  const skipped = new Set<string>();
  for (let j = i + 1; j < chain.links.length; j++) {
    const before = chain.links[j - 1]?.member;
    if (j > i + 1 && before !== undefined) skipped.add(objectOf(before.id));
    if (skipped.has(own)) break;
    const next = chain.links[j]?.member;
    if (next === undefined || skipped.has(objectOf(next.id))) continue;
    const placed = placedAt(state, next);
    const want = startsAfter(member, next, end).find((a) => (placed !== undefined ? placed === a : next.candidates.includes(a)));
    if (want === undefined) continue;
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
      'the linker lays out the objects of a library archive in the order the reference links them, each object whole, so members that follow each other there follow each other on every ROM that links them',
    recovers: 'short members (the BIOS call stubs, libgcc thunks) that are ambiguous alone',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'chains',
  place(state: VersionState): boolean {
    const runs: Run[] = [];
    for (const chain of state.chains) {
      const memo = new Map<string, Run>();
      chain.links.forEach((link, i) => {
        const placed = placedAt(state, link.member);
        for (const at of placed === undefined ? link.member.candidates : [placed]) runs.push(runFrom(state, chain, i, at, memo));
      });
    }
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
      if (open.some(({ member, at }) => overlapsPlaced(state, member, at) || !evidenced(state, member, at))) continue;
      if (!open.every(({ member, at }) => pointersAgree(state, member, at))) continue;
      for (const { member, at } of open) placeMember(state, member, at, 'sig.link-order-run');
      any = true;
    }
    return any;
  },
};

export default linkOrderRun;
