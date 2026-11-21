// The signature builder's file-backed part (architecture §7.1, §7.2, roadmap 6.A), exported from `romlift/node` by its
// owner, p6-signatures-build (D93): buildSignatures (a spec and its reference datasets to a signature file),
// writeSignatureFile, readSignatureSpec, and locateSignatures with readSignatureFile (the built files `init` reads).
export {
  buildSignatures,
  readSignatureSpec,
  signaturesRepoOf,
  SYNTHETIC_COMMIT,
  writeSignatureFile,
} from '../shell/signatures/build-from-references.ts';
export type {
  BuildSignaturesInput,
  BuildSignaturesOptions,
  BuildSignaturesResult,
} from '../shell/signatures/build-from-references.ts';
export { locateSignatures, readSignatureFile, SIGNATURES_ENV } from '../shell/signatures/locate.ts';
export type { LocatedSignatures, LocateSignaturesOptions } from '../shell/signatures/locate.ts';
