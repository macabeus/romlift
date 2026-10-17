// Every analysis rule, keyed by id: the eight family records concatenated (architecture §4.1). Only
// driver/ imports this file; the driver resolves the profile's pipeline against it once per run.
import type { RuleRegistry } from '../types.ts';
import { ACCEPT_RULES } from './accept/index.ts';
import { BL_RULES } from './bl/index.ts';
import { CLAIM_RULES } from './claim/index.ts';
import { GAP_RULES } from './gap/index.ts';
import { REGION_RULES } from './region/index.ts';
import { SEED_RULES } from './seed/index.ts';
import { VALID_RULES } from './valid/index.ts';
import { WALK_RULES } from './walk/index.ts';

export const RULES: RuleRegistry = {
  ...SEED_RULES,
  ...WALK_RULES,
  ...BL_RULES,
  ...VALID_RULES,
  ...ACCEPT_RULES,
  ...GAP_RULES,
  ...CLAIM_RULES,
  ...REGION_RULES,
};
