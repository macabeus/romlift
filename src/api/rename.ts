// Rename (architecture §2.1, §6.6, roadmap 6.E, D92; phase 5's 5.A, moved into phase 6): the pure plan of `romlift
// rename <old> <new>` (planRename: a one-line TOML patch and identifier-token edits as reconciled entries), its
// halves (planRenamePatch, renameIdentifiers), the write policy of a run that only edits (planEdits) and the checks
// the shell asks. Owned by p6-rename (D93).
export type { RenameEdit, RenameInputs, RenamePlan } from '../core/workflow/rename.ts';
export { isRenameTarget, planRename, renameJournalProblems, renameProblems, staleRenameConfig } from '../core/workflow/rename.ts';
export type { RenamedEntry, RenamePatchResult } from '../core/config/rename-patch.ts';
export { entriesNamed, planRenamePatch } from '../core/config/rename-patch.ts';
export { identifierTokens, renameIdentifiers } from '../core/reconcile/rename-tokens.ts';
export type { EditPlanInputs } from '../core/write-plan/plan-writes.ts';
export { planEdits } from '../core/write-plan/plan-writes.ts';
