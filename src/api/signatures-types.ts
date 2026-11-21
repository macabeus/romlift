// The frozen types of phase 6 (architecture §7.1 to §7.4, §9.2, D93), exported by its lead from `romlift`: the
// signature file (schema 3) and spec with their validators, the placement the matcher reports, the CheckProposals
// contract and explain's signature part. The builder, the matcher, rename and the proposal screen export their
// functions from their own barrels.
export type {
  LibraryVersion,
  LinkOrderMember,
  MemberId,
  SignatureFile,
  SignatureFileParse,
  SignatureFunction,
  SignaturePlacement,
  SignatureReference,
  SignatureRuleId,
  SignatureTable,
} from '../core/signatures/schema.ts';
export { isMemberId, parseSignatureFile, SIGNATURE_RULE_IDS } from '../core/signatures/schema.ts';
export type {
  SignatureSpec,
  SignatureSpecParse,
  SignatureSpecReference,
  SignatureSpecVersion,
} from '../core/signatures/spec.ts';
export { parseSignatureSpec } from '../core/signatures/spec.ts';
export type { SignatureCode } from '../core/signatures/codes.ts';
export { SignatureCodes } from '../core/signatures/codes.ts';
export type { CheckProposals, CheckProposalsContext, ProposalCheck } from '../core/workflow/types.ts';
export type { ExplainSignature } from '../core/workflow/explain.ts';
