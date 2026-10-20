// The spellings a project's own files and romlift's default names share across layers (architecture §6.2, §6.5,
// D75 g): defined once here, so core/config, core/model, core/scaffold and the shell cannot drift apart.
import { hex } from './hex.ts';

/** The user's ROM at a project's root, whatever name `init` was given: the config's [rom] path and the only file an `.incbin` reads. */
export const BASEROM_FILE = 'baserom.gba';

/** romlift's config file, as `init` names it and decomp.yaml's `tools.romlift.config` points to it. */
export const ROMLIFT_CONFIG_FILE = 'romlift.toml';

/** The settings file the tools look for in a project's root. */
export const DECOMP_YAML_FILE = 'decomp.yaml';

/** The names a project's settings file may have, in the order they are looked for (the decomp_settings spec allows both). */
export const DECOMP_YAML_NAMES: readonly string[] = [DECOMP_YAML_FILE, 'decomp.yml'];

/** The default name of a function: sub_ and eight upper-case hex digits. */
export function defaultFunctionName(addr: number): string {
  return `sub_${hex(addr)}`;
}
