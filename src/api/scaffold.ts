// The scaffold renderer (architecture §6.3, roadmap 4.B, D74 i): renderScaffold and the texts of the files romlift
// renders without a template. The frozen scaffold types are in one-shot-types.ts.
export {
  AGBCC_SUBMODULE_PATH,
  gitmodulesText,
  npmPackageName,
  packageJsonText,
  renderScaffold,
  sha1FileText,
} from '../core/scaffold/render.ts';
export type { ScaffoldFileEntry } from '../core/scaffold/render.ts';
