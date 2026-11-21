// The c-stub writer (architecture §6.3, §6.6, D74 e): src/<module>.c of each C module, scaffold-owned, the template
// header then one INCLUDE_ASM per function and orphan chunk file in ROM order (case-folded names with their address);
// nothing for asm and data modules or for a C module's header; the reconciler's planner on the header gives the text.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cStubText, cStubWriter } from '../../../../src/core/emit/writers/c-stub.ts';
import { stubChunks, stubUnitAssembly } from '../../../../src/core/model/c-unit.ts';
import { planIncludeAsm } from '../../../../src/core/reconcile/include-asm.ts';
import { applyTextEdits } from '../../../../src/core/reconcile/text-edit.ts';
import { stubAssemblyOf } from '../../../../src/core/verify/c-stub.ts';
import { C_STUB_HEADER } from '../../../../src/foundation/asm/dialect.ts';
import { dataItem, modelOf, romWith } from '../../../helpers/model.ts';

const CX = { decomp: { defined: [] } };
const rom = romWith([], { size: 0x400 });
const model = modelOf(rom, {
  modules: [
    { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
    { name: 'crt0', chunks: [{ kind: 'startup', name: 'start', mode: 'arm', items: [dataItem(0x0800_00c0, 0x40)] }] },
    {
      name: 'main',
      kind: 'c',
      chunks: [
        { name: 'AgbMain', items: [dataItem(0x0800_0100, 0x20)] },
        { kind: 'orphan', name: 'unk_08000120', items: [dataItem(0x0800_0120, 0x10)] },
        { name: 'VBlankCB', items: [dataItem(0x0800_0130, 0x10)] },
        { name: 'VblankCB', items: [dataItem(0x0800_0140, 0x40)] },
      ],
    },
    { name: 'asm_08000180', chunks: [{ name: 'ArmThing', mode: 'arm', items: [dataItem(0x0800_0180, 0x80)] }] },
    { name: 'data', kind: 'data', chunks: [{ kind: 'data', name: 'data', items: [dataItem(0x0800_0200, 0x200)] }] },
  ],
});

test('a C module gets src/<module>.c: the header, then its chunk files in ROM order', () => {
  const entries = model.modules.flatMap((_, i) => [...cStubWriter.emit(rom, model, CX, i)]);
  assert.deepEqual(entries, [
    {
      ownership: 'scaffold',
      path: 'src/main.c',
      writer: 'c-stub',
      text: [
        '#include "include_asm.h"',
        '',
        'INCLUDE_ASM("asm/nonmatchings/main", AgbMain);',
        'INCLUDE_ASM("asm/nonmatchings/main", unk_08000120);',
        'INCLUDE_ASM("asm/nonmatchings/main", VBlankCB_08000130);',
        'INCLUDE_ASM("asm/nonmatchings/main", VblankCB_08000140);',
        '',
      ].join('\n'),
    },
  ]);
  assert.deepEqual([...cStubWriter.emit(rom, model, CX, null)], [], 'module scope');
  assert.equal(cStubWriter.id, 'c-stub');
  assert.equal(cStubWriter.scope, 'module');
});

test("the text is the planner run on the template header, a stub-only unit whose assembly is the module's", () => {
  const main = model.modules[2]!;
  const text = cStubText(model, main);
  const chunks = [
    { name: 'AgbMain', stub: 'AgbMain' },
    { name: 'unk_08000120', stub: 'unk_08000120' },
    { name: 'VBlankCB', stub: 'VBlankCB_08000130' },
    { name: 'VblankCB', stub: 'VblankCB_08000140' },
  ];
  assert.deepEqual(stubChunks(model, main), chunks, 'a case-folded pair: the symbol and the stub name differ');
  assert.equal(text, applyTextEdits(C_STUB_HEADER, planIncludeAsm(C_STUB_HEADER, { module: 'main', chunks }).edits));
  assert.ok(text.startsWith(C_STUB_HEADER));
  assert.deepEqual(
    planIncludeAsm(text, { module: 'main', chunks }),
    { edits: [], diagnostics: [], unplaced: [], undeclared: [], included: [] },
    'the planner has nothing to add',
  );
  const assembly = stubAssemblyOf(text, main.compiler);
  assert.ok(assembly.ok);
  assert.equal(assembly.text, stubUnitAssembly(model, main));
});

test('the stream holds the stub, and no asm/<module>.s, for a C module', () => {
  const c = model.modules[2]!;
  const asm = { ...model, modules: model.modules.map((m) => (m === c ? { ...m, kind: 'asm' as const } : m)) };
  assert.deepEqual([...cStubWriter.emit(rom, asm, CX, 2)], []);
});
