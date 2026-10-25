// sig.pinned-both-sides (the PoC's step 4, romlift-poc/src/signatures/apply.ts): a member of at least
// policy.pinnedMinBytes bytes whose placed neighbours on both sides, in the same reference's link order, agree on its
// address by the reference spacing is placed there when it differs from the ROM in at least one and at most
// policy.maxDiffWords aligned words. Those words are the constants a game passes into the library (m4aSoundInit's
// sound mode); the placement carries them and the matcher reports them (W_SIGNATURE_CONSTANT). Never over the bytes of
// another placed member of the version (state.ts, overlapsPlaced).
import { overlapsPlaced, placeMember, placedAt, placedNeighbours, pointersAgree, wordDiffs } from './state.ts';
import type { Chain, ChainMemberRule, VersionState } from './state.ts';

const pinnedBothSides: ChainMemberRule = {
  meta: {
    id: 'sig.pinned-both-sides',
    summary: 'a member both placed neighbours pin to one address is placed there despite a word or two of game constants',
    restsOn:
      'when both neighbours sit at their reference spacing, nothing else can occupy the bytes between them; a library function a game configures differs only in the literal words it was given',
    recovers: 'library functions that embed a game-chosen constant (sound modes, buffer sizes)',
    reads: ['rom', 'placements'],
    adds: ['placements'],
  },
  sweep: 'chain-member',
  place(state: VersionState, chain: Chain, index: number): boolean {
    const link = chain.links[index];
    if (link === undefined) return false;
    const member = link.member;
    const { prev, next } = placedNeighbours(state, chain, index);
    if (prev === undefined || next === undefined || member.size < state.policy.pinnedMinBytes) return false;
    const prevAt = placedAt(state, prev.member);
    const nextAt = placedAt(state, next.member);
    if (prevAt === undefined || nextAt === undefined) return false;
    const at = prevAt + (link.refAddr - prev.refAddr);
    if (at !== nextAt + (link.refAddr - next.refAddr)) return false;
    if (overlapsPlaced(state, member, at)) return false;
    const constants = wordDiffs(state.rom, member, at, state.policy.maxDiffWords);
    if (constants === undefined || constants.length === 0 || !pointersAgree(state, member, at)) return false;
    placeMember(state, member, at, 'sig.pinned-both-sides', constants);
    return true;
  },
};

export default pinnedBothSides;
