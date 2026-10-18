export type {
  ConfigIssue,
  ConfigValidation,
  FunctionConfig,
  ModuleConfig,
  OverrideConfig,
  RomliftConfig,
  SymbolConfig,
} from '../core/config/schema.ts';
export { validateConfig } from '../core/config/schema.ts';
export type { BuildCompiler, BuildCompilerId } from '../core/config/compilers.ts';
export { BUILD_COMPILERS, buildCompilerOf, DEFAULT_BUILD_COMPILER, isBuildCompilerId } from '../core/config/compilers.ts';
export type { LayoutReason, LibraryRegion, Proposal, ProposalSource } from '../core/proposals/types.ts';
export { sourceKey } from '../core/proposals/types.ts';
export type { ConfigFromDiscoverOptions, InferModulesOptions } from '../core/layout/types.ts';
export { DEFAULT_MODULE_SIZE } from '../core/layout/types.ts';
