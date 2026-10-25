// Diagnostic codes raised by core/workflow (architecture §9.1, D45): `init`'s verdict on the directory it is given
// (init.ts initDirVerdict and replacedProblems, D75 j), which the shell only lists and hashes, the refusal of `analyze
// --update --write` and of `rename` to save over a config that changed since it was read (analyze-update.ts
// staleConfigProblems, rename.ts staleRenameConfig), what the reconciliation of a project's C files cannot fix
// (c-stubs.ts, D77 a), `rename`'s refusals (rename.ts planRename, renameJournalProblems; phase 6, D92), and the
// signature layer of `init` and `analyze --update` (phase 6, architecture §7.3, §7.4): the proposal screen's
// contradictions (proposals.ts checkProposals), the library regions no module could take (proposals.ts), and init's
// note that signatures are enabled but no built file was found (init.ts).
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
    meaning: 'romlift.toml changed on disk while analyze --update or rename ran, so its patch, made from the text it read, is not saved',
  },
  E_RENAME_UNKNOWN: {
    severity: 'error',
    meaning: 'rename was given an old name that is no [functions] or [symbols] entry of romlift.toml nor an alias of one; nothing is changed (rename.ts)',
  },
  E_RENAME_EXISTS: {
    severity: 'error',
    meaning: 'rename was given a new name that romlift.toml already has: a function, a symbol, an alias or a module; nothing is changed (rename.ts)',
  },
  E_RENAME_INVALID: {
    severity: 'error',
    meaning: 'rename was given a new name that is not a C identifier (a letter or _, then letters, digits and _, not a C keyword) or not an assembler symbol name; nothing is changed (rename.ts)',
  },
  W_EVIDENCE_CONFLICT: {
    severity: 'warning',
    meaning:
      'a proposal contradicts the analysis (a function where it found one of the other mode or claims the bytes as a pool, table or data; a table over found code), the config (a listed function of the other mode, a data override under a function, a code override under a table, a module border inside a runs_at range, a name taken at another address) or an earlier proposal (its name); the proposal is dropped and nothing else changes (proposals.ts)',
  },
  W_LIBRARY_MODULE_DROPPED: {
    severity: 'warning',
    meaning: 'a library region the signatures placed in the code could take no module of its own: no legal border inside it, or a module of the config starts inside it; its functions keep their names, and no library module is proposed for it (proposals.ts)',
  },
  W_SIGNATURES_ABSENT: {
    severity: 'warning',
    meaning: 'init runs with [signatures] enabled but no built signature file was found (signatures/ or $ROMLIFT_SIGNATURES; `romlift signatures build` writes them); init proceeds without library names (init.ts)',
  },
  E_RENAME_INTERRUPTED: {
    severity: 'error',
    meaning: "the project holds the journal of an interrupted write (.romlift/journal.json), which the next generate finishes; rename changes nothing until it has (rename.ts)",
  },
});

export type WorkflowCode = keyof typeof WorkflowCodes;
