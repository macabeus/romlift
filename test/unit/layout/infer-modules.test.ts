// Module inference (architecture §6.2, §6.7, D20, D62 d): rom_header, crt0, the runs_at ranges as their own modules,
// the library regions shrunk to legal borders inside them and cut around runs_at ranges (placeLibraries),
// assembly-only modules `asm_<ADDR>` for ARM code, 2-mod-4 entries, shared tails and tiled holes (widened to
// legal borders, adjacent ones merged), the agbcc-shaped rest cut into main, main_2, ... at the first legal
// border at least moduleSize past each start, data from the code end. Every start is a legal border.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { legalBorders } from '../../../src/core/layout/borders.ts';
import { codeLayout } from '../../../src/core/layout/borders.ts';
import { asmOnlyName, inferModules, mainName, placeLibraries, runsAtName } from '../../../src/core/layout/infer-modules.ts';
import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import type { InferModulesOptions } from '../../../src/core/layout/types.ts';
import { analysisOf, BASE, fact, HEADER_END, romWith, thumbAt } from './hand-made.ts';

/** [name, start offset from BASE, kind, layout reason] per proposal, after checking every start is a legal border. */
function modules(rom: Rom, analysis: AnalysisResult, options: InferModulesOptions = {}): [string, number, string, string][] {
  const proposals = inferModules(rom, analysis, options);
  const borders = legalBorders(rom, analysis);
  // A runs_at range's borders are the user's (§6.7): they are module starts whether legal or not.
  const ranges = (options.runsAt ?? []).flatMap((r) => [r.span.start, r.span.end]);
  const out: [string, number, string, string][] = [];
  for (const p of proposals) {
    assert.equal(p.kind, 'module');
    if (p.kind !== 'module') continue;
    assert.ok(borders.includes(p.start) || ranges.includes(p.start), `${p.name} starts at 0x${p.start.toString(16)}, not a legal border`);
    assert.equal(p.source.kind, 'layout');
    out.push([p.name, p.start - BASE, p.moduleKind, p.source.kind === 'layout' ? p.source.reason : '']);
  }
  const starts = out.map(([, s]) => s);
  assert.deepEqual([...starts].sort((a, b) => a - b), starts, 'in ROM order');
  assert.equal(starts[0], 0, 'the first module starts at the ROM base');
  return out;
}

/** A startup function [0xC0, 0xE0) and Thumb functions of 0x10 bytes from 0x100. */
function layout(count: number, extra: Parameters<typeof fact>[0][] = [], size = 0x400) {
  const rom = romWith([], { size });
  const functions = [fact({ entry: HEADER_END, end: BASE + 0xe0, mode: 'arm' }), ...Array.from({ length: count }, (_, i) => fact({ entry: BASE + 0x100 + 0x10 * i, end: BASE + 0x110 + 0x10 * i })), ...extra.map(fact)];
  return { rom, analysis: analysisOf(rom, { functions, startupEnd: BASE + 0xe0 }) };
}

test('the header, crt0, one main module (from the end of crt0) and data', () => {
  const { rom, analysis } = layout(4);
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['data', 0x140, 'data', 'data'],
  ]);
});

test('no crt0 without a startup region, and no data module when the code runs to the ROM end', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x200 })] });
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['main', 0xc0, 'c', 'module-size'],
  ]);
});

test('module size: each C module closes at the first legal border at least moduleSize past its start', () => {
  const { rom, analysis } = layout(8);
  assert.deepEqual(modules(rom, analysis, { moduleSize: 0x30 }), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['main_2', 0x110, 'c', 'module-size'],
    ['main_3', 0x140, 'c', 'module-size'],
    ['main_4', 0x170, 'c', 'module-size'],
    ['data', 0x180, 'data', 'data'],
  ]);
  assert.equal(modules(rom, analysis).filter(([n]) => n.startsWith('main')).length, 1, 'the default 0x10000 makes one');
});

test('an ARM run is one assembly-only module between C modules, named asm_<ADDR>', () => {
  const { rom, analysis } = layout(2, [
    { entry: BASE + 0x120, end: BASE + 0x128, mode: 'arm' },
    { entry: BASE + 0x128, end: BASE + 0x130, mode: 'arm' },
    { entry: BASE + 0x130, end: BASE + 0x140 },
  ]);
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['asm_08000120', 0x120, 'asm', 'asm-only'],
    ['main_2', 0x130, 'c', 'module-size'],
    ['data', 0x140, 'data', 'data'],
  ]);
  assert.equal(asmOnlyName(BASE + 0x120), 'asm_08000120');
  assert.deepEqual([1, 2, 3].map(mainName), ['main', 'main_2', 'main_3']);
});

test('a Thumb entry at 2 mod 4 and a tiled hole are assembly-only; adjacent ranges merge', () => {
  const { rom, analysis } = layout(2, [
    { entry: BASE + 0x122, end: BASE + 0x128 },
    { entry: BASE + 0x128, end: BASE + 0x138, holes: [{ start: BASE + 0x12c, end: BASE + 0x130 }] },
    { entry: BASE + 0x138, end: BASE + 0x140 },
  ]);
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['asm_08000120', 0x120, 'asm', 'asm-only'],
    ['main_2', 0x138, 'c', 'module-size'],
    ['data', 0x140, 'data', 'data'],
  ]);
});

test('a shared tail is assembly-only, widened to the legal border below the branch it takes', () => {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    movs r0, #1
    movs r1, #2
    pop {r1}
    bx r1
    mov r8, r8
    push {lr}
    movs r0, #3
    b _08000106
    mov r8, r8
    push {lr}
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: HEADER_END, end: BASE + 0xe0, mode: 'arm' }),
      fact({ entry: BASE + 0x100, end: BASE + 0x10a }),
      fact({ entry: BASE + 0x10c, end: BASE + 0x112, exits: [{ at: BASE + 0x110, rule: 'walk.branch-into-function', kind: 'tail' }] }),
      fact({ entry: BASE + 0x114, end: BASE + 0x11a }),
    ],
    startupEnd: BASE + 0xe0,
  });
  assert.ok(!legalBorders(rom, analysis).includes(BASE + 0x10c), 'the tail branch crosses 0x10C');
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['asm_08000100', 0x100, 'asm', 'asm-only'],
    ['main', 0x114, 'c', 'module-size'],
    ['data', 0x11c, 'data', 'data'],
  ]);
});

test('orphan bytes alone make no module: after the header they join the assembly-only module that follows', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' }), fact({ entry: BASE + 0x108, end: BASE + 0x110 })] });
  assert.deepEqual(modules(rom, analysis), [
    ['rom_header', 0, 'asm', 'header'],
    ['asm_080000C0', 0xc0, 'asm', 'asm-only'],
    ['main', 0x108, 'c', 'module-size'],
    ['data', 0x110, 'data', 'data'],
  ]);
});

test('a library region becomes its own module, shrunk to the legal borders inside it, named by the library', () => {
  const { rom, analysis } = layout(6);
  const m4aRegion = { span: { start: BASE + 0x114, end: BASE + 0x12c }, library: 'm4a', version: '2001' };
  const proposals = inferModules(rom, analysis, { libraries: [m4aRegion] });
  // The region starts inside the function at 0x110, which is not the library's: the module starts at 0x120, the
  // first legal border inside it, and ends at 0x130, the first one past its end (only the function's tail between).
  assert.deepEqual(modules(rom, analysis, { libraries: [m4aRegion] }), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['m4a', 0x120, 'asm', 'asm-only'],
    ['main_2', 0x130, 'c', 'module-size'],
    ['data', 0x160, 'data', 'data'],
  ]);
  const m4a = proposals.find((p) => p.kind === 'module' && p.name === 'm4a');
  assert.deepEqual(m4a?.kind === 'module' ? m4a.library : undefined, { name: 'm4a', version: '2001' });
});

test('a region ends at the first legal border past its end, unless a function starts before that border', () => {
  const { rom, analysis } = layout(6);
  const cl = codeLayout(rom, analysis);
  // [0x110, 0x134): its last placement holds the start of the function at 0x130, so the module takes all of it.
  const tail = placeLibraries(cl, [{ span: { start: BASE + 0x110, end: BASE + 0x134 }, library: 'libgcc', version: 'agbcc' }], BASE + 0xe0, BASE + 0x160);
  assert.deepEqual(tail.map((p) => p.spans), [[{ start: BASE + 0x110, end: BASE + 0x140 }]]);
  // The same region where 0x140 is no legal border (a short branch from 0x13E to 0x146 crosses it) and a function
  // starts at 0x140 before the next one at 0x150: the module ends at 0x130, the last legal border at or below its end.
  const crossed = { ...cl, borders: cl.borders.filter((b) => b !== BASE + 0x140) };
  const shrunk = placeLibraries(crossed, [{ span: { start: BASE + 0x110, end: BASE + 0x134 }, library: 'libgcc', version: 'agbcc' }], BASE + 0xe0, BASE + 0x160);
  assert.deepEqual(shrunk.map((p) => p.spans), [[{ start: BASE + 0x110, end: BASE + 0x130 }]]);
});

test('placeLibraries: a region with no legal border inside it and a region past the code end take no module', () => {
  const { rom, analysis } = layout(6);
  const cl = codeLayout(rom, analysis);
  const inside = { span: { start: BASE + 0x112, end: BASE + 0x11e }, library: 'libagbsyscall', version: 'agb' };
  const table = { span: { start: BASE + 0x180, end: BASE + 0x190 }, library: 'm4a', version: '2001' };
  const placed = placeLibraries(cl, [table, inside], BASE + 0xe0, cl.dataStart);
  assert.deepEqual(
    placed.map((p) => [p.region.library, p.spans, p.dropped]),
    [
      ['libagbsyscall', [], 'no-legal-border'],
      ['m4a', [], 'outside-code'],
    ],
  );
  assert.deepEqual(modules(rom, analysis, { libraries: [inside, table] }), modules(rom, analysis));
});

test('a runs_at range is its own module ram_<RUNADDR>, and a library region around it is cut in two', () => {
  const { rom, analysis } = layout(6);
  const options: InferModulesOptions = {
    libraries: [{ span: { start: BASE + 0x110, end: BASE + 0x150 }, library: 'm4a', version: '2001' }],
    runsAt: [{ span: { start: BASE + 0x120, end: BASE + 0x130 }, runAt: 0x0300_0388 }],
  };
  assert.equal(runsAtName(0x0300_0388), 'ram_03000388');
  assert.deepEqual(modules(rom, analysis, options), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['m4a', 0x110, 'asm', 'asm-only'],
    ['ram_03000388', 0x120, 'asm', 'runs-at'],
    ['m4a_2', 0x130, 'asm', 'asm-only'],
    ['main_2', 0x150, 'c', 'module-size'],
    ['data', 0x160, 'data', 'data'],
  ]);
  const libraries = inferModules(rom, analysis, options).flatMap((p) => (p.kind === 'module' && p.library !== undefined ? [p.library] : []));
  assert.deepEqual(libraries, [
    { name: 'm4a', version: '2001' },
    { name: 'm4a', version: '2001' },
  ]);
});

test('a runs_at range alone in agbcc-shaped code: the code after it starts a module of its own', () => {
  const { rom, analysis } = layout(6);
  assert.deepEqual(modules(rom, analysis, { runsAt: [{ span: { start: BASE + 0x120, end: BASE + 0x130 }, runAt: 0x0300_0000 }] }), [
    ['rom_header', 0, 'asm', 'header'],
    ['crt0', 0xc0, 'asm', 'startup'],
    ['main', 0xe0, 'c', 'module-size'],
    ['ram_03000000', 0x120, 'asm', 'runs-at'],
    ['main_2', 0x130, 'c', 'module-size'],
    ['data', 0x160, 'data', 'data'],
  ]);
});
