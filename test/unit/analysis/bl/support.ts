// Shared builders for the bl and claim rule tests (not a test file): a driver over hand-assembled bytes
// whose walk, bl and claim slots are agbcc's and run the registered rules, optionally without some of
// them, and a direct call of one bl rule.
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { createDriver } from '../../../../src/core/analysis/driver/state.ts';
import type { DriverState } from '../../../../src/core/analysis/driver/state.ts';
import { BL_RULES } from '../../../../src/core/analysis/rules/bl/index.ts';
import { CLAIM_RULES } from '../../../../src/core/analysis/rules/claim/index.ts';
import { WALK_RULES } from '../../../../src/core/analysis/rules/walk/index.ts';
import type { BlVerdictRule, RuleRegistry } from '../../../../src/core/analysis/types.ts';
import { AGBCC } from '../../../../src/core/profile/agbcc.ts';
import type { CompilerProfile } from '../../../../src/core/profile/types.ts';
import { registry, testProfile, tuningFor } from '../../../helpers/analysis.ts';

/** The walk, bl and claim rules as registered. */
export const OURS: RuleRegistry = registry(...Object.values(WALK_RULES), ...Object.values(BL_RULES), ...Object.values(CLAIM_RULES));

/** agbcc's walk, bl and claim slots, without `drop`. */
export function profileWithout(...drop: readonly RuleId[]): CompilerProfile {
  const keep = (ids: readonly RuleId[]): readonly RuleId[] => ids.filter((id) => !drop.includes(id));
  return testProfile({ walk: keep(AGBCC.pipeline.walk), bl: keep(AGBCC.pipeline.bl), claim: keep(AGBCC.pipeline.claim) });
}

/** A discover-mode driver over `rom` running the registered walk, bl and claim rules (minus `drop`). */
export function driverOver(rom: Rom, ...drop: readonly RuleId[]): DriverState {
  const profile = profileWithout(...drop);
  return createDriver(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuningFor(profile, OURS), OURS);
}

/** The registered bl rule `id`. */
export function blRule(id: keyof typeof BL_RULES): BlVerdictRule {
  return BL_RULES[id];
}
