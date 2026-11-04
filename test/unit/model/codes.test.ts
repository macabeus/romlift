// The model's codes (architecture §9.1, D45, D62 e): every code ModelCodes defines is raised by buildModel in
// some situation, with the severity its table fixes, and buildModel raises no other code.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelCodes } from '../../../src/core/model/codes.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith, thumbAt } from '../layout/hand-made.ts';

function raised(): Diagnostic[] {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    b _08000108
    pop {r0}
    bx r0
    push {lr}
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x108 }), fact({ entry: BASE + 0x108, end: BASE + 0x10e })] });
  const out: Diagnostic[] = [];
  // A border moved across the short branch: E_MODULE_BORDER and W_CROSS_MODULE_SHORT_BRANCH.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['moved', BASE + 0x108]], functions: [[BASE + 0x100, 'A'], [BASE + 0x108, 'B']] })).diagnostics);
  // Starts that do not increase.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', BASE + 0x100], ['back', HEADER_END]] })).diagnostics);
  // One name twice in a module.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'Same'], [BASE + 0x108, 'Same']] })).diagnostics);
  // A runs_at range off the module borders.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], overrides: [{ start: BASE + 0x100, size: 8, kind: 'code', runsAt: 0x0300_0000 }] })).diagnostics);
  // A function named like a mapping symbol and an alias named like a section.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, '$d'], [BASE + 0x108, { name: 'B', aliases: ['.text'] }]] })).diagnostics);
  // Two modules of one name: E_MODULE_NAME_DUPLICATE.
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['main', BASE + 0x108]], functions: [[BASE + 0x100, 'A'], [BASE + 0x108, 'B']] })).diagnostics);
  // B listed `arm` while A calls it with a Thumb bl: W_INTERWORKING_BRANCH.
  const bl = thumbAt(BASE + 0x100)`
    push {lr}
    bl _08000108
    pop {r0}
    bx r0
  `;
  const blRom = romWith([{ at: BASE + 0x100, bytes: bl }], { size: 0x200 });
  const blAnalysis = analysisOf(blRom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x108 }), fact({ entry: BASE + 0x108, end: BASE + 0x108, mode: 'arm', code: [] })] });
  out.push(...buildModel(blRom, blAnalysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'A'], [BASE + 0x108, { name: 'B', mode: 'arm' }]] })).diagnostics);
  // A function outside the ROM, an override reaching past its end, and a symbol inside A's first instruction.
  out.push(
    ...buildModel(
      rom,
      analysis,
      configOf({
        modules: [['rom_header', BASE], ['main', HEADER_END]],
        functions: [[BASE + 0x100, 'A'], [0x0900_0000, 'Outside']],
        symbols: [[BASE + 0x101, { name: 'gOdd', aliases: [] }]],
        overrides: [{ start: BASE + 0x1f0, size: 0x20, kind: 'data' }],
      }),
    ).diagnostics,
  );
  // A data_start on an asm module (phase 6, D92).
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'asm', generated: true, dataStart: BASE + 0x180 }] })).diagnostics);
  // A hand-written source on a C module (D109).
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'c', generated: true, source: 'src/asm/main.s' }] })).diagnostics);
  // A Thumb pointer value pasted as a [functions] key (fix round 5).
  out.push(...buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'A'], [BASE + 0x103, 'Odd']] })).diagnostics);
  return out;
}

test('every model code is raised, with its severity, and no other code', () => {
  const diagnostics = raised();
  const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const codes = [...new Set(diagnostics.map((d) => d.code))].sort(byCode);
  assert.deepEqual(codes, Object.keys(ModelCodes).sort(byCode));
  for (const d of diagnostics) assert.equal(d.severity, ModelCodes[d.code as keyof typeof ModelCodes].severity, d.code);
});
