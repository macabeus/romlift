// sig.short-member-window (the PoC's step 3b, romlift-poc/src/signatures/apply.ts): a member that another reference
// contributed has no placed neighbours of its own chain; it is still placed at the only candidate within
// policy.window bytes of any placed member of the same version that overlaps none of them. Never a twin (state.ts,
// Member.twin): its bytes fit wherever its twin lies.
import { placeMember, pointersAgree } from './state.ts';
import type { Member, MemberRule, VersionState } from './state.ts';

const shortMemberWindow: MemberRule = {
  meta: {
    id: 'sig.short-member-window',
    summary: 'a member with no placed neighbours of its own is placed at its only fit within a few words of the placed library',
    restsOn: 'a library is linked as one block, so a member of it sits next to other members of the same version',
    recovers: 'short members only one reference links, between members another reference placed',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'listed',
  place(state: VersionState, member: Member): boolean {
    if (member.twin || member.candidates.length === 0) return false;
    const window = state.policy.window;
    const placed = state.members.flatMap((m) => {
      const p = state.placed.get(m.index);
      return p === undefined ? [] : [{ start: p.addr, end: p.addr + m.size }];
    });
    const near = member.candidates.filter((c) => {
      const end = c + member.size;
      const close = placed.some((p) => (c >= p.end && c - p.end <= window) || (end <= p.start && p.start - end <= window));
      return close && !placed.some((p) => c < p.end && p.start < end);
    });
    const at = near.length === 1 ? near[0] : undefined;
    if (at === undefined || !pointersAgree(state, member, at)) return false;
    placeMember(state, member, at, 'sig.short-member-window');
    return true;
  },
};

export default shortMemberWindow;
