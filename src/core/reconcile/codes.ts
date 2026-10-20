// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the INCLUDE_ASM
// planner. Phase 4 adds W_C_ORDER with its raiser, planIncludeAsm (include-asm.ts), and fix round 2 the planner's two
// refusals (D77 a, b); phase 6's renames add theirs.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ReconcileCodes = defineCodes({
  W_C_ORDER: {
    severity: 'warning',
    meaning: "a C file's INCLUDE_ASM statements and function definitions are not in the ROM order of its module's functions (include-asm.ts)",
  },
  E_C_STUB_UNPLACED: {
    severity: 'error',
    meaning: 'a C file has no safe place for the INCLUDE_ASM of a function its module gained: the text ends inside a comment, a literal, a directive or an unclosed #if (include-asm.ts)',
  },
  E_C_STALE_DEFINITION: {
    severity: 'error',
    meaning: 'a C file defines a function its module no longer has where the INCLUDE_ASM of a function it gained goes, as after a rename in romlift.toml of a decompiled function (include-asm.ts)',
  },
});

export type ReconcileCode = keyof typeof ReconcileCodes;
