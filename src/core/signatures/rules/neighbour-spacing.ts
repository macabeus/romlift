// sig.neighbour-spacing (the PoC's step 3, romlift-poc/src/signatures/apply.ts): a member of a chain whose placed
// neighbours in the same reference's link order fix where it belongs is placed at the first of: the reference spacing
// from the previous placed neighbour, right after it, the reference spacing from the next one, right before it, and
// the only candidate within policy.window bytes of a neighbour, that lies between the two neighbours and fits.
// Spacing and order only mean something between members of one reference. A table whose pointers name other
// addresses at the first such place is not placed (sig.pinned-both-sides may still pin it).
import { alignUp, fits, placeMember, placedAt, placedNeighbours, pointersAgree } from './state.ts';
import type { Chain, ChainMemberRule, VersionState } from './state.ts';

const neighbourSpacing: ChainMemberRule = {
  meta: {
    id: 'sig.neighbour-spacing',
    summary: 'a member is placed where its placed link-order neighbours put it: reference spacing, adjacency, or the only fit nearby',
    restsOn:
      'objects of one archive keep their link order and, mostly, their spacing; a member between two placed neighbours of its reference can only sit between them',
    recovers: 'members too short or too common to fit once, next to members already placed',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'chain-member',
  place(state: VersionState, chain: Chain, index: number): boolean {
    const link = chain.links[index];
    if (link === undefined) return false;
    const member = link.member;
    const { prev, next } = placedNeighbours(state, chain, index);
    const prevAt = prev === undefined ? undefined : placedAt(state, prev.member);
    const nextAt = next === undefined ? undefined : placedAt(state, next.member);
    if (prevAt === undefined && nextAt === undefined) return false;
    const want: number[] = [];
    if (prev !== undefined && prevAt !== undefined) want.push(prevAt + (link.refAddr - prev.refAddr), alignUp(prevAt + prev.member.size, member.align));
    if (next !== undefined && nextAt !== undefined) want.push(nextAt + (link.refAddr - next.refAddr), (nextAt - member.size) & -member.align);
    const lo = prev !== undefined && prevAt !== undefined ? prevAt + prev.member.size : -Infinity;
    const hi = nextAt ?? Infinity;
    const window = state.policy.window;
    const near = member.candidates.filter((c) => c >= lo && c + member.size <= hi && (c - lo <= window || hi - (c + member.size) <= window));
    const only = near.length === 1 ? near[0] : undefined;
    if (only !== undefined) want.push(only);
    for (let k = 0; k < want.length; k++) {
      const at = want[k];
      if (at === undefined || want.indexOf(at) !== k) continue;
      if (!(at >= lo && at + member.size <= hi)) continue;
      if (!(member.candidates.includes(at) || fits(state.rom, member, at))) continue;
      if (!pointersAgree(state, member, at)) return false;
      placeMember(state, member, at, 'sig.neighbour-spacing');
      return true;
    }
    return false;
  },
};

export default neighbourSpacing;
