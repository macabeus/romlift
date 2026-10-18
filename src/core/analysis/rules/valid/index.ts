// The validity rules (ValidityRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import balancedStack from './balanced-stack.ts';
import callsCode from './calls-code.ts';
import decodes from './decodes.ts';
import dense from './dense.ts';
import inRomUnclaimed from './in-rom-unclaimed.ts';
import noClaimedCode from './no-claimed-code.ts';
import notPointerTable from './not-pointer-table.ts';
import poolNotCode from './pool-not-code.ts';
import returnsOrPrologue from './returns-or-prologue.ts';

export const VALID_RULES = {
  'valid.in-rom-unclaimed': inRomUnclaimed,
  'valid.decodes': decodes,
  'valid.balanced-stack': balancedStack,
  'valid.returns-or-prologue': returnsOrPrologue,
  'valid.no-claimed-code': noClaimedCode,
  'valid.pool-not-code': poolNotCode,
  'valid.not-pointer-table': notPointerTable,
  'valid.dense': dense,
  'valid.calls-code': callsCode,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'valid'>>>;
