// The text-layout check of one entry, for the tests that check a single file (architecture-r1-8): checkEntries over a
// stream of that entry alone, keeping only what the entry itself contributes. A one-entry stream also raises the
// stream-level diagnostics, which these tests do not expect: every other file the model needs is missing ("the stream
// emits no such file"), and the unit alignment of the entry's module is judged from that one file. They are dropped
// by their messages (core/verify/text-layout.ts checkEntries and unitAlignment); the paths check is not read.
import type { FileEntry } from '../../src/core/emit/tree.ts';
import type { Model } from '../../src/core/model/types.ts';
import { checkEntries } from '../../src/core/verify/text-layout.ts';
import type { Diagnostic } from '../../src/foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../src/foundation/rom/rom.ts';

/** The messages of checkEntries' stream-level diagnostics: a file the stream lacks, and a unit's section alignment. */
const STREAM_LEVEL = [
  /: the stream emits no such file, which the model needs \(at /,
  /: the object's section is aligned to \d+ bytes, so ld places it past /,
  /: GNU as pads the object's section to a multiple of \d+ bytes, /,
];

/** Whether `d` is one of checkEntries' stream-level diagnostics rather than a problem of the entry checked. */
function streamLevel(d: Diagnostic): boolean {
  return STREAM_LEVEL.some((pattern) => pattern.test(d.message));
}

/** The text-layout diagnostics `entry` contributes on its own against `model`: [] when it is not this check's or it passes. */
export function entryDiagnostics(rom: Rom, model: Model, entry: FileEntry): readonly Diagnostic[] {
  const textLayout = checkEntries(rom, model, [entry]).checks.find((c) => c.id === 'text-layout');
  if (textLayout === undefined) throw new Error('checkEntries returned no text-layout check');
  return textLayout.diagnostics.filter((d) => !streamLevel(d));
}
