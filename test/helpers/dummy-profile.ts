// The dummy profile of g2.second-profile (architecture §4.3): agbcc's idioms with other numbers and a
// reordered validity slot, typed as a CompilerProfile so a second profile always typechecks against
// the frozen interface. Its far-jump idiom reads its own distance, so the numbers it changes are the
// ones it runs with. Rule tests use it to prove a rule reads its constants through `v.profile`.
import { AGBCC } from '../../src/core/profile/agbcc.ts';
import type { CompilerProfile } from '../../src/core/profile/types.ts';
import type { RuleId } from '../../src/core/provenance/rule-id.ts';

/** agbcc's validity slot with its last two rules swapped (the gate's reorder). */
function reordered(ids: readonly RuleId[]): readonly RuleId[] {
  const out = [...ids];
  const last = out.length - 1;
  const a = out[last - 1];
  const b = out[last];
  if (a !== undefined && b !== undefined) [out[last - 1], out[last]] = [b, a];
  return out;
}

const FAR_JUMP = { minDistance: AGBCC.farJump.minDistance * 2, requiresPushedLr: true } as const;

export const DUMMY_PROFILE: CompilerProfile = {
  ...AGBCC,
  id: 'dummy',
  pipeline: { ...AGBCC.pipeline, validity: reordered(AGBCC.pipeline.validity) },
  farJump: FAR_JUMP,
  density: { minHoles: AGBCC.density.minHoles * 2, holeShift: AGBCC.density.holeShift + 1 },
  pointerTableRun: AGBCC.pointerTableRun + 1,
  tinyFunctionInsns: AGBCC.tinyFunctionInsns + 1,
  anchorSlack: 1,
  gapScan: {
    backwardWindow: 64,
    fillSlack: 1,
    armFrontPoolWords: 2,
    armMinInsnsForSkip: 4,
    prologueDistance: 64,
    minInsns: 4,
  },
  idioms: {
    ...AGBCC.idioms,
    matchFarJump: (site, caller) => Math.abs(site.target - site.site) >= FAR_JUMP.minDistance && (!FAR_JUMP.requiresPushedLr || caller.prologue),
  },
};
