// The rename component's commands (architecture §2.1, phase 6 since D92): `rename <old> <new>`, added by its owner,
// p6-rename (D93).
import type { CommandSpec } from '../../registry.ts';
import { renameCommand } from '../rename.ts';

export const renameCommands: readonly CommandSpec[] = [renameCommand];
