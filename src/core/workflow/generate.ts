// The generate workflow, phase-3 form (architecture §2.1, §6.4 steps 1 and 2, §9.4, D17, D36, D49, D62 c):
// a ROM and its config in, a checked emission stream out. The analysis runs in confirm mode with exactly the
// config's [functions] as `seed.listed` seeds (name, size, label) and its overrides; buildModel turns it into
// the Model; then the check pass: verifyModel (tiling, re-encode, module size) and ONE streaming pass over
// emitTree in which every entry is laid out by checkEntry and its path kept for checkPaths, so no tree is
// held (§9.4). `entries()` re-runs the deterministic emission for the write pass; nothing is written here.
// In phase 3 the config is the in-memory one configFromDiscover builds (D62 c); phase 4 reads the TOML.
// Pure: the shell reads the ROM, hashes it, plans the writes and applies them.
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
import type { Model } from '../model/types.ts';
import { profileById } from '../profile/registry.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { combineReports } from '../verify/report.ts';
import type { VerifyReport } from '../verify/report.ts';
import { checkEntries } from '../verify/text-layout.ts';
import { verifyModel } from '../verify/tiling.ts';
import { DISCOVER_PROFILE } from './discover.ts';

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
  /** The emission stream again, entry for entry what the check pass read (§6.4: the write pass re-runs it). */
  readonly entries: () => Iterable<FileEntry>;
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
 * over one streaming emission. The tree is not kept; `entries()` emits it again for the write pass.
 */
export function generate(inputs: GenerateInputs): GenerateResult {
  const { rom } = inputs;
  const { analysis, model } = confirmModel(inputs);
  const cx: EmitContext = { decomp: inputs.decomp, printer: inputs.printer };
  const entries = (): Iterable<FileEntry> => emitTree(rom, model, cx);
  const paths: string[] = [];
  const report = combineReports(verifyModel(rom, model), checkEntries(rom, model, recordingPaths(entries(), paths)));
  return { analysis, model, report, paths, diagnostics: [...analysis.diagnostics, ...model.diagnostics], entries };
}
