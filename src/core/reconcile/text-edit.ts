// Text edits of a reconciled C file (architecture §3.4, §6.3 `reconciled` ownership, §6.6): what the INCLUDE_ASM
// planner and the identifier renames of `rename` (rename-tokens.ts, phase 6, D92) return, and how they apply. An edit
// replaces [start, end) of the base text, in UTF-16 offsets, so `generate` touches a C file only where a planner says
// (R9). The shape is architecture §3.4's TextEdit, declared here once (core/reconcile imports only foundation) and
// re-exported by core/emit/tree.ts for the FileEntry that carries it.
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';

/** One edit of a reconciled file, in UTF-16 offsets of its base text. */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /**
   * Why: a stub added or removed, or the `#include "include_asm.h"` a file gains with its first stub ('add-header', fix
   * round 7, architecture-b2-10); or an identifier token `rename` replaced ('rename-identifier', rename-tokens.ts,
   * phase 6, D92).
   */
  readonly reason: 'add-stub' | 'remove-stub' | 'add-header' | 'rename-identifier';
}

/**
 * `text` with `edits` applied. Offsets are UTF-16 offsets of `text`; edits must lie inside it and must not
 * overlap (two insertions at one offset apply in their given order). A violation is a bug in the planner of the
 * edits, never a property of the input, so it throws RomliftInvariantError.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const order = edits.map((edit, index) => ({ edit, index }));
  order.sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index);
  const parts: string[] = [];
  let at = 0;
  for (const { edit } of order) {
    if (!(Number.isInteger(edit.start) && Number.isInteger(edit.end) && edit.start >= 0 && edit.start <= edit.end && edit.end <= text.length)) {
      throw new RomliftInvariantError(`text edit [${edit.start}, ${edit.end}) lies outside a ${text.length}-unit text`);
    }
    if (edit.start < at) throw new RomliftInvariantError(`text edit [${edit.start}, ${edit.end}) overlaps the previous edit, which ends at ${at}`);
    parts.push(text.slice(at, edit.start), edit.text);
    at = edit.end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}
