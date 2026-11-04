// Every command of the `romlift` CLI, in the order `romlift --help` lists them (D108).
import type { CommandSpec } from '../registry.ts';
import { explainCommand } from './explain.ts';
import { generateCommand } from './generate.ts';
import { initCommand } from './init.ts';
import { renameCommand } from './rename.ts';
import { updateCommand } from './update.ts';

export const COMMANDS: readonly CommandSpec[] = [initCommand, generateCommand, updateCommand, renameCommand, explainCommand];
