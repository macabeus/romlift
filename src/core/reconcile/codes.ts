// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the INCLUDE_ASM
// planner. Phase 4 adds W_C_ORDER with its raiser, planIncludeAsm (include-asm.ts), fix round 2 the planner's two
// refusals (D77 a, b) and fix round 3 the third (D78 a); phase 6's renames add theirs.
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
    meaning: 'a C file defines a function of the tree romlift last generated that no module has now, as after a rename or deletion in romlift.toml of a decompiled function (when that tree is unknown: a definition its module no longer has where the INCLUDE_ASM of a function it gained goes) (include-asm.ts)',
  },
  E_C_CONDITIONAL_STUB: {
    severity: 'error',
    meaning: 'a C file holds, inside an #if/#ifdef/#ifndef region, the INCLUDE_ASM of a chunk its module no longer has; romlift never edits conditional code (include-asm.ts)',
  },
});

export type ReconcileCode = keyof typeof ReconcileCodes;
