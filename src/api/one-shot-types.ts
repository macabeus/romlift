export type {
  AnalyzeUpdateInputs,
  AnalyzeUpdatePlan,
  GeneratePlan,
  InitInputs,
  InitOptions,
  InitPlan,
  ProjectInputs,
} from '../core/workflow/types.ts';
export type { AgbccPin, Decoded, ScaffoldManifest, ScaffoldPlaceholder, ScaffoldTemplate, ScaffoldTemplates, ScaffoldVars } from '../core/scaffold/vars.ts';
export {
  decodeAgbccPin,
  decodeScaffoldManifest,
  placeholdersIn,
  placeholderText,
  placeholderValues,
  ROMLIFT_RENDERED_TARGETS,
  SCAFFOLD_PLACEHOLDERS,
  SCAFFOLD_ROM_FILE,
  scaffoldVars,
} from '../core/scaffold/vars.ts';
export {
  C_STUB_HEADER,
  INCLUDE_ASM_HEADER,
  INCLUDE_ASM_HEADER_PATH,
  includeAsmStatement,
  NONMATCHINGS_ROOT,
} from '../foundation/asm/dialect.ts';
