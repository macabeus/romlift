// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the
// INCLUDE_ASM planner. Empty until their raisers land (p4-c-modules, D74).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ReconcileCodes = defineCodes({});

export type ReconcileCode = keyof typeof ReconcileCodes;
