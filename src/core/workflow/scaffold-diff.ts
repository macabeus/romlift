// A project's scaffold, rendered and compared (architecture §6.3 "The scaffold", D74 d; `scaffold --diff`): the
// entries renderScaffold makes for a project's ScaffoldVars, which `init` writes when absent, and how each file on disk
// differs from them now (foundation/util/line-diff.ts). Pure: the shell reads the files.
import { unifiedDiff } from '../../foundation/util/line-diff.ts';
import type { FileEntry } from '../emit/tree.ts';
import { renderScaffold } from '../scaffold/render.ts';
import { scaffoldVars } from '../scaffold/vars.ts';
import type { AgbccPin, ScaffoldTemplates } from '../scaffold/vars.ts';

/** What a project's scaffold is rendered from: its build name, its ROM's SHA-1 and title, and the package's inputs. */
export interface ProjectScaffoldInputs {
  readonly name: string;
  readonly sha1: string;
  readonly title: string;
  readonly romliftVersion: string;
  readonly agbcc: AgbccPin;
  readonly templates: ScaffoldTemplates;
}

/** The scaffold entries of a project (renderScaffold over its ScaffoldVars), sorted by path; `init` writes them when absent. */
export function projectScaffold(inputs: ProjectScaffoldInputs): readonly FileEntry[] {
  const vars = scaffoldVars({ name: inputs.name, sha1: inputs.sha1, romliftVersion: inputs.romliftVersion, agbcc: inputs.agbcc, title: inputs.title });
  return renderScaffold(vars, inputs.templates);
}

/** How one scaffold file on disk compares with what the current templates render (`scaffold --diff`). */
export interface ScaffoldDrift {
  readonly path: string;
  readonly status: 'same' | 'differs' | 'absent';
  /** The unified diff from the file on disk to the rendered template; empty unless `differs`. */
  readonly diff: string;
}

/** The drift of every scaffold entry against `current` (each path's text on disk; a path it lacks is absent), in entry order. */
export function scaffoldDrift(entries: readonly FileEntry[], current: ReadonlyMap<string, string>): readonly ScaffoldDrift[] {
  return entries.flatMap((entry): ScaffoldDrift[] => {
    if (!('text' in entry)) return [];
    const text = current.get(entry.path);
    if (text === undefined) return [{ path: entry.path, status: 'absent', diff: '' }];
    if (text === entry.text) return [{ path: entry.path, status: 'same', diff: '' }];
    return [{ path: entry.path, status: 'differs', diff: unifiedDiff(text, entry.text, entry.path) }];
  });
}
