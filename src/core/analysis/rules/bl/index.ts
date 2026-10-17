// The bl verdict rules (BlVerdictRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';

export const BL_RULES = {} as const satisfies Readonly<Record<RuleId, FamilyRule<'bl'>>>;
