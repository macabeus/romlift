// Diagnostic codes raised by core/reconcile (architecture §6.6, §9.1, D45): the C tokenizer and the INCLUDE_ASM
// planner. Phase 4 adds W_C_ORDER with its raiser, planIncludeAsm (include-asm.ts), fix round 2 the planner's two
// refusals (D77 a, b), fix round 3 the third (D78 a), fix round 4 the fourth (D80 a) and fix round 5 W_C_UNSCANNABLE (D81 a); fix round 6 widens E_C_STUB_UNPLACED (D82 b); fix round 7 adds
// E_C_FRAGMENT_STUB and widens E_C_STUB_UNPLACED again (D83 a); fix round 8 adds E_C_MODULE_INCLUDED (D84 a); phase 6's
// renames add theirs.
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const ReconcileCodes = defineCodes({
  W_C_ORDER: {
    severity: 'warning',
    meaning: "a C file's INCLUDE_ASM statements and function definitions are not in the ROM order of its module's functions (include-asm.ts)",
  },
  E_C_STUB_UNPLACED: {
    severity: 'error',
    meaning: "a C file has no safe place for the INCLUDE_ASM of a function its module gained: the text ends inside a comment, a literal, a directive or an unclosed #if, or the stub would go between two chunks one #if region holds; or the file #includes a file romlift does not read (no src/*.c directly under src/, no .h), which may define the function (fix round 6); or its place in ROM order lies inside a src/*.c fragment the file #includes, which romlift never edits (fix round 7) (include-asm.ts)",
  },
  E_C_STALE_DEFINITION: {
    severity: 'error',
    meaning: 'a C file defines a function of the tree romlift last generated that no module has now, as after a rename or deletion in romlift.toml of a decompiled function; or, where the INCLUDE_ASM of a chunk of that tree goes that the file no longer includes or defines, a function of another name, as after a rename in C only (when that tree is unknown: a definition its module no longer has where the INCLUDE_ASM of a function it gained goes) (include-asm.ts)',
  },
  E_C_CONDITIONAL_STUB: {
    severity: 'error',
    meaning: 'a C file holds, inside an #if/#ifdef/#ifndef region, the INCLUDE_ASM of a chunk its module no longer has; romlift never edits conditional code (include-asm.ts)',
  },
  E_C_FRAGMENT_STUB: {
    severity: 'error',
    meaning: "a src/*.c fragment a module's C file #includes holds the INCLUDE_ASM of a chunk its module no longer has (or of another module's directory the tree no longer writes it in); romlift never edits an included file (include-asm.ts, fix round 7)",
  },
  E_C_MODULE_INCLUDED: {
    severity: 'error',
    meaning: "a C file (a module's source, or a src/*.c fragment it #includes) #includes another module's source at file scope, which make also compiles on its own, so its functions would be built twice; refused whether or not the file needs an edit (include-asm.ts, fix round 8)",
  },
  E_C_UNSCANNABLE: {
    severity: 'error',
    meaning: 'a C file the scanner cannot split into file-scope items (the branches of a file-scope #if that end with other braces, parentheses or an unfinished head open than each other, a branch inside a body that closes it, a definition that never closes, or a block at file scope after a head that names no function) needs an edit of its INCLUDE_ASM lines, or is a src/*.c fragment a C file #includes that needs one (fix round 7); nothing is edited (include-asm.ts)',
  },
  W_C_UNSCANNABLE: {
    severity: 'warning',
    meaning: 'a C file the scanner cannot split needs no edit as far as it reads (its INCLUDE_ASM lines match its module), or is the source of no module, or is a src/*.c fragment a C file #includes that needs no edit (fix round 7); nothing in it is edited, and a definition or stub in it may be missed (include-asm.ts, fix round 5)',
  },
});

export type ReconcileCode = keyof typeof ReconcileCodes;
