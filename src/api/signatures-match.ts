// The signature matcher (architecture §7.2, §7.3, roadmap 6.B), exported from `romlift` by its owner,
// p6-signatures-match (D93): matchSignatures places each library version's members on a ROM with their sig.* rule,
// resolvePlacements settles overlaps and yields the library regions, proposeFromSignatures turns the settled
// placements into Proposals (signatures propose; the TOML decides, D9).
export { matchSignatures } from '../core/signatures/match.ts';
export type { PlacedMemberRef, SignatureMatch } from '../core/signatures/match.ts';
export { resolvePlacements } from '../core/signatures/resolve.ts';
export type { ResolvedSignatures } from '../core/signatures/resolve.ts';
export { proposeFromSignatures } from '../core/signatures/propose.ts';
export type { SignaturePolicy, SignatureStage } from '../core/signatures/policy.ts';
