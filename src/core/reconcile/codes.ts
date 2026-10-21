// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the INCLUDE_ASM
// planner. Phase 4 adds W_C_ORDER with its raiser, planIncludeAsm (include-asm.ts), fix round 2 the planner's two
// refusals (D77 a, b), fix round 3 the third (D78 a) and fix round 4 the fourth (D80 a); phase 6's renames add theirs.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ReconcileCodes = defineCodes({
  W_C_ORDER: {
    severity: 'warning',
    meaning: "a C file's INCLUDE_ASM statements and function definitions are not in the ROM order of its module's functions (include-asm.ts)",
  },
  E_C_STUB_UNPLACED: {
    severity: 'error',
    meaning: 'a C file has no safe place for the INCLUDE_ASM of a function its module gained: the text ends inside a comment, a literal, a directive or an unclosed #if, the stub would go between two chunks one #if region holds, or it would land out of ROM order (include-asm.ts)',
  },
  E_C_STALE_DEFINITION: {
    severity: 'error',
    meaning: 'a C file defines a function of the tree romlift last generated that no module has now, as after a rename or deletion in romlift.toml of a decompiled function; or, where the INCLUDE_ASM of a chunk of that tree goes that the file no longer includes or defines, a function of another name, as after a rename in C only (when that tree is unknown: a definition its module no longer has where the INCLUDE_ASM of a function it gained goes) (include-asm.ts)',
  },
  E_C_CONDITIONAL_STUB: {
    severity: 'error',
    meaning: 'a C file holds, inside an #if/#ifdef/#ifndef region, the INCLUDE_ASM of a chunk its module no longer has; romlift never edits conditional code (include-asm.ts)',
  },
  E_C_UNSCANNABLE: {
    severity: 'error',
    meaning: 'a C file the scanner cannot split into file-scope items: a branch of an #if that leaves other braces or parentheses open than the #if found, a definition that never closes, or a block at file scope after a head that names no function; nothing in it is edited (include-asm.ts)',
  },
});

export type ReconcileCode = keyof typeof ReconcileCodes;
