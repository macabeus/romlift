// The `crt0` writer (architecture §6.3): asm/crt0.s, the startup region in one file: the dialect preamble, a
// comment naming the region, then every chunk of the module holding the startup chunk in ROM order (a
// function or orphan chunk with a file of its own is included). Scope: module.
import type { Rom } from '../../../foundation/rom/rom.ts';
import { hex } from '../../../foundation/util/hex.ts';
import { CRT0_PATH } from '../../model/paths.ts';
import type { Model } from '../../model/types.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';
import { moduleWithSource, unitText } from '../unit-text.ts';

function* crt0File(rom: Rom, model: Model, cx: EmitContext, module: number | null): Iterable<FileEntry> {
  const m = moduleWithSource(model, module, () => CRT0_PATH);
  if (m === undefined) return;
  const preface = [`@ startup region ${hex(m.span.start)}..${hex(m.span.end)}`];
  yield { ownership: 'generated', path: CRT0_PATH, text: unitText(rom, model, cx, m, { preface, spaced: true }), writer: 'crt0' };
}

export const crt0Writer: Writer = {
  id: 'crt0',
  scope: 'module',
  emit: crt0File,
};
