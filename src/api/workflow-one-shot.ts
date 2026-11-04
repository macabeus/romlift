// The one-shot workflows (architecture §2.1, roadmap 4.D): init, the project form of generate, updateProject and the
// project mode of explain, with the pure helpers their commands share (p4-workflows, D74). Exporting `init` un-pends
// the g4 gates.
export { init, initDirVerdict, replacedProblems, wantsLockStep } from '../core/workflow/init.ts';
export type { InitDirListing } from '../core/workflow/init.ts';
export type { InitFile } from '../core/workflow/types.ts';
export { BUILD_NAME_SUFFIX, builtRomCollides, initBuildName } from '../core/workflow/init-config.ts';
export { confirmProject, decompStateOf, generateProject, projectTreeEntries, reconciledTextsOf } from '../core/workflow/generate.ts';
export type { ProjectGenerateOptions } from '../core/workflow/generate.ts';
export { reconcileStubs } from '../core/workflow/c-stubs.ts';
export type { ReconciledStub, StubReconciliation } from '../core/workflow/c-stubs.ts';
export { planChangesNothing, projectPlanInputs } from '../core/write-plan/project-plan.ts';
export type { ProjectWriteState } from '../core/write-plan/project-plan.ts';
export { retainedPrefixes } from '../core/model/paths.ts';
export { updateProject, unlistedProposals } from '../core/workflow/update.ts';
export { unifiedDiff } from '../foundation/util/line-diff.ts';
export { explainProject, namePart } from '../core/workflow/explain.ts';
export type { ExplainName } from '../core/workflow/explain.ts';
export { romSha1Problems } from '../core/config/rom-sha1.ts';
export { WorkflowCodes } from '../core/workflow/codes.ts';
export type { WorkflowCode } from '../core/workflow/codes.ts';
