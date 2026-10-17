// The binutils the real tier records (architecture §8.2 meta.toolchain): the first line of `--version`
// of arm-none-eabi-as, -ld and -objcopy through romlift's binutilsVersions, or null for a tool that is
// missing from the PATH or prints no version.
import { binutilsVersions, findExecutable } from 'romlift/node';

import type { Toolchain } from './artifact.ts';

export const TOOLS = { as: 'arm-none-eabi-as', ld: 'arm-none-eabi-ld', objcopy: 'arm-none-eabi-objcopy' } as const;

export async function toolchainVersions(env: Readonly<Record<string, string | undefined>> = process.env): Promise<Toolchain> {
  // A tool not on the PATH is run by its bare name, which cannot start, so its version is empty.
  const path = (name: string): string => findExecutable(name, env) ?? name;
  const versions = await binutilsVersions({ as: path(TOOLS.as), ld: path(TOOLS.ld), objcopy: path(TOOLS.objcopy) });
  const orNull = (line: string): string | null => (line === '' ? null : line);
  return { as: orNull(versions.as), ld: orNull(versions.ld), objcopy: orNull(versions.objcopy) };
}
