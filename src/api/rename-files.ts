// Rename's file-backed part (architecture §2.1, §6.4, §6.6, D92): `rename` (renameInProject) reads a project's
// romlift.toml, src/ and include/ under the project lock, applies the plan's identifier edits through planEdits and
// applyWrites and saves the patched TOML; readRenameTexts is what it reads. Re-exported from `romlift/node` by its
// owner, p6-rename (D93).
export { renameInProject, renameInProject as rename } from '../shell/project/rename-project.ts';
export type { RenameOutcome } from '../shell/project/rename-project.ts';
export { readRenameTexts } from '../shell/project/read-inputs.ts';
export type { RenameTexts } from '../shell/project/read-inputs.ts';
