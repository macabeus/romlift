// The proposal screen and the signature layer of init and update (architecture §7.3, §7.4, roadmap 6.D),
// exported from `romlift` by its owner, p6-proposals (D93): checkProposals (the CheckProposals of
// core/workflow/types.ts, whose types api/signatures-types.ts exports; core/workflow/proposals.ts), the signature layer
// (signatureLayer, signaturesOver, foldSignatures and the helpers init and update share;
// core/workflow/signature-layer.ts, D95 b), core/layout's module planning; the explain signature part's readers.
export { checkProposals, proposalAddr } from '../core/workflow/proposals.ts';
export {
  droppedRegionNotes,
  foldSignatures,
  isDefaultName,
  librariesOf,
  libraryModuleProposals,
  signatureLayer,
  signaturesOver,
  updateProposals,
} from '../core/workflow/signature-layer.ts';
export type { LibraryModules, RomSignatures, SignatureLayer } from '../core/workflow/signature-layer.ts';
export { signatureFromConfig, signatureFromPlacements, signatureOfKey } from '../core/workflow/explain.ts';
export { freeModuleName, placeLibraries, runsAtName } from '../core/layout/infer-modules.ts';
export { planLibraryModules, planRunsAtBorders, regionsWithoutModule } from '../core/layout/module-proposals.ts';
export type { LibraryModuleDrop, LibraryModulePlan, ModuleAt, RunsAtBorderPlan, RunsAtOverride, RunsAtRefusal } from '../core/layout/module-proposals.ts';
export type { LibraryDropReason, LibraryPlacement } from '../core/layout/infer-modules.ts';
export type { RunsAtRange } from '../core/layout/types.ts';
