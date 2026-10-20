// Diagnostic codes raised by core/workflow (architecture §9.1, D45): `init`'s verdict on the directory it is given
// (init.ts initDirVerdict and replacedProblems, D75 j), which the shell only lists and hashes, and `analyze --update
// --write`'s refusal to save over a config that changed since it was read (analyze-update.ts staleConfigProblems),
// and what the reconciliation of a project's C files cannot fix (c-stubs.ts, D77 a).
import { defineCodes } from '../../foundation/diagnostics/diagnostic.ts';

export const WorkflowCodes = defineCodes({
  E_DIR_NOT_EMPTY: {
    severity: 'error',
    meaning: 'init was given a directory that holds other files than the ROM, .git and dot-files and is not a romlift project, or a project whose romlift.toml, decomp.yaml or baserom.gba init would replace',
  },
  E_C_DEFINITION_MOVED: {
    severity: 'error',
    meaning: "a src/<module>.c defines a function romlift.toml now puts in another module (a move or split of decompiled code), whose INCLUDE_ASM or chunk there would define it twice (c-stubs.ts)",
  },
  W_C_FILE_UNUSED: {
    severity: 'warning',
    meaning: 'a src/*.c file is the source of no module of romlift.toml (a renamed c module), so make no longer builds it (c-stubs.ts)',
  },
  E_STALE_CONFIG: {
    severity: 'error',
    meaning: 'romlift.toml changed on disk while analyze --update ran, so its patch, made from the text it read, is not saved',
  },
});

export type WorkflowCode = keyof typeof WorkflowCodes;
