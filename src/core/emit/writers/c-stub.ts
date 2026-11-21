// The `c-stub` writer (architecture §6.1 rung 2, §6.3, §6.6, D74 e): src/<module>.c of a C module. Scope: module;
// ownership 'scaffold', so `init` writes it and a later run never overwrites what the user decompiled (`generate`'s
// reconciliation edits it instead, D75 b). The text is the reconciler's stub planner run on the template header: C_STUB_HEADER
// (`#include "include_asm.h"` and a blank line), then planIncludeAsm's insertions into it, which on a file holding no
// stub are one `INCLUDE_ASM("asm/nonmatchings/<module>", <name>);` line per function and orphan chunk file of the
// module, in ROM order (core/model/c-unit.ts stubChunks; <name> is the chunk file's base name, the
// case-folded `<Name>_<ADDR>` included). What agbcc makes of it is core/model/c-unit.ts's stubUnitAssembly.
import { C_STUB_HEADER } from '../../../foundation/asm/dialect.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { isCSource } from '../../../foundation/util/project-files.ts';
import { stubChunks } from '../../model/c-unit.ts';
import { moduleSource } from '../../model/paths.ts';
import type { Model, Module } from '../../model/types.ts';
import { planIncludeAsm } from '../../reconcile/include-asm.ts';
import { applyTextEdits } from '../../reconcile/text-edit.ts';
import type { EmitContext, FileEntry, Writer } from '../tree.ts';

/** The generated text of src/<module>.c: the header, then one INCLUDE_ASM per chunk file in ROM order. */
export function cStubText(model: Pick<Model, 'chunks'>, module: Module): string {
  const plan = planIncludeAsm(C_STUB_HEADER, {
    module: module.name,
    chunks: stubChunks(model, module),
    path: moduleSource(model, module),
  });
  return applyTextEdits(C_STUB_HEADER, plan.edits);
}

function* cStubFile(_rom: Rom, model: Model, _cx: EmitContext, module: number | null): Iterable<FileEntry> {
  const m = module === null ? undefined : model.modules[module];
  if (m === undefined) return;
  const path = moduleSource(model, m);
  if (isCSource(path)) yield { ownership: 'scaffold', path, text: cStubText(model, m), writer: 'c-stub' };
}

export const cStubWriter: Writer = {
  id: 'c-stub',
  scope: 'module',
  emit: cStubFile,
};
