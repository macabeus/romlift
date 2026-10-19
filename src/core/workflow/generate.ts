// The generate workflow, phase-3 form (architecture §2.1, §6.4 steps 1 and 2, §9.4, D17, D36, D49, D62 c):
// a ROM and its config in, a checked emission stream out. The analysis runs in confirm mode with exactly the
// config's [functions] as `seed.listed` seeds (name, size, label) and its overrides; buildModel turns it into
// the Model; then the check pass: verifyModel (tiling, re-encode, module size) and ONE streaming pass over
// emitTree in which every entry is laid out by checkEntry and its path kept for checkPaths, so no tree is
// held (§9.4). The result is plain data (D19): generatedEntries(rom, result) re-runs the deterministic emission
// for the write pass, and freshTreePlanInputs plans that pass into an empty directory; nothing is written here.
// In phase 3 the config is the in-memory one configFromDiscover builds (D62 c), and initConfig, initModel and
// generateFromRom are the `init` equivalents every phase-3 command and the bench start from; phase 4 reads the
// TOML. Pure: the shell reads the ROM, hashes it, plans the writes and applies them.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import { sortedEntries } from '../../foundation/util/sorted.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisOptions, AnalysisResult, OverrideFact, Seed } from '../analysis/types.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { emitTree } from '../emit/emit-tree.ts';
import type { DecompState, EmitContext, FileEntry, Printer } from '../emit/tree.ts';
import { buildModel } from '../model/model.ts';
import { modulePathPrefixes } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import { profileById } from '../profile/registry.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { combineReports } from '../verify/report.ts';
import type { VerifyReport } from '../verify/report.ts';
import { checkEntries } from '../verify/text-layout.ts';
import { verifyModel } from '../verify/tiling.ts';
import type { WritePlanInputs } from '../write-plan/types.ts';
import { configFromDiscover } from './config-from-discover.ts';
import { discover, DISCOVER_PROFILE } from './discover.ts';

export interface GenerateInputs {
  readonly rom: Rom;
  readonly config: RomliftConfig;
  /** The names src/*.c defines; phase 3 has no C, so an empty set. */
  readonly decomp: DecompState;
  readonly printer: Printer;
  /** The compiler profile of the analysis; default the discover profile (agbcc). */
  readonly profile?: CompilerProfile;
}

/** The confirm analysis of a config and the Model built from it: what `model --json` prints. */
export interface ConfirmedModel {
  readonly analysis: AnalysisResult;
  readonly model: Model;
}

export interface GenerateResult extends ConfirmedModel {
  /** The check pass: tiling, re-encode, module size, text layout and paths, in CHECK_IDS order. */
  readonly report: VerifyReport;
  /** The stream's paths in stream order, all the check pass kept of the tree (the write pass's disk snapshot reads them). */
  readonly paths: readonly string[];
  /** The analysis and model diagnostics; the checks' own are in `report`. */
  readonly diagnostics: readonly Diagnostic[];
  /** The context the check pass emitted with; generatedEntries emits with it again (§6.4: the write pass re-runs it). */
  readonly cx: EmitContext;
}

function defaultProfile(): CompilerProfile {
  const profile = profileById(DISCOVER_PROFILE);
  if (profile === undefined) throw new RomliftInvariantError(`the ${DISCOVER_PROFILE} profile is not registered`);
  return profile;
}

/** The seeds of a confirm run: every [functions] entry as `seed.listed`, with its name, size and label, by address. */
export function listedSeedsOf(config: RomliftConfig): readonly Seed[] {
  return sortedEntries(config.functions).map(
    ([entry, f]): Seed => ({
      entry,
      mode: f.mode,
      rule: 'seed.listed',
      name: f.name,
      ...(f.size === undefined ? {} : { size: f.size }),
      ...(f.label === true ? { label: true } : {}),
    }),
  );
}

/** The analysis facts of the config's [[overrides]]. */
export function overrideFactsOf(config: RomliftConfig): readonly OverrideFact[] {
  return config.overrides.map(
    (o): OverrideFact => ({
      span: { start: o.start, end: o.start + o.size },
      kind: o.kind,
      ...(o.mode === undefined ? {} : { mode: o.mode }),
      ...(o.runsAt === undefined ? {} : { runsAt: o.runsAt }),
    }),
  );
}

/** The analysis options of `generate`: confirm mode over exactly the config's functions and overrides, no trail. */
export function confirmOptions(config: RomliftConfig): AnalysisOptions {
  return { mode: 'confirm', seeds: listedSeedsOf(config), overrides: overrideFactsOf(config), trail: 'off' };
}

/** The confirm result of an image that is not a cartridge: nothing analysed, only the image's diagnostics. */
function notAnalysed(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, diagnostics: readonly Diagnostic[]): AnalysisResult {
  return {
    schema: 'romlift/analysis@1',
    rom: { sha1: rom.sha1, end: rom.end },
    profile: profile.id,
    options,
    functions: [],
    claims: [],
    startup: { span: { start: rom.base, end: rom.base }, entries: [] },
    codeEnd: rom.base,
    rejections: [],
    diagnostics,
    mode: 'confirm',
    unlisted: [],
    listedInvalid: [],
  };
}

/** The confirm analysis of `config` and its Model (architecture §3.4): the model `generate` emits. */
export function confirmModel(inputs: Pick<GenerateInputs, 'rom' | 'config' | 'profile'>): ConfirmedModel {
  const { rom, config } = inputs;
  const profile = inputs.profile ?? defaultProfile();
  const options = confirmOptions(config);
  const problems = checkRom(rom.bytes);
  const analysis = problems.length > 0 ? notAnalysed(rom, profile, options, problems) : analyze(rom, profile, options);
  return { analysis, model: buildModel(rom, analysis, config) };
}

/** `entries` as a stream that records each path as it passes. */
function* recordingPaths(entries: Iterable<FileEntry>, paths: string[]): Generator<FileEntry> {
  for (const entry of entries) {
    paths.push(entry.path);
    yield entry;
  }
}

/**
 * The phase-3 generate (architecture §6.4 steps 1 and 2): the confirm analysis, the Model, and the check pass
 * over one streaming emission. The tree is not kept; generatedEntries(rom, result) emits it again for the write
 * pass.
 */
export function generate(inputs: GenerateInputs): GenerateResult {
  const { rom } = inputs;
  const { analysis, model } = confirmModel(inputs);
  const cx: EmitContext = { decomp: inputs.decomp, printer: inputs.printer };
  const paths: string[] = [];
  const report = combineReports(verifyModel(rom, model), checkEntries(rom, model, recordingPaths(emitTree(rom, model, cx), paths)));
  return { analysis, model, report, paths, diagnostics: [...analysis.diagnostics, ...model.diagnostics], cx };
}

/** The emission stream of a generate result again, entry for entry what its check pass read. */
export function generatedEntries(rom: Rom, result: Pick<GenerateResult, 'model' | 'cx'>): Iterable<FileEntry> {
  return emitTree(rom, result.model, result.cx);
}

/** Whether a generate result may be written: its check pass is ok and nothing raised an error (§6.4 step 2). */
export function writable(result: Pick<GenerateResult, 'report' | 'diagnostics'>): boolean {
  return result.report.ok && !result.diagnostics.some((d) => d.severity === 'error');
}

/**
 * The planWrites inputs of writing `entries` (a model's stream, whose paths are `paths`) into an empty
 * directory, as a fresh project is written: no manifest, every path absent on disk, no reconciled text, and the
 * files of the modules romlift does not generate retained. `hash` is the shell's sha1 (core never hashes).
 */
export function freshTreePlanInputs(model: Model, entries: Iterable<FileEntry>, paths: readonly string[], hash: (text: string) => string): WritePlanInputs {
  return {
    entries,
    manifest: null,
    disk: new Map(paths.map((p) => [p, 'absent'] as const)),
    reconciledTexts: new Map(),
    hash,
    retained: model.modules.filter((m) => !m.generated).flatMap((m) => [...modulePathPrefixes(model, m)]),
  };
}

// ---------------------------------------------------------------------------------------------------
// The phase-3 `init` equivalents: a ROM alone, the config configFromDiscover builds from its discover run.

/** The config `init` would write for a ROM, with the discover analysis it came from; refused on a discover error. */
export type InitConfig =
  | { readonly ok: true; readonly discovered: AnalysisResult; readonly config: RomliftConfig }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** The discover analysis of `rom` and configFromDiscover over it, or the discover run's diagnostics when one is an error. */
export function initConfig(rom: Rom, options: { readonly profile?: CompilerProfile } = {}): InitConfig {
  const discovered = discover(rom, options.profile === undefined ? {} : { profile: options.profile });
  if (discovered.diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: discovered.diagnostics };
  return { ok: true, discovered, config: configFromDiscover(rom, discovered) };
}

/**
 * initConfig without its discover analysis: initModel and generateFromRom run the confirm analysis next, and the
 * discover result (about as large as the confirm one on a 32 MiB ROM) must be garbage by then, or the two together
 * do not fit under the `romlift` bin's 384 MiB heap cap (D69; phase-3.md, fix round 4).
 */
function configAlone(rom: Rom, options: { readonly profile?: CompilerProfile }): { readonly ok: true; readonly config: RomliftConfig } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const init = initConfig(rom, options);
  return init.ok ? { ok: true, config: init.config } : init;
}

/** What `model --json` prints for a ROM: initConfig, then the confirm analysis over that config and its Model. */
export type InitModel = ({ readonly ok: true; readonly config: RomliftConfig } & ConfirmedModel) | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function initModel(rom: Rom, options: { readonly profile?: CompilerProfile } = {}): InitModel {
  const init = configAlone(rom, options);
  if (!init.ok) return init;
  return { ok: true, config: init.config, ...confirmModel({ rom, config: init.config, ...(options.profile === undefined ? {} : { profile: options.profile }) }) };
}

/** generate over the config initConfig builds: what `verify --rom` and the bench's `init` run check and write. */
export type GenerateFromRom = ({ readonly ok: true; readonly config: RomliftConfig } & GenerateResult) | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export function generateFromRom(rom: Rom, inputs: Omit<GenerateInputs, 'rom' | 'config'>): GenerateFromRom {
  const init = configAlone(rom, inputs.profile === undefined ? {} : { profile: inputs.profile });
  if (!init.ok) return init;
  return { ok: true, config: init.config, ...generate({ ...inputs, rom, config: init.config }) };
}

/** The Model of a discover run under the config configFromDiscover builds from it (explain's and the bench's readability model). */
export function discoverModel(rom: Rom, discovered: AnalysisResult): Model {
  return buildModel(rom, discovered, configFromDiscover(rom, discovered));
}
