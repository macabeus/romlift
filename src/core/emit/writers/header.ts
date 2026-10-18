// The `header` writer (architecture §6.3): asm/rom_header.s, the cartridge header of the module holding the
// header chunk: the dialect preamble, then the header's bytes as `.byte` lines, 16 to a line, under a global
// label, as the proof of concept writes it. Scope: module.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { HEADER_PATH } from '../../model/paths.ts';
import type { Model } from '../../model/types.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';
import { moduleWithSource, unitText } from '../unit-text.ts';

function* headerFile(rom: Rom, model: Model, cx: EmitContext, module: number | null): Iterable<FileEntry> {
  const m = moduleWithSource(model, module, () => HEADER_PATH);
  if (m === undefined) return;
  yield { ownership: 'generated', path: HEADER_PATH, text: unitText(rom, model, cx, m, { preface: [], spaced: false }), writer: 'header' };
}

export const headerWriter: Writer = {
  id: 'header',
  scope: 'module',
  emit: headerFile,
};
