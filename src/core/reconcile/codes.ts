// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the INCLUDE_ASM
// planner. Phase 4 adds W_C_ORDER with its raiser, planIncludeAsm (include-asm.ts); phase 5's renames add theirs.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ReconcileCodes = defineCodes({
  W_C_ORDER: {
    severity: 'warning',
    meaning: "a C file's INCLUDE_ASM statements and function definitions are not in the ROM order of its module's functions (include-asm.ts)",
  },
});

export type ReconcileCode = keyof typeof ReconcileCodes;
