// The toolchain component's commands.
import type { CommandSpec } from '../../registry.ts';
import { doctorCommand } from '../doctor.ts';

export const toolchainCommands: readonly CommandSpec[] = [doctorCommand];
