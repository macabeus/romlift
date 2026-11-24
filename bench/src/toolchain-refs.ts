// Toolchain references (architecture §7.2, D123): images that link a whole library archive of a compiler's own
// installation, so the signature builder reads every member of the library, including those no benchmark game links.
// A reference is its recipe, bench/dataset/toolchain/<name>/build.mk (rules.mk beside the directories); its image is
// built here into bench/.local/toolchain/<name>/ with a record of the toolchain, its commit, the image's SHA-1 and a
// digest of the recipe, and is never committed. `npm run toolchain -- build` runs this; `npm run signatures -- build`
// builds the references its spec names first.
//
// TOOLCHAINS is the one place that knows a compiler installation: where its library directory is and which commit it
// is at. A reference of another compiler's library is a new entry here and a recipe whose TOOLCHAIN names it.
import { createHash } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compareCodeUnits } from 'romlift';
import {
  TOOLCHAIN_REFERENCE_SCHEMA,
  type ToolchainReferenceRecord,
  findBinutils,
  parseToolchainReferenceRecord,
  toolchainReferencePaths,
} from 'romlift/node';

import { type AgbccDeps, checkoutAgbcc, templatePin } from './agbcc.ts';
import type { BenchContext } from './context.ts';
import { BenchError, exists, prettyJson, readFileBytes, readJson, readText, writeText } from './files.ts';

/** A compiler installation a recipe takes an archive from. */
export interface ToolchainInstall {
  /** The directory its library archives lie in: make's LIBDIR. */
  readonly libDir: string;
  /** The commit it is built from: the reference's commit. */
  readonly commit: string;
}

/** How one compiler installation is found, building it first when it is not built. */
export interface Toolchain {
  readonly install: (cx: BenchContext, deps: AgbccDeps) => Promise<ToolchainInstall>;
}

/** The installations a recipe's TOOLCHAIN may name. */
export const TOOLCHAINS: Readonly<Record<string, Toolchain>> = {
  // tools/agbcc, the submodule at templates/agbcc.json's commit (D120): its install.sh puts libc.a and libgcc.a in lib/.
  agbcc: {
    install: async (cx, deps) => ({
      libDir: join(await checkoutAgbcc(cx, deps), 'lib'),
      commit: (await templatePin(cx)).commit,
    }),
  },
};

/** The directory of the recipes. */
export const toolchainDir = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'dataset', 'toolchain');

/** The rules every recipe includes, beside the recipes' directories. */
export const TOOLCHAIN_RULES = 'rules.mk';

/** The toolchain references: the directories of toolchainDir holding a build.mk, sorted by name. */
export async function toolchainReferenceNames(cx: BenchContext): Promise<readonly string[]> {
  const root = toolchainDir(cx);
  if (!(await exists(root))) return [];
  const names: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && (await exists(join(root, entry.name, 'build.mk')))) names.push(entry.name);
  }
  return names.sort(compareCodeUnits);
}

/** Whether `name` is a toolchain reference of this repository. */
export async function isToolchainReference(cx: BenchContext, name: string): Promise<boolean> {
  return (await toolchainReferenceNames(cx)).includes(name);
}

/** The value of a recipe's `TOOLCHAIN := <id>` line, or undefined when it has none. */
export function toolchainOf(buildMk: string): string | undefined {
  return /^TOOLCHAIN\s*:=\s*(\S+)\s*$/m.exec(buildMk)?.[1];
}

/** The digest of a recipe: its files and the shared rules, by name and content. */
async function recipeDigest(cx: BenchContext, name: string): Promise<string> {
  const dir = join(toolchainDir(cx), name);
  const hash = createHash('sha256');
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort(compareCodeUnits);
  for (const [label, path] of [
    [TOOLCHAIN_RULES, join(toolchainDir(cx), TOOLCHAIN_RULES)],
    ...files.map((f): [string, string] => [f, join(dir, f)]),
  ] as const) {
    hash.update(`${label}\0`);
    hash.update(await readFileBytes(path));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** What building one reference did. */
export interface ToolchainReferenceBuild {
  readonly record: ToolchainReferenceRecord;
  /** False when the built image was already current (same toolchain commit, same recipe, same image). */
  readonly built: boolean;
}

/**
 * Builds the toolchain reference `name` unless its record already names the installation's commit, this recipe and
 * the image on disk. Throws a BenchError for an unknown reference or toolchain, missing binutils, or a failed build.
 */
export async function buildToolchainReference(
  cx: BenchContext,
  name: string,
  deps: AgbccDeps,
  env: Readonly<Record<string, string | undefined>>,
): Promise<ToolchainReferenceBuild> {
  const dir = join(toolchainDir(cx), name);
  if (!(await exists(join(dir, 'build.mk')))) throw new BenchError(`${name}: no toolchain reference ${dir}`);
  const id = toolchainOf(await readText(join(dir, 'build.mk')));
  const toolchain = id === undefined || !Object.hasOwn(TOOLCHAINS, id) ? undefined : TOOLCHAINS[id];
  if (id === undefined || toolchain === undefined)
    throw new BenchError(
      `${name}: build.mk names ${id === undefined ? 'no TOOLCHAIN' : `the unknown TOOLCHAIN ${id}`} (known: ${Object.keys(TOOLCHAINS).sort(compareCodeUnits).join(', ')})`,
    );
  const install = await toolchain.install(cx, deps);
  const recipe = await recipeDigest(cx, name);
  const paths = toolchainReferencePaths(cx.repoRoot, name);
  const sha1Of = async (): Promise<string> =>
    createHash('sha1')
      .update(await readFileBytes(paths.rom))
      .digest('hex');
  if ((await exists(paths.record)) && (await exists(paths.rom))) {
    const old = parseToolchainReferenceRecord(await readJson(paths.record));
    if (
      old.ok &&
      old.value.toolchain === id &&
      old.value.commit === install.commit &&
      old.value.recipe === recipe &&
      old.value.sha1 === (await sha1Of())
    )
      return { record: old.value, built: false };
  }
  const binutils = findBinutils(env);
  if ('code' in binutils) throw new BenchError(binutils.message);
  await rm(paths.build, { recursive: true, force: true });
  await mkdir(paths.build, { recursive: true });
  deps.log(`toolchain: building ${name} from ${id} ${install.commit}`);
  const made = await deps.run(
    'make',
    [
      '-f',
      'build.mk',
      '--no-print-directory',
      `BUILD=${paths.build}`,
      `LIBDIR=${install.libDir}`,
      `ARM_AS=${binutils.as}`,
      `ARM_LD=${binutils.ld}`,
      `ARM_OBJCOPY=${binutils.objcopy}`,
    ],
    { cwd: dir },
  );
  if (made.code !== 0) throw new BenchError(`${name}: make exited ${made.code}:\n${made.stdout}${made.stderr}`);
  const record: ToolchainReferenceRecord = {
    schema: TOOLCHAIN_REFERENCE_SCHEMA,
    name,
    toolchain: id,
    commit: install.commit,
    sha1: await sha1Of(),
    recipe,
  };
  await writeText(paths.record, prettyJson(record));
  return { record, built: true };
}
