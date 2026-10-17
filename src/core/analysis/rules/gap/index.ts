// The gap rules (GapAbsorb, GapHead, GapProposer, GapPrefer, GapSkip), keyed by rule id. Each rule is one file of this directory; only this index imports
// them, and only rules/index.ts imports this index (architecture §2, §4.1). Order lives in the profile.
import type { RuleId } from '../../../provenance/rule-id.ts';
import type { FamilyRule } from '../../types.ts';
import adrBlockAbsorb from './adr-block-absorb.ts';
import armOverProloguelessThumb from './arm-over-prologueless-thumb.ts';
import armScan from './arm-scan.ts';
import backwardPrologueChain from './backward-prologue-chain.ts';
import endAnchor from './end-anchor.ts';
import forwardChain from './forward-chain.ts';
import skipPaddingAndPointers from './skip-padding-and-pointers.ts';
import tiledHoleInner from './tiled-hole-inner.ts';
import tiledHole from './tiled-hole.ts';

export const GAP_RULES = {
  'gap.adr-block-absorb': adrBlockAbsorb,
  'gap.arm-over-prologueless-thumb': armOverProloguelessThumb,
  'gap.arm-scan': armScan,
  'gap.backward-prologue-chain': backwardPrologueChain,
  'gap.end-anchor': endAnchor,
  'gap.forward-chain': forwardChain,
  'gap.skip-padding-and-pointers': skipPaddingAndPointers,
  'gap.tiled-hole': tiledHole,
  'gap.tiled-hole-inner': tiledHoleInner,
} as const satisfies Readonly<Record<RuleId, FamilyRule<'gap'>>>;
