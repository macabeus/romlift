// Saving romlift.toml (architecture §6.4, §6.5): the text the patch planner or `init` produced, written through a
// temporary file in the same directory, flushed to disk and renamed over the old file (shell/fs.ts atomicWrite), so
// a reader or a crash sees the old config or the new one, never a part. The shell decides nothing: the text is
// written as given.
import { join } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ROMLIFT_CONFIG_FILE } from '../../foundation/util/project-files.ts';
import { isProjectPath } from '../../foundation/util/project-path.ts';
import { ShellCodes } from '../codes.ts';
import { atomicWrite } from '../fs.ts';
import type { IoResult } from '../fs.ts';

/**
 * Writes `text` to the config of the project in `dir`: `configPath` (a project path, as loadConfig's
 * `project.config` gives it), default romlift.toml.
 */
export async function saveConfig(
  dir: string,
  text: string,
  configPath: string = ROMLIFT_CONFIG_FILE,
): Promise<IoResult<void>> {
  if (!isProjectPath(configPath)) {
    return {
      ok: false,
      diagnostic: diagnostic(ShellCodes, 'E_IO_WRITE', `cannot write ${configPath}: not a path inside the project`, {
        path: configPath,
      }),
    };
  }
  return atomicWrite(join(dir, configPath), text, { durable: true });
}
