// The emission component's commands (architecture §2.1, phase 3): `model` and `verify` (D62).
import type { CommandSpec } from '../../registry.ts';
import { modelCommand } from '../model.ts';
import { verifyCommand } from '../verify.ts';

export const emissionCommands: readonly CommandSpec[] = [modelCommand, verifyCommand];
