// The emission stream (architecture §3.4, §6.3, §9.4, D17, D62): every file of the generated tree, in the
// order core/emit/tree.ts freezes. For each module in ROM order whose files romlift writes (`generated` true and no
// hand-written `source`, D109), the entries of
// every module-scoped writer of the registry (writers/index.ts) for that module, sorted by path (code
// units); then the global writers' entries, sorted by path. The stream is lazy, module by module, so no
// whole tree is ever held, and re-callable: each iteration runs the writers afresh and yields the same
// entries, so the check pass and the write pass each run it once (§6.4).
import type { Rom } from '../../foundation/rom/rom.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { writesModuleFiles } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import type { EmitContext, FileEntry, Writer } from './tree.ts';
import { WRITERS } from './writers/index.ts';

function byPath(a: FileEntry, b: FileEntry): number {
  return compareCodeUnits(a.path, b.path);
}

function collect(writers: readonly Writer[], rom: Rom, model: Model, cx: EmitContext, module: number | null): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const writer of writers) for (const entry of writer.emit(rom, model, cx, module)) entries.push(entry);
  return entries.sort(byPath);
}

function* stream(rom: Rom, model: Model, cx: EmitContext, writers: readonly Writer[]): Generator<FileEntry> {
  const moduleWriters = writers.filter((w) => w.scope === 'module');
  const globalWriters = writers.filter((w) => w.scope === 'global');
  for (const [i, m] of model.modules.entries()) {
    if (!writesModuleFiles(m)) continue;
    yield* collect(moduleWriters, rom, model, cx, i);
  }
  yield* collect(globalWriters, rom, model, cx, null);
}

/** The stream over an explicit writer list (the registry by default); for tests of the order. */
export function emitWith(rom: Rom, model: Model, cx: EmitContext, writers: readonly Writer[]): Iterable<FileEntry> {
  return { [Symbol.iterator]: () => stream(rom, model, cx, writers) };
}

/** Every FileEntry of the generated tree, lazily, in the frozen stream order. */
export function emitTree(rom: Rom, model: Model, cx: EmitContext): Iterable<FileEntry> {
  return emitWith(rom, model, cx, WRITERS);
}
