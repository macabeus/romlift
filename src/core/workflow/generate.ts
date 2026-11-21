// The generate workflow, phase-3 form (architecture §2.1, §6.4 steps 1 and 2, §9.4, D17, D36, D49, D62 c):
// a ROM and its config in, a checked emission stream out. The analysis runs in confirm mode with exactly the
// config's [functions] as `seed.listed` seeds (name, size, label) and its overrides; buildModel turns it into
// the Model; then the check pass: verifyModel (tiling, re-encode, module size) and ONE streaming pass over
// emitTree in which every entry is laid out by checkEntries and its path kept for checkPaths, so no tree is
// held (§9.4). The result is plain data (D19): generatedEntries(rom, result) re-runs the deterministic emission
// for the write pass (core/write-plan/project-plan.ts plans it); nothing is written here. The config `init` writes
// for a bare ROM is init-config.ts's (initConfigOf, initModel, generateFromRom). Pure: the shell reads the ROM,
// hashes it, plans the writes and applies them.
//
// Phase 4 (architecture §2.1, §6.3, §6.4, D74 c) adds generateProject, generate over a project as the shell read it
// (ProjectInputs): the ROM must be the one `[rom] sha1` records (E_ROM_SHA1_MISMATCH, refused before any analysis),
// the config is the TOML's, DecompState comes from src/*.c through the reconciler's scanner (from phase 6 it puts a
// decompiled function's chunk file under asm/matchings, D92), and a config the model refuses (E_MODULE_BORDER and the other model errors)
// is refused before the check pass. The stream holds the c-stub entries (scaffold: written only when absent) and
// modules.mk; an existing src/<module>.c is reconciled with the model (c-stubs.ts, D75 b: the stubs of functions the
// TOML renamed, deleted or moved go, the missing ones come), as edits the write plan applies only to the text it read,
// and the TOML is never touched (g4.no-toml-write). The write's pure halves (projectPlanInputs, planChangesNothing)
// are core/write-plan/project-plan.ts's (§6.4 steps 3 and 4).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import { nonmatchingFileOf } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, sortedEntries } from '../../foundation/util/sorted.ts';
import { analyze } from '../analysis/driver/run.ts';
import type { AnalysisOptions, AnalysisResult, OverrideFact, Seed } from '../analysis/types.ts';
import { romSha1Problems } from '../config/rom-sha1.ts';
import { listedEntries } from '../config/schema.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { emitTree } from '../emit/emit-tree.ts';
import type { DecompState, EmitContext, FileEntry, Printer } from '../emit/tree.ts';
import { buildModel } from '../model/model.ts';
import type { Model } from '../model/types.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { compiledDefinitions, scanC } from '../reconcile/c-scan.ts';
import { combineReports } from '../verify/report.ts';
import type { VerifyReport } from '../verify/report.ts';
import { checkEntries } from '../verify/text-layout.ts';
import { verifyModel } from '../verify/tiling.ts';
import {
  NO_STUBS,
  outTreeEntries,
  projectEntries,
  reconcileStubs,
  reconciledBases,
  resolvedEntries,
} from './c-stubs.ts';
import type { StubReconciliation } from './c-stubs.ts';
import { configFromDiscover } from './config-from-discover.ts';
import { profileOrDefault } from './discover.ts';
import type { GeneratePlan, ProjectInputs } from './types.ts';

export interface GenerateInputs {
  readonly rom: Rom;
  readonly config: RomliftConfig;
  /** The names src/*.c defines (decompStateOf); empty for a tree with no C of its own (init's, a bare ROM's). */
  readonly decomp: DecompState;
  readonly printer: Printer;
  /** The compiler profile of the analysis; default the discover profile (agbcc). */
  readonly profile?: CompilerProfile;
  /** The SHA-1 of the project's romlift.toml (EmitContext.configSha1), recorded in modules.mk; absent outside a project. */
  readonly configSha1?: string;
}

/** The confirm analysis of a config and the Model built from it. */
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

/**
 * The seeds of a confirm run: every [functions] and [entry_points] entry as `seed.listed`, with its name and size, an
 * entry point as an inner label (`label: true`, D114, D116), by address; an entry with `from` (another source's
 * proposal, §6.5) is validated (`validate: true`), one without is not.
 */
export function listedSeedsOf(config: RomliftConfig): readonly Seed[] {
  return sortedEntries(listedEntries(config)).map(
    ([entry, f]): Seed => ({
      entry,
      mode: f.mode,
      rule: 'seed.listed',
      name: f.name,
      ...(f.size === undefined ? {} : { size: f.size }),
      ...(config.entryPoints.has(entry) ? { label: true } : {}),
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
function notAnalysed(
  rom: Rom,
  profile: CompilerProfile,
  options: AnalysisOptions,
  diagnostics: readonly Diagnostic[],
): AnalysisResult {
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
  const profile = profileOrDefault(inputs.profile);
  const options = confirmOptions(config);
  const problems = checkRom(rom.bytes);
  const analysis = problems.length > 0 ? notAnalysed(rom, profile, options, problems) : analyze(rom, profile, options);
  return { analysis, model: buildModel(rom, analysis, config) };
}

/**
 * `entries` as a stream that records each path as it passes, as the check pass reads it: a decompiled function's
 * chunk file, which the function writer puts under asm/matchings (core/emit/unit-text.ts writtenChunkPath, phase 6,
 * D92), is read at its chunk's model path under asm/nonmatchings (nonmatchingFileOf), where the text-layout check
 * indexes every chunk file and the C stub the model implies includes it; its text is the same. `paths` records the
 * path the write pass writes.
 */
function* recordingPaths(entries: Iterable<FileEntry>, paths: string[]): Generator<FileEntry> {
  for (const entry of entries) {
    paths.push(entry.path);
    yield entry.ownership === 'generated' && entry.writer === 'function'
      ? { ...entry, path: nonmatchingFileOf(entry.path) }
      : entry;
  }
}

/**
 * The phase-3 generate (architecture §6.4 steps 1 and 2): the confirm analysis, the Model, and the check pass
 * over one streaming emission. The tree is not kept; generatedEntries(rom, result) emits it again for the write
 * pass.
 */
export function generate(inputs: GenerateInputs): GenerateResult {
  return checkPass(inputs.rom, confirmModel(inputs), {
    decomp: inputs.decomp,
    printer: inputs.printer,
    ...(inputs.configSha1 === undefined ? {} : { configSha1: inputs.configSha1 }),
  });
}

/** The check pass over a confirmed model (§6.4 step 2): verifyModel, then one streaming pass of checkEntries. */
function checkPass(rom: Rom, confirmed: ConfirmedModel, cx: EmitContext): GenerateResult {
  const { analysis, model } = confirmed;
  const paths: string[] = [];
  const report = combineReports(
    verifyModel(rom, model),
    checkEntries(rom, model, recordingPaths(emitTree(rom, model, cx), paths)),
  );
  return { analysis, model, report, paths, diagnostics: [...analysis.diagnostics, ...model.diagnostics], cx };
}

/**
 * The emission stream of a generate result again, as a directory other than the project receives it (a fresh tree,
 * the tree checks' temporary directory, `generate --out`): entry for entry what its check pass read, but an existing C
 * file's entry holds its reconciled text (c-stubs.ts resolvedEntries), the C `make` compiles.
 */
export function generatedEntries(
  rom: Rom,
  result: Pick<GenerateResult, 'model' | 'cx' | 'stubs'>,
): Iterable<FileEntry> {
  return resolvedEntries(emitTree(rom, result.model, result.cx), result.stubs ?? NO_STUBS);
}

/**
 * The emission stream of a generate result as the project receives it: an existing C file's entry is a `reconciled`
 * edit of the text the shell read (c-stubs.ts projectEntries; `hash`, the shell's sha1, names its base).
 */
export function projectTreeEntries(
  rom: Rom,
  result: Pick<GenerateResult, 'model' | 'cx' | 'stubs'>,
  hash: (text: string) => string,
): Iterable<FileEntry> {
  return projectEntries(emitTree(rom, result.model, result.cx), result.stubs ?? NO_STUBS, hash);
}

/** The base texts of the reconciled C files of a result, for WritePlanInputs.reconciledTexts. */
export function reconciledTextsOf(result: Pick<GenerateResult, 'stubs'>): ReadonlyMap<string, string> {
  return reconciledBases(result.stubs ?? NO_STUBS);
}

/**
 * The emission stream `generate --out <dir>` writes: generatedEntries with every C file `generated`, so a later run
 * into the same directory rewrites or deletes it as it does asm/ (c-stubs.ts outTreeEntries).
 */
export function outTreeEntriesOf(
  rom: Rom,
  result: Pick<GenerateResult, 'model' | 'cx' | 'stubs'>,
): Iterable<FileEntry> {
  return outTreeEntries(generatedEntries(rom, result));
}

/** Whether a generate result may be written: its check pass is ok and nothing raised an error (§6.4 step 2). */
export function writable(result: Pick<GenerateResult, 'report' | 'diagnostics'>): boolean {
  return result.report.ok && !result.diagnostics.some((d) => d.severity === 'error');
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
 * The DecompState of a project's C: every name a src/*.c defines at file scope that the default build compiles (the
 * reconciler's scanner and its compiledDefinitions, never a regex: a definition inside an `#if` region, the
 * NONMATCHING pattern's, does not count, as for the reconciler, architecture-a2-3), unique, in code-unit order. It
 * decides one thing (phase 6, D92): a function of a `c` module named here is written under asm/matchings
 * (core/emit/unit-text.ts writtenChunkPath). A name defined in a file that is not its module's source raises
 * E_C_DEFINITION_MOVED in the reconciliation, so nothing is written while the two disagree. Policy for a file the
 * scanner cannot split (fix round 5, architecture-b0-2): its definitions as far as the scanner read them, never a
 * refusal, and the reconciliation raises the file's own E_C_UNSCANNABLE or W_C_UNSCANNABLE.
 */
export function decompStateOf(cTexts: ReadonlyMap<string, string>): DecompState {
  const names = new Set<string>();
  for (const path of [...cTexts.keys()].sort(compareCodeUnits)) {
    for (const d of compiledDefinitions(scanC(cTexts.get(path) ?? '')).definitions) names.add(d.name);
  }
  return { defined: [...names].sort(compareCodeUnits) };
}

/** The confirm analysis and Model of a project's config, or the refusal of another ROM (`explain` in a project, and the gates). */
export function confirmProject(
  inputs: Pick<ProjectInputs, 'rom' | 'config' | 'profile'>,
): ({ readonly ok: true } & ConfirmedModel) | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const refused = romSha1Problems(inputs.rom, inputs.config);
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
  const checked = checkPass(inputs.rom, confirmed, {
    decomp: decompStateOf(inputs.cTexts),
    printer: options.printer ?? 'readable',
    ...(inputs.configSha1 === undefined ? {} : { configSha1: inputs.configSha1 }),
  });
  const stubs = reconcileStubs(
    confirmed.model,
    inputs.cTexts,
    inputs.previousChunkFiles,
    inputs.headerTexts,
    inputs.headerRealPaths,
  );
  const result: GenerateResult = { ...checked, stubs, diagnostics: [...checked.diagnostics, ...stubs.diagnostics] };
  return { ok: true, result, diagnostics: result.diagnostics };
}
