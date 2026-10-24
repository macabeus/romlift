// The one-shot component's commands (architecture §2.1, phase 4): `init` and `generate`, added by their owner,
// p4-workflows (D74).
import type { CommandSpec } from '../../registry.ts';
import { generateCommand } from '../generate.ts';
import { initCommand } from '../init.ts';

export const oneShotCommands: readonly CommandSpec[] = [initCommand, generateCommand];
