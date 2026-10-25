// The signature placement rules (architecture §4.1 "sig", §7.2, D7): one file per rule beside this index, each with
// its metadata, keyed by id (the SignatureRuleId union of ../schema.ts). The order they run in is policy.ts's
// SIGNATURE_RULE_ORDER, never this record's. SIGNATURE_RULES holds their metadata (explain merges it with the analysis
// RULES to print rule meta; g6.explain-coverage requires exactly SIGNATURE_RULE_IDS); PLACEMENT_RULES the rules
// themselves, which only match.ts runs.
import type { RuleMeta } from '../../provenance/rule-id.ts';
import type { SignatureRuleId } from '../schema.ts';
import linkOrderRun from './link-order-run.ts';
import neighbourSpacing from './neighbour-spacing.ts';
import pinnedBothSides from './pinned-both-sides.ts';
import shortMemberWindow from './short-member-window.ts';
import type { SignatureRule } from './state.ts';
import uniqueFit from './unique-fit.ts';

export const PLACEMENT_RULES: Readonly<Record<SignatureRuleId, SignatureRule>> = {
  'sig.unique-fit': uniqueFit,
  'sig.link-order-run': linkOrderRun,
  'sig.neighbour-spacing': neighbourSpacing,
  'sig.pinned-both-sides': pinnedBothSides,
  'sig.short-member-window': shortMemberWindow,
};

export const SIGNATURE_RULES: Readonly<Record<string, RuleMeta>> = {
  'sig.unique-fit': uniqueFit.meta,
  'sig.link-order-run': linkOrderRun.meta,
  'sig.neighbour-spacing': neighbourSpacing.meta,
  'sig.pinned-both-sides': pinnedBothSides.meta,
  'sig.short-member-window': shortMemberWindow.meta,
};
