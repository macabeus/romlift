// The proposal screen and the signature layer of init and analyze --update (architecture §7.3, §7.4, roadmap 6.D),
// exported from `romlift` by its owner, p6-proposals (D93): checkProposals (the CheckProposals of
// core/workflow/types.ts, whose types api/signatures-types.ts exports), signatureLayer, foldSignatures and the helpers
// init and analyze --update share; the explain signature part's readers.
export {
  checkProposals,
  droppedRegionNotes,
  foldSignatures,
  isDefaultName,
  librariesOf,
  libraryModuleProposals,
  placeSignatures,
  proposalAddr,
  signatureLayer,
  updateProposals,
} from '../core/workflow/proposals.ts';
export type { LibraryModules, SignatureLayer } from '../core/workflow/proposals.ts';
export { signatureFromConfig, signatureFromPlacements, signatureOfKey } from '../core/workflow/explain.ts';
export { placeLibraries, runsAtName } from '../core/layout/infer-modules.ts';
export type { LibraryDropReason, LibraryPlacement } from '../core/layout/infer-modules.ts';
export type { RunsAtRange } from '../core/layout/types.ts';
