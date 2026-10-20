// The init workflow (architecture §2.1, §6.3 to §6.5, D17, D36, D49, D74 c, d; roadmap 4.D): a ROM in, everything a
// new project holds out, as a plan the shell applies. Ported from the PoC's `cli.ts` init flow and `generate.ts`,
// without signatures (phase 6) and with the TOML written by `init` alone (generate never writes it): the config and
// its canonical TOML (init-config.ts initConfigOf, the one path to them), decomp.yaml (renderDecompYaml), the checked
// generate over that config (its tree, the c stubs and modules.mk; §6.4 step 2: a failed self-check or a model error
// refuses the plan, nothing is written), and the scaffold (scaffold-diff.ts projectScaffold).
//
// Whether a directory may receive `init` is decided here too, from what the shell lists and reads (initDirVerdict,
// replacedProblems, D75 j): the shell decides nothing. Pure: the shell reads the ROM, the templates, the pin and the
// directory, then saves the TOML and decomp.yaml, plans the tree and the scaffold with planWrites and applies them.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { BASEROM_FILE, DECOMP_YAML_FILE, DECOMP_YAML_NAMES, ROMLIFT_CONFIG_FILE } from '../../foundation/util/project-files.ts';
import { renderDecompYaml } from '../config/decomp-yaml.ts';
import { ROMLIFT_DIR } from '../write-plan/types.ts';
import { WorkflowCodes } from './codes.ts';
import { generate, writable } from './generate.ts';
import { initConfigOf } from './init-config.ts';
import { projectScaffold } from './scaffold-diff.ts';
import type { InitInputs, InitPlan } from './types.ts';

/**
 * `init`'s plan (architecture §2.1): the config and its TOML, decomp.yaml, the checked generate over the config the
 * TOML parses to, and the scaffold. Refused (`ok: false`, nothing to write) when the image is not a cartridge, the
 * build name is invalid, discover raises an error, the model raises one or a self-check fails; the diagnostics say
 * which (a failed self-check's are core/verify's codes, which the CLI maps to exit 3).
 */
export function init(inputs: InitInputs): InitPlan {
  const { rom } = inputs;
  const made = initConfigOf(rom, { ...inputs.options, romFile: inputs.romFile, ...(inputs.profile === undefined ? {} : { profile: inputs.profile }) });
  if (!made.ok) return made;
  const { config, tomlText } = made;
  const result = generate({ rom, config, decomp: { defined: [] }, printer: 'readable', ...(inputs.profile === undefined ? {} : { profile: inputs.profile }) });
  if (!writable(result)) {
    return { ok: false, diagnostics: [...result.diagnostics, ...result.report.checks.flatMap((c) => c.diagnostics)] };
  }
  const decompYamlText = renderDecompYaml({ name: config.build.name, title: rom.header.title, gameCode: rom.header.gameCode, sha1: rom.sha1, compiler: config.build.compiler });
  const scaffold = projectScaffold({ name: config.build.name, sha1: rom.sha1, title: rom.header.title, romliftVersion: inputs.romliftVersion, agbcc: inputs.agbcc, templates: inputs.templates });
  return { ok: true, config, tomlText, decompYamlText, result, scaffold, diagnostics: [...made.diagnostics, ...result.diagnostics] };
}

// ---------------------------------------------------------------------------------------------------
// The directory `init` is given (architecture §2.1, D75 j): the shell lists and hashes, these decide.

/** What the shell found where `init` is to write: its absolute path, whether it exists as a directory, its entries. */
export interface InitDirListing {
  readonly dir: string;
  readonly state: 'absent' | 'not-directory' | 'directory';
  /** The directory's entry names (empty unless `state` is 'directory'). */
  readonly names: readonly string[];
  /** The ROM `init` was given, as an entry name, when it lies directly in the directory. */
  readonly romInside?: string;
}

/** Whether a directory entry belongs to a romlift project. */
function projectEntry(name: string): boolean {
  return DECOMP_YAML_NAMES.includes(name) || name === ROMLIFT_CONFIG_FILE || name === ROMLIFT_DIR;
}

/**
 * Whether the directory may receive `init <rom>`: it is absent or empty, it holds only the given ROM plus `.git` and
 * dot-files, or it is a romlift project (whose own files init's write then checks under the lock, replacedProblems);
 * anything else is E_DIR_NOT_EMPTY, naming up to five of the entries it holds.
 */
export function initDirVerdict(listing: InitDirListing): { readonly ok: true } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const { dir } = listing;
  if (listing.state === 'not-directory') return { ok: false, diagnostics: [diagnostic(WorkflowCodes, 'E_DIR_NOT_EMPTY', `${dir} is a file, not a directory`, { path: dir })] };
  const project = listing.names.some(projectEntry);
  const others = listing.names.filter((name) => !name.startsWith('.') && name !== listing.romInside);
  if (!project && others.length > 0) {
    const shown = others.slice(0, 5).join(', ') + (others.length > 5 ? `, … (${others.length} in all)` : '');
    const message = `${dir} is not empty and is not a romlift project: it holds ${shown}; run init in an empty directory, or one that holds only the ROM`;
    return { ok: false, diagnostics: [diagnostic(WorkflowCodes, 'E_DIR_NOT_EMPTY', message, { path: dir })] };
  }
  return { ok: true };
}

/**
 * E_DIR_NOT_EMPTY for each file of an existing project that `init` would replace with other content: romlift.toml
 * (the user's config from then on), decomp.yaml or baserom.gba. `wanted` maps each of those project paths to the sha1
 * of what init would write there, `current` to the sha1 on disk or 'absent'; an absent or equal file is fine.
 */
export function replacedProblems(dir: string, wanted: ReadonlyMap<string, string>, current: ReadonlyMap<string, string | 'absent'>): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  for (const [path, sha1] of wanted) {
    const now = current.get(path) ?? 'absent';
    if (now === 'absent' || now === sha1) continue;
    const hint = path === ROMLIFT_CONFIG_FILE || path === DECOMP_YAML_FILE ? 'run `romlift generate` to regenerate the tree from it, or remove it to start over' : `it is another ROM; remove ${BASEROM_FILE} to start over`;
    problems.push(diagnostic(WorkflowCodes, 'E_DIR_NOT_EMPTY', `${dir} is a romlift project whose ${path} differs from what init would write: ${hint}`, { path }));
  }
  return problems;
}

/** Whether `init` runs its lock step (npm install --package-lock-only): its write succeeded and no lock file exists yet. */
export function wantsLockStep(diagnostics: readonly Diagnostic[], hasPackageLock: boolean): boolean {
  return !hasPackageLock && !diagnostics.some((d) => d.severity === 'error');
}
