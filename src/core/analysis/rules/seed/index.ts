// The seed rules (SeedRule, HarvestRule, QueueRule), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import adr from './adr.ts';
import call from './call.ts';
import dataPointer from './data-pointer.ts';
import evidenceHint from './evidence-hint.ts';
import listed from './listed.ts';
import override from './override.ts';
import poolPointer from './pool-pointer.ts';
import romEntry from './rom-entry.ts';
import startupPointer from './startup-pointer.ts';
import ramCopy from './ram-copy.ts';
import veneer from './veneer.ts';

export const SEED_RULES = {
  'seed.rom-entry': romEntry,
  'seed.startup-pointer': startupPointer,
  'seed.listed': listed,
  'seed.override': override,
  'seed.evidence-hint': evidenceHint,
  'seed.pool-pointer': poolPointer,
  'seed.data-pointer': dataPointer,
  'seed.call': call,
  'seed.veneer': veneer,
  'seed.adr': adr,
  'seed.ram-copy': ramCopy,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'seed'>>>;
