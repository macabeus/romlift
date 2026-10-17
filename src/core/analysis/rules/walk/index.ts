// The walk policies (WalkPolicy), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import branchIntoFunction from './branch-into-function.ts';
import bxPcVeneer from './bx-pc-veneer.ts';
import inlineArmSwitch from './inline-arm-switch.ts';
import movLrPcBxIsCall from './mov-lr-pc-bx-is-call.ts';
import movPcWithoutTable from './mov-pc-without-table.ts';
import noreturnCallBeforeNoncode from './noreturn-call-before-noncode.ts';
import pcLoadIsPool from './pc-load-is-pool.ts';
import swiBeforeNoncode from './swi-before-noncode.ts';
import tableByRegister from './table-by-register.ts';
import trailingZeroPadding from './trailing-zero-padding.ts';

export const WALK_RULES = {
  'walk.pc-load-is-pool': pcLoadIsPool,
  'walk.table-by-register': tableByRegister,
  'walk.mov-lr-pc-bx-is-call': movLrPcBxIsCall,
  'walk.mov-pc-without-table': movPcWithoutTable,
  'walk.bx-pc-veneer': bxPcVeneer,
  'walk.inline-arm-switch': inlineArmSwitch,
  'walk.branch-into-function': branchIntoFunction,
  'walk.trailing-zero-padding': trailingZeroPadding,
  'walk.noreturn-call-before-noncode': noreturnCallBeforeNoncode,
  'walk.swi-before-noncode': swiBeforeNoncode,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'walk'>>>;
