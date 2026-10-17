// The bl verdict rules (BlVerdictRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import nearIsCall from './near-is-call.ts';
import noreturnBeforeNoncode from './noreturn-before-noncode.ts';
import selfOrAccepted from './self-or-accepted.ts';
import targetBeforeEntry from './target-before-entry.ts';
import targetHasPrologue from './target-has-prologue.ts';
import targetInsideCaller from './target-inside-caller.ts';
import targetPopsUnpushedFrame from './target-pops-unpushed-frame.ts';

export const BL_RULES = {
  'bl.self-or-accepted': selfOrAccepted,
  'bl.target-before-entry': targetBeforeEntry,
  'bl.near-is-call': nearIsCall,
  'bl.target-inside-caller': targetInsideCaller,
  'bl.target-has-prologue': targetHasPrologue,
  'bl.target-pops-unpushed-frame': targetPopsUnpushedFrame,
  'bl.noreturn-before-noncode': noreturnBeforeNoncode,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'bl'>>>;
