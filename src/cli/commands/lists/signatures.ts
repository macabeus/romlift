// The signatures component's commands (architecture §2.1, phase 6): `signatures build <spec>`, added by its owner,
// p6-signatures-build; the same command's `signatures <rom>` form is p6-signatures-match's (D93).
import type { CommandSpec } from '../../registry.ts';
import { signaturesCommand } from '../signatures.ts';

export const signaturesCommands: readonly CommandSpec[] = [signaturesCommand];
