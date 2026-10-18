// Every implemented command, concatenated from the per-component lists (D43). This file imports only
// `./lists/*.ts`, so parallel components never edit it after the phase lead adds their list.
import { analysisCommands } from './lists/analysis.ts';
import { emissionCommands } from './lists/emission.ts';
import { toolchainCommands } from './lists/toolchain.ts';

export const COMMANDS: typeof toolchainCommands = [...toolchainCommands, ...analysisCommands, ...emissionCommands];
