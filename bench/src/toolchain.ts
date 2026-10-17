// The binutils the real tier records (architecture §8.2 meta.toolchain): the first line of
// `--version` of arm-none-eabi-as, -ld and -objcopy, or null when a tool is missing.
import type { Toolchain } from './artifact.ts';
import { firstLine } from './process.ts';

export const TOOLS = { as: 'arm-none-eabi-as', ld: 'arm-none-eabi-ld', objcopy: 'arm-none-eabi-objcopy' } as const;

export async function toolchainVersions(): Promise<Toolchain> {
  return {
    as: (await firstLine(TOOLS.as, ['--version'])) ?? null,
    ld: (await firstLine(TOOLS.ld, ['--version'])) ?? null,
    objcopy: (await firstLine(TOOLS.objcopy, ['--version'])) ?? null,
  };
}
