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
//
// Phase 4 (architecture §2.1, §6.3, §6.4, D74 c) adds generateProject, generate over a project as the shell read it
// (ProjectInputs): the ROM must be the one `[rom] sha1` records (E_ROM_SHA1_MISMATCH, refused before any analysis),
// the config is the TOML's, DecompState comes from src/*.c through the reconciler's scanner (it changes no output in
// phase 4: asm/matchings is phase 5's), and a config the model refuses (E_MODULE_BORDER and the other model errors)
// is refused before the check pass. The stream holds the c-stub entries (scaffold: written only when absent) and
// modules.mk; an existing src/<module>.c is reconciled with the model (c-stubs.ts, D75 b: the stubs of functions the
// TOML renamed, deleted or moved go, the missing ones come), as edits the write plan applies only to the text it read,
// and the TOML is never touched (g4.no-toml-write). projectPlanInputs and planChangesNothing are the pure halves of
// the write the shell makes (§6.4 steps 3 and 4).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import { expectedSha1Problems } from '../../foundation/rom/expected-sha1.ts';
import { compareCodeUnits, sortedEntries } from '../../foundation/util/sorted.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisOptions, AnalysisResult, OverrideFact, Seed } from '../analysis/types.ts';
import { ROMLIFT_CONFIG_FILE } from '../config/decomp-yaml.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { emitTree } from '../emit/emit-tree.ts';
import type { DecompState, EmitContext, FileEntry, Printer } from '../emit/tree.ts';
import { buildModel } from '../model/model.ts';
import { modulePathPrefixes } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import { profileById } from '../profile/registry.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { scanC } from '../reconcile/include-asm.ts';
import { combineReports } from '../verify/report.ts';
import type { VerifyReport } from '../verify/report.ts';
import { checkEntries } from '../verify/text-layout.ts';
import { verifyModel } from '../verify/tiling.ts';
import type { Journal } from '../write-plan/journal.ts';
import { encodeManifest } from '../write-plan/manifest.ts';
import type { Manifest, WritePlan, WritePlanInputs } from '../write-plan/types.ts';
import { NO_STUBS, projectEntries, reconcileStubs, resolvedEntries } from './c-stubs.ts';
import type { StubReconciliation } from './c-stubs.ts';
import { configFromDiscover } from './config-from-discover.ts';
import { discover, DISCOVER_PROFILE } from './discover.ts';
import type { GeneratePlan, ProjectInputs } from './types.ts';

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
  /** The project's existing C files reconciled with the model (generateProject; none for a fresh tree, D75 b). */
  readonly stubs?: StubReconciliation;
}

function defaultProfile(): CompilerProfile {
  const profile = profileById(DISCOVER_PROFILE);
  if (profile === undefined) throw new RomliftInvariantError(`the ${DISCOVER_PROFILE} profile is not registered`);
  return profile;
}

/**
 * The seeds of a confirm run: every [functions] entry as `seed.listed`, with its name, size and label, by address;
 * an entry with `from` (another source's proposal, §6.5) is validated (`validate: true`), one without is not.
 */
export function listedSeedsOf(config: RomliftConfig): readonly Seed[] {
  return sortedEntries(config.functions).map(
    ([entry, f]): Seed => ({
      entry,
      mode: f.mode,
      rule: 'seed.listed',
      name: f.name,
      ...(f.size === undefined ? {} : { size: f.size }),
      ...(f.label === true ? { label: true } : {}),
      ...(f.from === undefined ? {} : { validate: true }),
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
  return checkPass(inputs.rom, confirmModel(inputs), { decomp: inputs.decomp, printer: inputs.printer });
}

/** The check pass over a confirmed model (§6.4 step 2): verifyModel, then one streaming pass of checkEntries. */
function checkPass(rom: Rom, confirmed: ConfirmedModel, cx: EmitContext): GenerateResult {
  const { analysis, model } = confirmed;
  const paths: string[] = [];
  const report = combineReports(verifyModel(rom, model), checkEntries(rom, model, recordingPaths(emitTree(rom, model, cx), paths)));
  return { analysis, model, report, paths, diagnostics: [...analysis.diagnostics, ...model.diagnostics], cx };
}

/**
 * The emission stream of a generate result again, as a directory other than the project receives it (a fresh tree,
 * `verify`'s temporary directory, `generate --out`): entry for entry what its check pass read, but an existing C
 * file's entry holds its reconciled text (c-stubs.ts resolvedEntries), the C `make` compiles.
 */
export function generatedEntries(rom: Rom, result: Pick<GenerateResult, 'model' | 'cx' | 'stubs'>): Iterable<FileEntry> {
  return resolvedEntries(emitTree(rom, result.model, result.cx), result.stubs ?? NO_STUBS);
}

/**
 * The emission stream of a generate result as the project receives it: an existing C file's entry is a `reconciled`
 * edit of the text the shell read (c-stubs.ts projectEntries; `hash`, the shell's sha1, names its base).
 */
export function projectTreeEntries(rom: Rom, result: Pick<GenerateResult, 'model' | 'cx' | 'stubs'>, hash: (text: string) => string): Iterable<FileEntry> {
  return projectEntries(emitTree(rom, result.model, result.cx), result.stubs ?? NO_STUBS, hash);
}

/** The base texts of the reconciled C files of a result, for WritePlanInputs.reconciledTexts. */
export function reconciledTextsOf(result: Pick<GenerateResult, 'stubs'>): ReadonlyMap<string, string> {
  return new Map([...(result.stubs ?? NO_STUBS).files].map(([path, stub]) => [path, stub.base] as const));
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
    retained: retainedPrefixes(model),
  };
}

/** The path prefixes of the modules romlift does not generate (`generated = false`): planWrites never touches them. */
export function retainedPrefixes(model: Pick<Model, 'modules' | 'chunks'>): readonly string[] {
  return model.modules.filter((m) => !m.generated).flatMap((m) => [...modulePathPrefixes(model, m)]);
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
 * do not fit under the `romlift` bin's heap cap (384 MiB then, 1,024 MiB since D72; D69; phase-3.md, fix round 4).
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

// ---------------------------------------------------------------------------------------------------
// Phase 4: generate over a project (ProjectInputs, D74 c).

/** generateProject's options: the printer (default 'readable'; `verify --printer raw` in a project passes 'raw'). */
export interface ProjectGenerateOptions {
  readonly printer?: Printer;
}

/**
 * The DecompState of a project's C: every name a src/*.c defines at file scope (the reconciler's scanner, never a
 * regex), unique, in code-unit order. Phase 4 emits nothing differently for it (asm/matchings is phase 5's).
 */
export function decompStateOf(cTexts: ReadonlyMap<string, string>): DecompState {
  const names = new Set<string>();
  for (const path of [...cTexts.keys()].sort(compareCodeUnits)) {
    for (const d of scanC(cTexts.get(path) ?? '').definitions) if (d.name !== '') names.add(d.name);
  }
  return { defined: [...names].sort(compareCodeUnits) };
}

/** E_ROM_SHA1_MISMATCH when the project's ROM is not the one its config's `[rom] sha1` records; empty otherwise. */
export function projectRomProblems(inputs: Pick<ProjectInputs, 'rom' | 'config'>): readonly Diagnostic[] {
  return expectedSha1Problems(inputs.rom, inputs.config.rom.sha1, ROMLIFT_CONFIG_FILE);
}

/** The confirm analysis and Model of a project's config, or the refusal of another ROM (`model` and `explain` in a project). */
export function confirmProject(inputs: Pick<ProjectInputs, 'rom' | 'config' | 'profile'>): ({ readonly ok: true } & ConfirmedModel) | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const refused = projectRomProblems(inputs);
  if (refused.length > 0) return { ok: false, diagnostics: refused };
  return { ok: true, ...confirmModel(inputs) };
}

/**
 * `generate` over a project (architecture §2.1, §6.4 steps 1 and 2): refused (`ok: false`) before any analysis when
 * the ROM is not the config's, and before the check pass when the model raises an error (an illegal border, a name
 * collision: E_MODULE_BORDER and the other model errors), so nothing is written and the command exits 1. Otherwise
 * the checked emission: a failed self-check is in `result.report` (exit 3, nothing written).
 */
export function generateProject(inputs: ProjectInputs, options: ProjectGenerateOptions = {}): GeneratePlan {
  const confirmed = confirmProject(inputs);
  if (!confirmed.ok) return confirmed;
  const modelDiagnostics = [...confirmed.analysis.diagnostics, ...confirmed.model.diagnostics];
  if (modelDiagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics: modelDiagnostics };
  const checked = checkPass(inputs.rom, confirmed, { decomp: decompStateOf(inputs.cTexts), printer: options.printer ?? 'readable' });
  const stubs = reconcileStubs(confirmed.model, inputs.cTexts);
  const result: GenerateResult = { ...checked, stubs, diagnostics: [...checked.diagnostics, ...stubs.diagnostics] };
  return { ok: true, result, diagnostics: result.diagnostics };
}

/** What the shell read of the directory a tree is written into, for planWrites (§6.4 step 3). */
export interface ProjectWriteState {
  readonly manifest: Manifest | null;
  readonly journal: Journal | null;
  /** The sha1 of every tree path, manifest path and file under the generated roots, or 'absent'. */
  readonly disk: ReadonlyMap<string, string | 'absent'>;
  readonly reconciledTexts: ReadonlyMap<string, string>;
}

/** The planWrites inputs of writing `entries` (a model's stream, plus any scaffold entries) over `state`. */
export function projectPlanInputs(
  model: Pick<Model, 'modules' | 'chunks'>,
  entries: Iterable<FileEntry>,
  state: ProjectWriteState,
  hash: (text: string) => string,
  romlift: string,
): WritePlanInputs {
  return {
    entries,
    manifest: state.manifest,
    disk: state.disk,
    reconciledTexts: state.reconciledTexts,
    hash,
    retained: retainedPrefixes(model),
    journal: state.journal,
    romlift,
  };
}

function manifestText(manifest: Manifest): string {
  return [...encodeManifest(manifest)].join('');
}

/**
 * Whether applying `plan` would change nothing on disk: every op is a keep, no interrupted run's journal is left,
 * and the manifest it would write is the one already there. The shell then skips the apply step, so `generate`
 * right after `init` leaves every file, the manifest included, with its modification time (g4.generate-idempotent).
 */
export function planChangesNothing(plan: Pick<WritePlan, 'ops' | 'manifest'>, state: Pick<ProjectWriteState, 'manifest' | 'journal'>): boolean {
  if (state.journal !== null || state.manifest === null) return false;
  if (!plan.ops.every((op) => op.op === 'keep')) return false;
  return manifestText(plan.manifest) === manifestText(state.manifest);
}
