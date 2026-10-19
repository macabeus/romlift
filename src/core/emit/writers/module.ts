// The `module` writer (architecture §6.3): asm/<module>.s of an asm module other than the header's and the
// startup region's: the dialect preamble, then its chunks in ROM order, each an `.include` of its file
// (function and orphan chunks) or inlined (a chunk without a file of its own). Scope: module. The header
// and crt0 writers build their files with the same unitText.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { CRT0_PATH, HEADER_PATH, moduleSource } from '../../model/paths.ts';
import type { Model, Module } from '../../model/types.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';
import { unitText } from '../unit-text.ts';

/** Whether the module holds the header or the startup chunk (moduleSource is then asm/rom_header.s or asm/crt0.s). */
function isHeaderOrStartup(model: Model, m: Module): boolean {
  const source = moduleSource(model, m);
  const own = model.chunks.slice(m.chunks.first, m.chunks.first + m.chunks.count);
  return (source === HEADER_PATH || source === CRT0_PATH) && own.some((c) => c.kind === 'header' || c.kind === 'startup');
}

function* moduleFile(rom: Rom, model: Model, cx: EmitContext, module: number | null): Iterable<FileEntry> {
  const m = module === null ? undefined : model.modules[module];
  // The header's and the startup region's modules build from the header and crt0 writers' files.
  if (m === undefined || m.kind !== 'asm' || isHeaderOrStartup(model, m)) return;
  const preface = m.library === undefined ? [] : [`@ ${m.library.name} ${m.library.version}`];
  yield { ownership: 'generated', path: moduleSource(model, m), text: unitText(rom, model, cx, m, { preface, spaced: false }), writer: 'module' };
}

export const moduleWriter: Writer = {
  id: 'module',
  scope: 'module',
  emit: moduleFile,
};
