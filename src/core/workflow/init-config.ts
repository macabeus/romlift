// The config `init` writes for a ROM, by the one path every command that needs it takes (architecture §2.1, §6.2,
// §6.5, D62 c, D75 f): `init` itself, the gates' tree checks (generateFromRom) and the bench's "as init would write it".
//
//   1. the build name: `--name`, or the header's game code (buildNameOf); `<name>.gba`, the ROM `make` builds, must not
//      be the user's ROM file nor `baserom.gba`, so a default name that would be gets BUILD_NAME_SUFFIX and a `--name`
//      that would be is refused (E_NAME_INVALID), like a name that is no build name (core/config/schema.ts);
//   2. the discover analysis and configFromDiscover over it (with `--module-size`); from phase 6, unless the signature
//      layer is off (`--no-signatures`), the signature files the shell located placed on that discover result and
//      screened (signature-layer.ts signatureLayer, proposals.ts checkProposals), their library regions given to module inference
//      (`asm` modules with library and version) and their kept proposals folded into the config (foldSignatures: the
//      signature's name, `from`, `size` and the listed functions inside it as [entry_points], tables as [symbols]); [signatures] records `enabled`
//      and the libraries used. The discover result is garbage before any confirm run starts, so the two never share
//      the bin's 1,024 MiB heap cap (D69, D72);
//   3. the config serialised (serializeConfig, the canonical layout) and parsed back: what romlift.toml says is what
//      every caller generates from, so `generate` right after `init` changes nothing and the gates' tree checks check the
//      config `init` writes.
//
// initModel and generateFromRom are that config's confirm model and checked generate. Pure.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { RomliftInvariantError, diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import { BASEROM_FILE } from '../../foundation/util/project-files.ts';
import { parseConfig } from '../config/parse.ts';
import { BUILD_NAME_RULE, isBuildName } from '../config/schema.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { serializeConfig } from '../config/serialize.ts';
import { ModelCodes } from '../model/codes.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { SignatureFile } from '../signatures/schema.ts';
import { buildNameOf, configFromDiscover } from './config-from-discover.ts';
import { discover } from './discover.ts';
import { confirmModel, generate } from './generate.ts';
import type { ConfirmedModel, GenerateInputs, GenerateResult } from './generate.ts';
import { droppedRegionNotes, foldSignatures, librariesOf, signatureLayer } from './signature-layer.ts';
import type { InitOptions } from './types.ts';

/** What a default build name gets when `<name>.gba` would be the user's ROM file or baserom.gba. */
export const BUILD_NAME_SUFFIX = '_build';

/** The file name at the end of a '/'-separated path. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Whether `<name>.gba` is a file the project already holds as a ROM: the user's (`romFile`) or baserom.gba, case-folded. */
export function builtRomCollides(name: string, romFile: string): boolean {
  const built = `${name}.gba`.toLowerCase();
  return built === baseName(romFile).toLowerCase() || built === BASEROM_FILE;
}

/** The build name of a project, or why the one given cannot be (E_NAME_INVALID). */
export function initBuildName(
  rom: Pick<Rom, 'header'>,
  romFile: string,
  options: Pick<InitOptions, 'name'>,
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly diagnostic: Diagnostic } {
  const given = options.name;
  if (given !== undefined) {
    if (!isBuildName(given)) {
      return {
        ok: false,
        diagnostic: diagnostic(
          ModelCodes,
          'E_NAME_INVALID',
          `the build name ${JSON.stringify(given)} is no file name: ${BUILD_NAME_RULE}`,
        ),
      };
    }
    if (builtRomCollides(given, romFile)) {
      return {
        ok: false,
        diagnostic: diagnostic(
          ModelCodes,
          'E_NAME_INVALID',
          `the build name ${given} would make \`make\` write ${given}.gba over the ROM ${baseName(romFile)} or ${BASEROM_FILE}; choose another --name`,
        ),
      };
    }
    return { ok: true, name: given };
  }
  const name = buildNameOf(rom);
  return { ok: true, name: builtRomCollides(name, romFile) ? `${name}${BUILD_NAME_SUFFIX}` : name };
}

/**
 * initConfigOf's options: init's own, the ROM file name the user gave (default baserom.gba), the analysis profile and
 * the built signature files (none: the config names no library; `signatures: false` skips them and writes
 * `enabled = false`).
 */
export interface InitConfigOptions extends InitOptions {
  /** The ROM's file name as the user gave it, for the build name's collision rule; default baserom.gba. */
  readonly romFile?: string;
  readonly profile?: CompilerProfile;
  readonly signatureFiles?: readonly SignatureFile[];
}

/** The config `init` writes for a ROM and its canonical TOML, or the diagnostics that refuse it. */
export type InitConfig =
  | {
      readonly ok: true;
      readonly config: RomliftConfig;
      readonly tomlText: string;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/**
 * The config `init` writes for `rom` (the header's steps 1 to 3), parsed back from its canonical TOML; refused when
 * the image is not a cartridge, the build name is invalid or the discover run raises an error.
 */
export function initConfigOf(rom: Rom, options: InitConfigOptions = {}): InitConfig {
  const problems = checkRom(rom.bytes);
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const named = initBuildName(rom, options.romFile ?? BASEROM_FILE, options);
  if (!named.ok) return { ok: false, diagnostics: [named.diagnostic] };
  const found = configBeforeSerialising(rom, options);
  if (!found.ok) return found;
  const tomlText = serializeConfig({ ...found.config, build: { ...found.config.build, name: named.name } });
  const parsed = parseConfig(tomlText);
  if (!parsed.ok)
    throw new RomliftInvariantError(
      `init's romlift.toml does not parse back: ${parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`,
    );
  return { ok: true, config: parsed.value, tomlText, diagnostics: [...found.diagnostics, ...parsed.diagnostics] };
}

/** Step 2 of the header, with the signature layer's diagnostics; the discover result does not outlive this call. */
function configBeforeSerialising(
  rom: Rom,
  options: InitConfigOptions,
):
  | { readonly ok: true; readonly config: RomliftConfig; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const discovered = discover(rom, options.profile === undefined ? {} : { profile: options.profile });
  if (discovered.diagnostics.some((d) => d.severity === 'error'))
    return { ok: false, diagnostics: discovered.diagnostics };
  const enabled = options.signatures !== false;
  const layer = signatureLayer(rom, discovered, enabled ? (options.signatureFiles ?? []) : []);
  const inferred = configFromDiscover(rom, discovered, {
    ...(options.moduleSize === undefined ? {} : { moduleSize: options.moduleSize }),
    ...(layer.regions.length === 0 ? {} : { libraries: layer.regions }),
  });
  const libraries = librariesOf(layer.proposals);
  const config = {
    ...foldSignatures(inferred, layer.proposals),
    signatures: { enabled, ...(libraries.length === 0 ? {} : { libraries }) },
  };
  return { ok: true, config, diagnostics: [...layer.diagnostics, ...droppedRegionNotes(config, layer.regions)] };
}

/** The model init's config gives a ROM: initConfigOf, then the confirm analysis over that config and its Model. */
export type InitModel =
  | ({ readonly ok: true; readonly config: RomliftConfig } & ConfirmedModel)
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function initModel(rom: Rom, options: InitConfigOptions = {}): InitModel {
  const init = initConfigOf(rom, options);
  if (!init.ok) return init;
  return {
    ok: true,
    config: init.config,
    ...confirmModel({
      rom,
      config: init.config,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    }),
  };
}

/** generate over the config initConfigOf builds: what the gates' tree checks check. */
export type GenerateFromRom =
  | ({ readonly ok: true; readonly config: RomliftConfig } & GenerateResult)
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function generateFromRom(rom: Rom, inputs: Omit<GenerateInputs, 'rom' | 'config'>): GenerateFromRom {
  const init = initConfigOf(rom, inputs.profile === undefined ? {} : { profile: inputs.profile });
  if (!init.ok) return init;
  return { ok: true, config: init.config, ...generate({ ...inputs, rom, config: init.config }) };
}
