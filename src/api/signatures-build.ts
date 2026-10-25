// The signature builder's pure part (architecture §7.2, roadmap 6.A), exported from `romlift` by its owner,
// p6-signatures-build (D93): extractSignatures and the helpers the shell and the bench share with it.
export {
  extractSignatures,
  hexBytes,
  isAddressLike,
  mapPlacements,
  maskMember,
  memberIdOf,
  objectBaseName,
  objectGlobMatches,
  signatureFileJson,
  signatureFileText,
} from '../core/signatures/extract.ts';
export type { ExtractResult, MapPlacement, ReferenceInput, SignatureDiagnostic } from '../core/signatures/extract.ts';
