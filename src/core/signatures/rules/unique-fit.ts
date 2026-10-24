// sig.unique-fit (the PoC's step 1, romlift-poc/src/signatures/apply.ts): a member free to be searched for alone (it
// has an anchor word and at least policy.minUnmaskedBytes unmasked bytes) that fits at exactly one place of the ROM is
// placed there, largest members first. A table is placed only when its pointers name the functions already placed.
import { placeMember, pointersAgree } from './state.ts';
import type { Member, MemberRule, VersionState } from './state.ts';

const uniqueFit: MemberRule = {
  meta: {
    id: 'sig.unique-fit',
    summary: 'a member with enough unmasked bytes that fits at exactly one place is placed there, largest first',
    restsOn:
      'a library member is linked unchanged apart from the words the link fixes (masked), and twelve or more fixed bytes in one place are too specific to recur by chance',
    recovers: 'the long library functions and tables, which anchor every weaker rule',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'largest-first',
  place(state: VersionState, member: Member): boolean {
    if (!member.free || member.candidates.length !== 1) return false;
    const at = member.candidates[0];
    if (at === undefined || !pointersAgree(state, member, at)) return false;
    placeMember(state, member, at, 'sig.unique-fit');
    return true;
  },
};

export default uniqueFit;
