// The union of every core module's codes.ts and foundation/rom's (architecture §9.1, D45). Each phase
// lead adds the codes module of a component when its first raiser lands, or, from phase 3, the empty
// codes module its owner fills with the raisers (D62). The shell's codes stay outside this union.
import { RomCodes } from '../foundation/rom/codes.ts';
import { AnalysisCodes } from './analysis/codes.ts';
import { ModelCodes } from './model/codes.ts';
import { VerifyCodes } from './verify/codes.ts';
import { WritePlanCodes } from './write-plan/codes.ts';

export const ALL_CODES = { ...RomCodes, ...AnalysisCodes, ...ModelCodes, ...VerifyCodes, ...WritePlanCodes } as const;

export type DiagnosticCode = keyof typeof ALL_CODES;
