// romlift/node's config files (architecture §6.5, roadmap 4.A): loadConfig, saveConfig and locateProject (p4-config,
// D74).
export { loadConfig } from '../shell/config/load.ts';
export type { LoadConfigResult, ProjectConfig } from '../shell/config/load.ts';
export { saveConfig } from '../shell/config/save.ts';
export { DECOMP_YAML_NAMES } from '../foundation/util/project-files.ts';
export { locateProject } from '../shell/project/locate.ts';
export type { LocateResult, ProjectLocation } from '../shell/project/locate.ts';
