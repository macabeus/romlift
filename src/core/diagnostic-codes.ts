// The union of every core module's codes.ts and foundation/rom's (architecture §9.1, D45). Each phase
// lead adds the codes module of a component when its first raiser lands, or, from phase 3, the empty
// codes module its owner fills with the raisers (D62, D74). The shell's codes stay outside this union.
import { RomCodes } from '../foundation/rom/codes.ts';
import { AnalysisCodes } from './analysis/codes.ts';
import { ConfigCodes } from './config/codes.ts';
import { ModelCodes } from './model/codes.ts';
import { ReconcileCodes } from './reconcile/codes.ts';
import { SignatureCodes } from './signatures/codes.ts';
import { VerifyCodes } from './verify/codes.ts';
import { WorkflowCodes } from './workflow/codes.ts';
import { WritePlanCodes } from './write-plan/codes.ts';

export const ALL_CODES = {
  ...RomCodes,
  ...AnalysisCodes,
  ...ConfigCodes,
  ...ModelCodes,
  ...ReconcileCodes,
  ...SignatureCodes,
  ...VerifyCodes,
  ...WritePlanCodes,
  ...WorkflowCodes,
} as const;

/** The verify checks' codes, which the CLI's exit-code rule reads (cli/commands/command-common.ts). */
export { VerifyCodes };

export type DiagnosticCode = keyof typeof ALL_CODES;
