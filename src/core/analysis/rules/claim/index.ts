// The claim rules (ClaimRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import adjacentPools from './adjacent-pools.ts';
import deadCodeInExtent from './dead-code-in-extent.ts';
import farPools from './far-pools.ts';

export const CLAIM_RULES = {
  'claim.adjacent-pools': adjacentPools,
  'claim.far-pools': farPools,
  'claim.dead-code-in-extent': deadCodeInExtent,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'claim'>>>;
