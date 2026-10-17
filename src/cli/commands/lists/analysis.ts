// The analysis component's commands: analyze and explain (architecture §2.1, phase 2).
import type { CommandSpec } from '../../registry.ts';
import { analyzeCommand } from '../analyze.ts';
import { explainCommand } from '../explain.ts';

export const analysisCommands: readonly CommandSpec[] = [analyzeCommand, explainCommand];
