// The acceptance rules (AcceptRule, AcceptVeto), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import pointerTableRun from './pointer-table-run.ts';
import prologueAndCallsAccepted from './prologue-and-calls-accepted.ts';
import prologueAndEndAnchored from './prologue-and-end-anchored.ts';
import prologueAndLoaded from './prologue-and-loaded.ts';
import tilesAfterAccepted from './tiles-after-accepted.ts';
import tinyAnchoredAtStart from './tiny-anchored-at-start.ts';

export const ACCEPT_RULES = {
  'accept.tiles-after-accepted': tilesAfterAccepted,
  'accept.prologue-and-loaded': prologueAndLoaded,
  'accept.prologue-and-end-anchored': prologueAndEndAnchored,
  'accept.pointer-table-run': pointerTableRun,
  'accept.prologue-and-calls-accepted': prologueAndCallsAccepted,
  'accept.tiny-anchored-at-start': tinyAnchoredAtStart,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'accept'>>>;
