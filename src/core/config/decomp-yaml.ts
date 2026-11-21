// decomp.yaml (architecture §6.5): the decomp_settings file every matching-decompilation tool of the project reads.
// `init` writes it beside the scaffold so asmlift, objdiff and romlift find the project without flags, and a fresh
// `git worktree` runs `romlift generate` with no arguments: its `tools.romlift` block (a strict object, `config`
// only) names romlift.toml, and its first version names the ROM, the build name and the SHA-1.
//
// renderDecompYaml writes the text by hand, so its comments survive, then reads it back through
// @match-kit/decomp-yaml's pure validators (parseDecompYaml, toolBlock) exactly as loadConfig will; readDecompYaml
// is that reader, with E_DECOMP_YAML_INVALID for a file that fails the spec or the block. Ported from the PoC's
// project.ts (decompYamlText, romliftBlock, the region table); the asmlift compiler line follows the C build of
// D74 f (host preprocessor, the build compiler's flags from compilers.ts, arm-none-eabi-as). Pure: the reader
// returns diagnostics, never throws; the renderer's output always validates, and an output that did not would be
// a bug in romlift (RomliftInvariantError), since every value it writes is quoted.
import { DecompYamlError, parseDecompYaml, toolBlock } from '@match-kit/decomp-yaml';
import type { LoadedConfig } from '@match-kit/decomp-yaml';
import { z } from 'zod';

import { RomliftInvariantError, diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { NONMATCHINGS_ROOT } from '../../foundation/util/project-files.ts';
import { BASEROM_FILE, DECOMP_YAML_FILE, ROMLIFT_CONFIG_FILE } from '../../foundation/util/project-files.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';
import { DEFAULT_BUILD_COMPILER, buildCompilerOf } from './compilers.ts';
import type { BuildCompilerId } from './compilers.ts';

/** romlift's key under `tools`. */
export const ROMLIFT_TOOL = 'romlift';

/** `tools.romlift`: a key it does not name is an error, so a typo is refused. */
const ROMLIFT_BLOCK = z.strictObject({
  /** romlift.toml, relative to decomp.yaml: always that name (readDecompYaml, D83 b). */
  config: z.string().min(1),
});

/** What decomp.yaml is rendered from. */
export interface DecompYamlVars {
  /** The build name: `<name>.gba`, `<name>.elf`, `<name>.map`. */
  readonly name: string;
  /** The cartridge header's game title (the project's display name; the build name when empty). */
  readonly title: string;
  /** The header's four-letter game code; its last letter names the region. */
  readonly gameCode: string;
  /** The ROM's SHA-1, forty lower-case hex digits. */
  readonly sha1: string;
  /** The build compiler asmlift compiles a candidate with; default DEFAULT_BUILD_COMPILER. */
  readonly compiler?: BuildCompilerId;
}

/** What romlift reads from a project's decomp.yaml. */
export interface DecompYamlProject {
  /** `tools.romlift.config`: the project path of romlift.toml, always ROMLIFT_CONFIG_FILE (D83 b). */
  readonly config: string;
  /** `versions[0].name`. */
  readonly version: string;
  /** `versions[0].paths.target`: the ROM, relative to decomp.yaml. */
  readonly target: string;
  /** `versions[0].sha1`, when given. */
  readonly sha1?: string;
  /** The build name: `versions[0].paths.compiled_target` without its directory and `.gba`. */
  readonly buildName: string;
}

export type DecompYamlRead =
  | { readonly ok: true; readonly value: DecompYamlProject }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ConfigCode>[] };

/** Game-code region letter -> decomp.yaml version name and full name (the PoC's table). */
const REGIONS: Readonly<Record<string, readonly [string, string]>> = {
  J: ['jp', 'Japan'],
  E: ['us', 'USA'],
  P: ['eu', 'Europe'],
  D: ['de', 'Germany'],
  F: ['fr', 'France'],
  I: ['it', 'Italy'],
  S: ['es', 'Spain'],
  K: ['kr', 'Korea'],
  C: ['cn', 'China'],
  X: ['eu', 'Europe'],
  Y: ['eu', 'Europe'],
  Z: ['eu', 'Europe'],
  U: ['au', 'Australia'],
};

/** The version name and full name of a game code. */
export function regionOf(gameCode: string): { readonly name: string; readonly fullname: string } {
  const region = REGIONS[gameCode.length === 4 ? gameCode.slice(3) : ''];
  if (region !== undefined) return { name: region[0], fullname: region[1] };
  return { name: gameCode.toLowerCase() || 'rom', fullname: gameCode || 'ROM' };
}

/** A JSON string is a valid double-quoted YAML scalar. */
function q(text: string): string {
  return JSON.stringify(text);
}

function invalid(path: string, problems: readonly string[]): DecompYamlRead {
  return {
    ok: false,
    diagnostics: problems.map((p) => diagnostic(ConfigCodes, 'E_DECOMP_YAML_INVALID', `${path}: ${p}`, { path })),
  };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Reads a decomp.yaml's text: the decomp_settings spec, then the `tools.romlift` block, then its first version. */
export function readDecompYaml(text: string, path: string = DECOMP_YAML_FILE): DecompYamlRead {
  let loaded: LoadedConfig;
  let block: z.output<typeof ROMLIFT_BLOCK> | undefined;
  try {
    loaded = { path, dir: '.', config: parseDecompYaml(text, path) };
    block = toolBlock(loaded, ROMLIFT_TOOL, ROMLIFT_BLOCK);
  } catch (error) {
    if (error instanceof DecompYamlError) return invalid(path, error.problems);
    return invalid(path, [error instanceof Error ? error.message : String(error)]);
  }
  if (block === undefined)
    return invalid(path, [`has no tools.${ROMLIFT_TOOL} block (add one with \`config: ${ROMLIFT_CONFIG_FILE}\`)`]);
  // Always romlift.toml at the project root (fix round 7, architecture-b2-1, D83 b), as the ROM is always baserom.gba
  // (D74 c): the scaffold's Makefile and setup.sh hash romlift.toml by that name against modules.mk's stamp (D82 a).
  if (block.config !== ROMLIFT_CONFIG_FILE)
    return invalid(path, [
      `tools.${ROMLIFT_TOOL}.config: ${q(block.config)} is not ${q(ROMLIFT_CONFIG_FILE)}: a project's config is always ${ROMLIFT_CONFIG_FILE} beside decomp.yaml, the file the Makefile and setup.sh check against modules.mk (D83 b); move it back and name it ${ROMLIFT_CONFIG_FILE}`,
    ]);
  const version = loaded.config.versions[0];
  if (version === undefined) return invalid(path, ['versions: lists no version']);
  const compiled = baseName(version.paths.compiled_target);
  return {
    ok: true,
    value: {
      config: block.config,
      version: version.name,
      target: version.paths.target,
      ...(version.sha1 === undefined ? {} : { sha1: version.sha1 }),
      buildName: compiled.endsWith('.gba') ? compiled.slice(0, -'.gba'.length) : compiled,
    },
  };
}

/** The text of a project's decomp.yaml, read back through the validators before it is returned. */
export function renderDecompYaml(vars: DecompYamlVars): string {
  const compilerId = vars.compiler ?? DEFAULT_BUILD_COMPILER;
  const compiler = buildCompilerOf(compilerId);
  if (compiler === undefined)
    throw new RomliftInvariantError(`renderDecompYaml: ${compilerId} is not a registered build compiler`);
  const region = regionOf(vars.gameCode);
  const text = `# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml/schema.json
# decomp.yaml (the decomp_settings format): the settings this project's tools share.
# Written by romlift init; edit freely, every tool reads it from the project root.

name: ${q(vars.title || vars.name)}
platform: gba
build_system: make
versions:
  - name: ${q(region.name)}
    fullname: ${q(`${region.fullname} (${vars.gameCode || 'no game code'})`)}
    sha1: ${q(vars.sha1)}
    paths:
      target: ${q(BASEROM_FILE)}
      build_dir: build
      map: ${q(`${vars.name}.map`)}
      compiled_target: ${q(`${vars.name}.gba`)}
      elf: ${q(`${vars.name}.elf`)}
      asm: asm
      nonmatchings: ${q(NONMATCHINGS_ROOT)}

tools:
  # asmlift: one function's assembly in, C out, byte-verified with this project's compiler.
  asmlift:
    target: agbcc
    # The built ELF, asmlift's symbol source (names from .symtab; add DWARF for types).
    elf: ${q(`${vars.name}.elf`)}
    # Compiles a candidate for \`--score-against\` the way the Makefile builds src/<module>.c: the host
    # preprocessor, then tools/agbcc/bin/${compiler.id} (built by ./setup.sh) with its default flags, then as.
    compiler: |
      set -e
      cc -E -x c -nostdinc -undef -I include {{inputPath}} -o {{outputPath}}.i
      ./${compiler.cc1} {{outputPath}}.i -o {{outputPath}}.s ${compiler.flags.join(' ')}
      arm-none-eabi-as -mcpu=arm7tdmi {{outputPath}}.s -o {{outputPath}}

  # ${ROMLIFT_TOOL}: the disassembler and scaffolder that wrote this project. \`romlift generate\` finds
  # this file from any directory of the project (a git worktree included), reads the config it
  # names, and regenerates the assembly from the ROM at versions[].paths.target.
  ${ROMLIFT_TOOL}:
    config: ${q(ROMLIFT_CONFIG_FILE)}
`;
  const read = readDecompYaml(text);
  if (!read.ok)
    throw new RomliftInvariantError(
      `renderDecompYaml wrote a decomp.yaml that does not validate: ${read.diagnostics.map((d) => d.message).join('; ')}`,
    );
  if (read.value.config !== ROMLIFT_CONFIG_FILE || read.value.sha1 !== vars.sha1) {
    throw new RomliftInvariantError(
      `renderDecompYaml wrote a decomp.yaml that reads back differently (${JSON.stringify(read.value)})`,
    );
  }
  return text;
}
