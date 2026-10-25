// core/layout's module planning (architecture §6.7, §7.3, D95 b; architecture-1, architecture-2): one naming rule
// (freeModuleName, resumedModule) for the runs_at borders and the library modules, and the reasons a range or a region
// takes no module, which the workflow turns into diagnostics.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freeModuleName } from '../../../src/core/layout/infer-modules.ts';
import { moduleHolding, planRunsAtBorders, regionsWithoutModule, resumedModule } from '../../../src/core/layout/module-proposals.ts';
import type { ModuleAt } from '../../../src/core/layout/module-proposals.ts';

const ROM = { base: 0x0800_0000, end: 0x0800_4000 } as const;
const MODULES: readonly ModuleAt[] = [
  { name: 'rom_header', start: 0x0800_0000, kind: 'asm' },
  { name: 'm4a', start: 0x0800_1000, kind: 'asm', library: 'm4a', version: '2001' },
  { name: 'main', start: 0x0800_3000, kind: 'c' },
];

test('freeModuleName takes the first free name and holds it; moduleHolding is the last module at or below', () => {
  const taken = new Set(['m4a', 'm4a_2']);
  assert.equal(freeModuleName('m4a', taken), 'm4a_3');
  assert.equal(freeModuleName('m4a', taken), 'm4a_4');
  assert.equal(freeModuleName('libgcc', taken), 'libgcc');
  assert.equal(moduleHolding(MODULES, 0x0800_2fff)?.name, 'm4a');
  assert.equal(moduleHolding(MODULES, 0x0800_3000)?.name, 'main');
});

test('resumedModule keeps the holder kind, library and version under <holder>_<ADDR>', () => {
  const holder = MODULES[1];
  assert.ok(holder !== undefined);
  assert.deepEqual(resumedModule(holder, 0x0800_16bc, new Set(), 'runs-at'), {
    kind: 'module',
    name: 'm4a_080016BC',
    start: 0x0800_16bc,
    moduleKind: 'asm',
    library: { name: 'm4a', version: '2001' },
    source: { kind: 'layout', reason: 'runs-at' },
  });
});

test('planRunsAtBorders: the borders a range lacks, and the reasons it refuses one', () => {
  const plan = planRunsAtBorders(ROM, MODULES, [
    { start: 0x0800_1318, size: 0x3a4, runsAt: 0x0300_0388 },
    { start: 0x0800_2f00, size: 0x200, runsAt: 0x0300_1000 },
    { start: 0x0800_3f00, size: 0x200, runsAt: 0x0300_2000 },
  ]);
  assert.deepEqual(plan.proposals.map((p) => [p.name, p.start, p.moduleKind, p.library?.name]), [
    ['ram_03000388', 0x0800_1318, 'asm', undefined],
    ['m4a_080016BC', 0x0800_16bc, 'asm', 'm4a'],
  ]);
  assert.deepEqual(plan.refused.map((r) => [r.span.start, r.why.kind]), [
    [0x0800_2f00, 'c-module-inside'],
    [0x0800_3f00, 'outside-rom'],
  ]);
});

test('regionsWithoutModule: a code region no module of its library meets, not a table past the data start', () => {
  const modules: readonly ModuleAt[] = [...MODULES, { name: 'data', start: 0x0800_3800, kind: 'data' }];
  const regions = [
    { span: { start: 0x0800_1100, end: 0x0800_1200 }, library: 'm4a', version: '2001' },
    { span: { start: 0x0800_3100, end: 0x0800_3200 }, library: 'libgcc', version: 'agbcc' },
    { span: { start: 0x0800_3900, end: 0x0800_3910 }, library: 'm4a', version: '2001' },
  ];
  assert.deepEqual(regionsWithoutModule(modules, regions).map((r) => r.library), ['libgcc']);
});
