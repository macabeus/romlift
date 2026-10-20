// The scaffold component's commands (architecture §2.1, phase 4): `scaffold --diff`, added by its owner,
// p4-workflows (D74: it needs the project loading of 4.A).
import type { CommandSpec } from '../../registry.ts';
import { scaffoldCommand } from '../scaffold.ts';

export const scaffoldCommands: readonly CommandSpec[] = [scaffoldCommand];
