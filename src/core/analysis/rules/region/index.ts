// The region rules (RegionRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import dataAfterCode from './data-after-code.ts';
import padding from './padding.ts';
import startup from './startup.ts';

export const REGION_RULES = {
  'region.data-after-code': dataAfterCode,
  'region.padding': padding,
  'region.startup': startup,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'region'>>>;
