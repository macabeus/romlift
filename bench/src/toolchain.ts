// The toolchain the real tier records (architecture §8.2 meta.toolchain): the first line of `--version`
// of arm-none-eabi-as, -ld and -objcopy through romlift's binutilsVersions, and from phase 3 of the
// objdiff-cli the bench locates (objdiff-cli.ts findObjdiff); null for a tool that is missing or prints no
// version. `objdiffTool` is what `bench run --scaffold` runs: the located binary, refused unless its
// version is the one pinned in bench/tools/objdiff.version (D34).
import { binutilsVersions, findExecutable } from 'romlift/node';

import type { Toolchain } from './artifact.ts';
import type { BenchContext } from './context.ts';
import { BenchError } from './files.ts';
import { findObjdiff, mainRepoRootOf, objdiffVersion, OBJDIFF_ENV, OBJDIFF_VERSION_FILE, readPinnedObjdiffVersion, type ObjdiffLocation } from './objdiff-cli.ts';

export const TOOLS = { as: 'arm-none-eabi-as', ld: 'arm-none-eabi-ld', objcopy: 'arm-none-eabi-objcopy' } as const;

type Env = Readonly<Record<string, string | undefined>>;

/** The objdiff-cli the bench would run from `cx`, or undefined. */
export async function locateObjdiff(cx: BenchContext, env: Env = process.env): Promise<ObjdiffLocation | undefined> {
  const mainRepoRoot = await mainRepoRootOf(cx.repoRoot);
  return findObjdiff(env, cx.benchRoot, { repoRoot: cx.repoRoot, ...(mainRepoRoot === undefined ? {} : { mainRepoRoot }) });
}

/** The binutils versions, and with `objdiffFrom` the version of the objdiff-cli the bench locates from there. */
export async function toolchainVersions(env: Env = process.env, objdiffFrom?: BenchContext): Promise<Toolchain> {
  // A tool not on the PATH is run by its bare name, which cannot start, so its version is empty.
  const path = (name: string): string => findExecutable(name, env) ?? name;
  const versions = await binutilsVersions({ as: path(TOOLS.as), ld: path(TOOLS.ld), objcopy: path(TOOLS.objcopy) });
  const orNull = (line: string): string | null => (line === '' ? null : line);
  const binutils = { as: orNull(versions.as), ld: orNull(versions.ld), objcopy: orNull(versions.objcopy) };
  if (objdiffFrom === undefined) return binutils;
  const objdiff = await locateObjdiff(objdiffFrom, env);
  return { ...binutils, objdiff: objdiff === undefined ? null : await objdiffVersion(objdiff.bin) };
}

/** The objdiff-cli binary at the pinned version; a BenchError naming what to do otherwise. */
export async function objdiffTool(cx: BenchContext, env: Env = process.env): Promise<string> {
  const pinned = await readPinnedObjdiffVersion(cx.repoRoot);
  if (pinned === null) throw new BenchError(`${OBJDIFF_VERSION_FILE} is missing or empty`);
  const located = await locateObjdiff(cx, env);
  if (located === undefined) throw new BenchError(`objdiff-cli not found: set ${OBJDIFF_ENV}, put it on the PATH, or build it (bench/index.md)`);
  const version = await objdiffVersion(located.bin);
  if (version !== pinned) throw new BenchError(`${located.bin} (${located.source}) is ${version ?? 'not runnable'}, ${OBJDIFF_VERSION_FILE} pins ${pinned}`);
  return located.bin;
}
