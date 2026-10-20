// The init workflow (architecture §2.1, §6.3 to §6.5, D17, D36, D49, D74 c, d; roadmap 4.D): a ROM in, everything a
// new project holds out, as a plan the shell applies. Ported from the PoC's `cli.ts` init flow and `generate.ts`,
// without signatures (phase 6) and with the TOML written by `init` alone (generate never writes it):
//
//   1. the build name: `--name`, or the header's game code (buildNameOf); `<name>.gba`, the ROM `make` builds, must not
//      be the user's ROM file nor `baserom.gba`, so a default name that would be gets BUILD_NAME_SUFFIX and a `--name`
//      that would be is refused (E_NAME_INVALID), like a name that is no file name;
//   2. the discover analysis and configFromDiscover over it (with `--module-size`); the discover result is garbage
//      before the confirm run starts, as in generateFromRom, so the two never share the bin's 1,024 MiB heap cap;
//   3. the config serialised (serializeConfig, the canonical layout) and parsed back: the tree is generated from the
//      config the TOML says, exactly what `generate` reads next, so `generate` right after `init` changes nothing;
//   4. decomp.yaml (renderDecompYaml), the checked generate over that config (its tree, the c stubs and modules.mk;
//      §6.4 step 2: a failed self-check or a model error refuses the plan, nothing is written), and the scaffold
//      (renderScaffold over ScaffoldVars).
//
// Pure: the shell reads the ROM, the templates and the pin, then saves the TOML and decomp.yaml, plans the tree and
// the scaffold with planWrites and applies them.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import { renderDecompYaml } from '../config/decomp-yaml.ts';
import { parseConfig } from '../config/parse.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { serializeConfig } from '../config/serialize.ts';
import type { FileEntry } from '../emit/tree.ts';
import { ModelCodes } from '../model/codes.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { renderScaffold } from '../scaffold/render.ts';
import { SCAFFOLD_ROM_FILE, scaffoldVars } from '../scaffold/vars.ts';
import type { AgbccPin, ScaffoldTemplates } from '../scaffold/vars.ts';
import { unifiedDiff } from './analyze-update.ts';
import { buildNameOf, configFromDiscover } from './config-from-discover.ts';
import { discover } from './discover.ts';
import { generate, writable } from './generate.ts';
import type { InitInputs, InitOptions, InitPlan } from './types.ts';

/** What a default build name gets when `<name>.gba` would be the user's ROM file or baserom.gba. */
export const BUILD_NAME_SUFFIX = '_build';

/** A build name: a file name's base and a make target (letters, digits, `.`, `_`, `-`; a letter or digit first). */
const BUILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The file name at the end of a '/'-separated path. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Whether `<name>.gba` is a file the project already holds as a ROM: the user's (`romFile`) or baserom.gba, case-folded. */
export function builtRomCollides(name: string, romFile: string): boolean {
  const built = `${name}.gba`.toLowerCase();
  return built === baseName(romFile).toLowerCase() || built === SCAFFOLD_ROM_FILE;
}

/** The build name of a project, or why the one given cannot be (E_NAME_INVALID). */
export function initBuildName(rom: Pick<Rom, 'header'>, romFile: string, options: Pick<InitOptions, 'name'>): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const given = options.name;
  if (given !== undefined) {
    if (!BUILD_NAME.test(given)) {
      return { ok: false, diagnostic: diagnostic(ModelCodes, 'E_NAME_INVALID', `the build name ${JSON.stringify(given)} is no file name: letters, digits, '.', '_' and '-', a letter or digit first, at most 100 characters`) };
    }
    if (builtRomCollides(given, romFile)) {
      return { ok: false, diagnostic: diagnostic(ModelCodes, 'E_NAME_INVALID', `the build name ${given} would make \`make\` write ${given}.gba over the ROM ${baseName(romFile)} or ${SCAFFOLD_ROM_FILE}; choose another --name`) };
    }
    return { ok: true, name: given };
  }
  const name = buildNameOf(rom);
  return { ok: true, name: builtRomCollides(name, romFile) ? `${name}${BUILD_NAME_SUFFIX}` : name };
}

/**
 * The config configFromDiscover builds from the ROM's discover analysis, or the discover run's error diagnostics.
 * The discover result does not outlive this call (see the header).
 */
function discoveredConfig(rom: Rom, options: InitOptions, profile: CompilerProfile | undefined): { readonly ok: true; readonly config: RomliftConfig } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const discovered = discover(rom, profile === undefined ? {} : { profile });
  if (discovered.diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: discovered.diagnostics };
  return { ok: true, config: configFromDiscover(rom, discovered, options.moduleSize === undefined ? {} : { moduleSize: options.moduleSize }) };
}

/** What a project's scaffold is rendered from: its build name, its ROM's SHA-1 and title, and the package's inputs. */
export interface ProjectScaffoldInputs {
  readonly name: string;
  readonly sha1: string;
  readonly title: string;
  readonly romliftVersion: string;
  readonly agbcc: AgbccPin;
  readonly templates: ScaffoldTemplates;
}

/** The scaffold entries of a project (renderScaffold over its ScaffoldVars), sorted by path; `init` writes them when absent. */
export function projectScaffold(inputs: ProjectScaffoldInputs): readonly FileEntry[] {
  const vars = scaffoldVars({ name: inputs.name, sha1: inputs.sha1, romliftVersion: inputs.romliftVersion, agbcc: inputs.agbcc, title: inputs.title });
  return renderScaffold(vars, inputs.templates);
}

/** How one scaffold file on disk compares with what the current templates render (`scaffold --diff`). */
export interface ScaffoldDrift {
  readonly path: string;
  readonly status: 'same' | 'differs' | 'absent';
  /** The unified diff from the file on disk to the rendered template; empty unless `differs`. */
  readonly diff: string;
}

/** The drift of every scaffold entry against `current` (each path's text on disk; a path it lacks is absent), in entry order. */
export function scaffoldDrift(entries: readonly FileEntry[], current: ReadonlyMap<string, string>): readonly ScaffoldDrift[] {
  return entries.flatMap((entry): ScaffoldDrift[] => {
    if (!('text' in entry)) return [];
    const text = current.get(entry.path);
    if (text === undefined) return [{ path: entry.path, status: 'absent', diff: '' }];
    if (text === entry.text) return [{ path: entry.path, status: 'same', diff: '' }];
    return [{ path: entry.path, status: 'differs', diff: unifiedDiff(text, entry.text, entry.path) }];
  });
}

/**
 * `init`'s plan (architecture §2.1): the config and its TOML, decomp.yaml, the checked generate over the config the
 * TOML parses to, and the scaffold. Refused (`ok: false`, nothing to write) when the image is not a cartridge, the
 * build name is invalid, discover raises an error, the model raises one or a self-check fails; the diagnostics say
 * which (a failed self-check's are core/verify's codes, which the CLI maps to exit 3).
 */
export function init(inputs: InitInputs): InitPlan {
  const { rom } = inputs;
  const problems = checkRom(rom.bytes);
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const named = initBuildName(rom, inputs.romFile, inputs.options);
  if (!named.ok) return { ok: false, diagnostics: [named.diagnostic] };
  const discovered = discoveredConfig(rom, inputs.options, inputs.profile);
  if (!discovered.ok) return discovered;
  const tomlText = serializeConfig({ ...discovered.config, build: { ...discovered.config.build, name: named.name } });
  const parsed = parseConfig(tomlText);
  if (!parsed.ok) throw new RomliftInvariantError(`init's romlift.toml does not parse back: ${parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  const config = parsed.value;
  const result = generate({ rom, config, decomp: { defined: [] }, printer: 'readable', ...(inputs.profile === undefined ? {} : { profile: inputs.profile }) });
  if (!writable(result)) {
    return { ok: false, diagnostics: [...result.diagnostics, ...result.report.checks.flatMap((c) => c.diagnostics)] };
  }
  const decompYamlText = renderDecompYaml({ name: config.build.name, title: rom.header.title, gameCode: rom.header.gameCode, sha1: rom.sha1, compiler: config.build.compiler });
  const scaffold = projectScaffold({ name: config.build.name, sha1: rom.sha1, title: rom.header.title, romliftVersion: inputs.romliftVersion, agbcc: inputs.agbcc, templates: inputs.templates });
  return { ok: true, config, tomlText, decompYamlText, result, scaffold, diagnostics: [...parsed.diagnostics, ...result.diagnostics] };
}
