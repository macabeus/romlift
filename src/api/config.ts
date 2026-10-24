// romlift's config on disk (architecture §6.5, roadmap 4.A, D23): parseConfig, serializeConfig, planPatch,
// renderDecompYaml and readDecompYaml, and the config codes (p4-config, D74).
export { ConfigCodes } from '../core/config/codes.ts';
export type { ConfigCode } from '../core/config/codes.ts';
export { parseConfig } from '../core/config/parse.ts';
export type { ConfigParseResult } from '../core/config/parse.ts';
export { serializeConfig } from '../core/config/serialize.ts';
export { planPatch } from '../core/config/patch.ts';
export type { ConfigPatchResult } from '../core/config/patch.ts';
export { readDecompYaml, renderDecompYaml } from '../core/config/decomp-yaml.ts';
export { DECOMP_YAML_FILE, ROMLIFT_CONFIG_FILE } from '../foundation/util/project-files.ts';
export type { DecompYamlProject, DecompYamlRead, DecompYamlVars } from '../core/config/decomp-yaml.ts';
