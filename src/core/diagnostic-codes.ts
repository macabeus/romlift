// The union of every core module's codes.ts and foundation/rom's (architecture §9.1, D45). Each phase
// lead adds the codes module of a component when its first raiser lands. The shell's codes stay
// outside this union.
import { RomCodes } from '../foundation/rom/codes.ts';
import { AnalysisCodes } from './analysis/codes.ts';

export const ALL_CODES = { ...RomCodes, ...AnalysisCodes } as const;

export type DiagnosticCode = keyof typeof ALL_CODES;
