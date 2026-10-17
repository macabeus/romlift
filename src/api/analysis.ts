export { analyze } from '../core/analysis/driver/run.ts';
export { addressMap, toLoad, toRun } from '../core/analysis/address-map.ts';
export type { AddressMap } from '../core/analysis/address-map.ts';
export { AnalysisCodes } from '../core/analysis/codes.ts';
export type { AnalysisCode } from '../core/analysis/codes.ts';
export { Claim } from '../core/analysis/types.ts';
export type {
  AnalysisOptions,
  AnalysisOptionsRecord,
  AnalysisResult,
  BlVerdict,
  BlVerdictRecord,
  CallSite,
  ClaimKind,
  ClaimRun,
  Exit,
  FunctionFact,
  JumpTable,
  ListedInvalid,
  OverrideFact,
  Seed,
  StartupRegion,
  UnlistedFinding,
} from '../core/analysis/types.ts';
export { ALL_CODES } from '../core/diagnostic-codes.ts';
export type { DiagnosticCode } from '../core/diagnostic-codes.ts';
