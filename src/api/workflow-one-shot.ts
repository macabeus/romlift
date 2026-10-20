// The one-shot workflows (architecture §2.1, roadmap 4.D): init, the project form of generate, analyzeUpdate and the
// project mode of explain, with the pure helpers their commands share (p4-workflows, D74). Exporting `init` un-pends
// the g4 gates.
export { BUILD_NAME_SUFFIX, builtRomCollides, init, initBuildName, projectScaffold, scaffoldDrift } from '../core/workflow/init.ts';
export type { ProjectScaffoldInputs, ScaffoldDrift } from '../core/workflow/init.ts';
export {
  confirmProject,
  decompStateOf,
  generateProject,
  planChangesNothing,
  projectPlanInputs,
  projectRomProblems,
  retainedPrefixes,
} from '../core/workflow/generate.ts';
export type { ProjectGenerateOptions, ProjectWriteState } from '../core/workflow/generate.ts';
export { analyzeUpdate, unifiedDiff, unlistedProposals, updateSeeds } from '../core/workflow/analyze-update.ts';
export { explainProject, namePart } from '../core/workflow/explain.ts';
export type { ExplainName } from '../core/workflow/explain.ts';
export { expectedSha1Problems } from '../foundation/rom/expected-sha1.ts';
