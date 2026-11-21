export type {
  UpdateInputs,
  UpdatePlan,
  GeneratePlan,
  InitInputs,
  InitOptions,
  InitPlan,
  ProjectInputs,
} from '../core/workflow/types.ts';
export type {
  AgbccPin,
  Decoded,
  ScaffoldManifest,
  ScaffoldPlaceholder,
  ScaffoldTemplate,
  ScaffoldTemplates,
  ScaffoldVars,
} from '../core/scaffold/vars.ts';
export {
  decodeAgbccPin,
  decodeScaffoldManifest,
  placeholdersIn,
  placeholderText,
  placeholderValues,
  ROMLIFT_RENDERED_TARGETS,
  SCAFFOLD_PLACEHOLDERS,
  scaffoldVars,
} from '../core/scaffold/vars.ts';
export { C_STUB_HEADER, INCLUDE_ASM_HEADER, includeAsmStatement } from '../foundation/asm/dialect.ts';
export { BASEROM_FILE, INCLUDE_ASM_HEADER_PATH, NONMATCHINGS_ROOT } from '../foundation/util/project-files.ts';
