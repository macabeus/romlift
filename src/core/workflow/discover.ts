// The discover workflow (architecture §2.1, §3.3, D36): the analysis of a bare ROM, the run behind
// `romlift analyze <rom>`. The image is checked first; one that is not a GBA cartridge gets an empty
// result carrying its E_ROM_NOT_GBA diagnostics, never a throw. A cartridge is analysed in discover mode
// under the agbcc profile (or the one given) with the evidence-only seeds, of which phase 2 has none.
// Pure: the shell reads the file and hashes it; this file only composes.
import type { Rom } from '../../foundation/rom/rom.ts';
import { checkRom } from '../../foundation/rom/rom.ts';
import type { Span } from '../../foundation/rom/span.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { analyzeTuned, DEFAULT_TUNING } from '../analysis/driver/run.ts';
import { RULES } from '../analysis/driver/rules.ts';
import type { AnalysisOptions, AnalysisResult, AnalysisTuning } from '../analysis/types.ts';
import { profileById } from '../profile/registry.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { isRuleId } from '../provenance/rule-id.ts';
import type { RuleId } from '../provenance/rule-id.ts';
import type { TrailLevel, TrailSink } from '../provenance/trail.ts';

/** The profile discover runs with when none is given. */
export const DISCOVER_PROFILE = 'agbcc';

export interface DiscoverOptions {
  /** The compiler profile; default profileById(DISCOVER_PROFILE). */
  readonly profile?: CompilerProfile;
  /** Default 'off'. */
  readonly trail?: TrailLevel;
  /** Keep only trail events touching this span (explain). */
  readonly trailFilter?: Span;
}

/** `profile`, or the profile discover runs with by default (DISCOVER_PROFILE): every workflow's one resolver. */
export function profileOrDefault(profile?: CompilerProfile): CompilerProfile {
  if (profile !== undefined) return profile;
  const found = profileById(DISCOVER_PROFILE);
  if (found === undefined) throw new RomliftInvariantError(`the ${DISCOVER_PROFILE} profile is not registered`);
  return found;
}

/** The analysis options of a discover run: no seeds (phase 2 has no evidence), no overrides. */
export function discoverOptions(options: DiscoverOptions = {}): AnalysisOptions {
  return {
    mode: 'discover',
    seeds: [],
    overrides: [],
    trail: options.trail ?? 'off',
    ...(options.trailFilter === undefined ? {} : { trailFilter: options.trailFilter }),
  };
}

/** The result of an image that is not a cartridge: nothing analysed, only the image's diagnostics. */
function notAnalysed(rom: Rom, profile: CompilerProfile, options: AnalysisOptions, diagnostics: AnalysisResult['diagnostics']): AnalysisResult {
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
    mode: 'discover',
  };
}

/**
 * Discover with internal tuning (outside semver, D37): the CLI's `analyze --disable` passes its
 * disabled rules here. `discover` is this with DEFAULT_TUNING.
 */
export function discoverTuned(rom: Rom, options: DiscoverOptions, tuning: AnalysisTuning, sink?: TrailSink): AnalysisResult {
  const profile = profileOrDefault(options.profile);
  const analysisOptions = discoverOptions(options);
  const problems = checkRom(rom.bytes);
  if (problems.length > 0) return notAnalysed(rom, profile, analysisOptions, problems);
  return analyzeTuned(rom, profile, analysisOptions, tuning, sink);
}

/** The discover analysis of a bare ROM (architecture §2.1): the functions, rejections and diagnostics. */
export function discover(rom: Rom, options: DiscoverOptions = {}, sink?: TrailSink): AnalysisResult {
  return discoverTuned(rom, options, DEFAULT_TUNING, sink);
}

/** The tuning of `analyze --disable`: DEFAULT_TUNING with these rules turned off. */
export function disabledTuning(disabled: readonly RuleId[]): AnalysisTuning {
  return { ...DEFAULT_TUNING, disabled: [...disabled] };
}

/** The registered analysis rules `ids` names, in their order, and the ids that name none (sorted, unique). */
export function parseRuleIds(ids: readonly string[]): { readonly known: readonly RuleId[]; readonly unknown: readonly string[] } {
  const known: RuleId[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (isRuleId(id) && Object.hasOwn(RULES, id)) known.push(id);
    else unknown.push(id);
  }
  unknown.sort(compareCodeUnits);
  return { known, unknown: unknown.filter((id, i) => i === 0 || unknown[i - 1] !== id) };
}
