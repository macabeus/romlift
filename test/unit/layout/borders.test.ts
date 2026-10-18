// Legal borders (architecture §6.2, D15, D20): the code region tiled like the PoC's tile(), word-aligned chunk
// starts, none that a short Thumb branch crosses, none strictly inside an assembly-only range; the cartridge
// entry's extent over the header clipped when nesting entries (correctness-6).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  asmOnlyRanges,
  asmOnlyReasons,
  codeLayout,
  factsByEntry,
  legalBorders,
  listedEntriesOf,
  nearestBorders,
  nestedEntries,
  placeEntries,
  shortBranches,
  tileCode,
} from '../../../src/core/layout/borders.ts';
import type { PlacedEntry } from '../../../src/core/layout/borders.ts';
import { analysisOf, armAt, BASE, fact, HEADER_END, romWith, thumbAt } from './hand-made.ts';

function placed(entry: number, end: number | undefined): PlacedEntry {
  return { entry, label: false, end, source: end === undefined ? 'next-listed' : 'analysis' };
}

test('tileCode: one chunk per entry up to the next entry or its extent end, orphans between, cut at the cuts', () => {
  const chunks = tileCode([placed(0x100, 0x110), placed(0x120, undefined), placed(0x130, 0x131)], 0xc0, 0x140, [0xd0]);
  assert.deepEqual(
    chunks.map((c) => [c.span.start, c.span.end, c.entry]),
    [
      [0xc0, 0xd0, undefined],
      [0xd0, 0x100, undefined],
      [0x100, 0x110, 0x100],
      [0x110, 0x120, undefined],
      [0x120, 0x130, 0x120],
      [0x130, 0x132, 0x130],
      [0x132, 0x140, undefined],
    ],
  );
});

test('tileCode: a chunk ends at the next entry when its extent runs past it, and never past the end', () => {
  const chunks = tileCode([placed(0x100, 0x180), placed(0x110, 0x200)], 0x100, 0x150, []);
  assert.deepEqual(
    chunks.map((c) => [c.span.start, c.span.end, c.entry]),
    [
      [0x100, 0x110, 0x100],
      [0x110, 0x150, 0x110],
    ],
  );
  assert.deepEqual(tileCode([], 0x100, 0x110, [0x108]).map((c) => [c.span.start, c.span.end]), [
    [0x100, 0x108],
    [0x108, 0x110],
  ]);
});

test('nestedEntries: an entry inside an earlier extent is nested; the cartridge entry is clipped to the header', () => {
  const functions = [
    fact({ entry: BASE, end: BASE + 0xf4, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }] }),
    fact({ entry: HEADER_END, end: BASE + 0xf4, mode: 'arm' }),
    fact({ entry: BASE + 0x100, end: BASE + 0x120 }),
    fact({ entry: BASE + 0x110, end: BASE + 0x118 }),
    fact({ entry: BASE + 0x120, end: BASE + 0x128 }),
  ];
  assert.deepEqual([...nestedEntries(functions, HEADER_END)], [BASE + 0x110]);
});

/** Four Thumb functions; the first branches over the next two into the fourth (a short branch across two chunk starts). */
function crossingRom() {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    b _08000110
    pop {r0}
    bx r0
    push {lr}
    pop {r0}
    bx r0
    mov r8, r8
    push {lr}
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200, entry: BASE + 0x100 });
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: BASE + 0x100, end: BASE + 0x104 }),
      fact({ entry: BASE + 0x104, end: BASE + 0x108 }),
      fact({ entry: BASE + 0x108, end: BASE + 0x10e }),
      fact({ entry: BASE + 0x110, end: BASE + 0x116 }),
    ],
  });
  return { rom, analysis };
}

test('shortBranches decodes the b and bcc of the Thumb code spans', () => {
  const { rom, analysis } = crossingRom();
  assert.deepEqual(shortBranches(rom, analysis), [{ site: BASE + 0x102, target: BASE + 0x110 }]);
});

test('legalBorders: word-aligned chunk starts that no short branch crosses, with the base, the header end and the data start', () => {
  const { rom, analysis } = crossingRom();
  const layout = codeLayout(rom, analysis);
  assert.equal(layout.dataStart, BASE + 0x118);
  assert.deepEqual(
    layout.chunks.map((c) => c.span.start),
    [HEADER_END, BASE + 0x100, BASE + 0x104, BASE + 0x108, BASE + 0x10e, BASE + 0x110, BASE + 0x116],
  );
  // 0x104, 0x108 and 0x110 lie in (0x102, 0x110], so the branch crosses them; 0x10E and 0x116 are not word-aligned.
  assert.deepEqual(legalBorders(rom, analysis), [BASE, HEADER_END, BASE + 0x100, BASE + 0x118]);
});

test('legalBorders: no border strictly inside an assembly-only range; its two ends stay legal', () => {
  const armCode = armAt(BASE + 0x100)`
    mov r0, #1
    bx lr
    mov r0, #2
    bx lr
  `;
  const thumbCode = thumbAt(BASE + 0x110)`
    push {lr}
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: armCode }, { at: BASE + 0x110, bytes: thumbCode }], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' }), fact({ entry: BASE + 0x108, end: BASE + 0x110, mode: 'arm' }), fact({ entry: BASE + 0x110, end: BASE + 0x116 })],
  });
  const layout = codeLayout(rom, analysis);
  assert.deepEqual(layout.asmOnly, [{ start: BASE + 0x100, end: BASE + 0x110 }]);
  assert.deepEqual(layout.borders, [BASE, HEADER_END, BASE + 0x100, BASE + 0x110, BASE + 0x118]);
});

test('asmOnlyReasons: ARM code, a Thumb entry at 2 mod 4, a shared tail, a tiled hole', () => {
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108 })), []);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' })), ['arm']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x102, end: BASE + 0x108 })), ['unaligned-entry']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, exits: [{ at: BASE + 0x104, rule: 'walk.branch-into-function', kind: 'tail' }] })), ['shared-tail']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, exits: [{ at: BASE + 0x104, rule: 'walk.decoder-flow', kind: 'return' }] })), []);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x110, holes: [{ start: BASE + 0x104, end: BASE + 0x108 }] })), ['tiled-hole']);
});

test('asmOnlyRanges: consecutive assembly-only functions merge across orphans; agbcc code splits them; the startup region is left out', () => {
  const functions = [
    fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' }),
    fact({ entry: BASE + 0x10c, end: BASE + 0x110, mode: 'arm' }),
    fact({ entry: BASE + 0x110, end: BASE + 0x118 }),
    fact({ entry: BASE + 0x11a, end: BASE + 0x120 }),
  ];
  const chunks = tileCode(
    functions.map((f) => placed(f.entry, f.extent.end)),
    HEADER_END,
    BASE + 0x120,
    [],
  );
  const facts = new Map(functions.map((f) => [f.entry, f] as const));
  assert.deepEqual(asmOnlyRanges(chunks, facts, HEADER_END), [
    { start: BASE + 0x100, end: BASE + 0x110 },
    { start: BASE + 0x11a, end: BASE + 0x120 },
  ]);
  assert.deepEqual(asmOnlyRanges(chunks, facts, BASE + 0x110), [{ start: BASE + 0x11a, end: BASE + 0x120 }]);
});

test('codeLayout: the startup region ends on a chunk boundary and the data start is the code end rounded up to a word', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [fact({ entry: HEADER_END, end: BASE + 0xe2, mode: 'arm' }), fact({ entry: BASE + 0x100, end: BASE + 0x112 })],
    startupEnd: BASE + 0xe4,
  });
  const layout = codeLayout(rom, analysis);
  assert.equal(layout.startupEnd, BASE + 0xe4);
  assert.equal(layout.dataStart, BASE + 0x114);
  assert.deepEqual(
    layout.chunks.map((c) => [c.span.start, c.span.end]),
    [
      [HEADER_END, BASE + 0xe2],
      [BASE + 0xe2, BASE + 0xe4],
      [BASE + 0xe4, BASE + 0x100],
      [BASE + 0x100, BASE + 0x112],
      [BASE + 0x112, BASE + 0x114],
    ],
  );
  assert.ok(layout.borders.includes(BASE + 0xe4));
  assert.ok(layout.borders.includes(BASE + 0x114));
});

test('codeLayout: no data start border when the code runs to the ROM end', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x200 })] });
  const layout = codeLayout(rom, analysis);
  assert.equal(layout.dataStart, rom.end);
  assert.ok(!layout.borders.includes(rom.end));
});

test('nearestBorders names the legal borders below and above', () => {
  const borders = [BASE, HEADER_END, BASE + 0x100, BASE + 0x118];
  assert.deepEqual(nearestBorders(borders, BASE + 0x104), { below: BASE + 0x100, above: BASE + 0x118 });
  assert.deepEqual(nearestBorders(borders, BASE + 0x200), { below: BASE + 0x118, above: undefined });
  assert.deepEqual(nearestBorders(borders, BASE + 0x100), { below: HEADER_END, above: BASE + 0x118 });
});

test('listedEntriesOf: discover lists every function, nested ones as labels; confirm lists the listed seeds', () => {
  const rom = romWith([], { size: 0x200 });
  const functions = [fact({ entry: BASE + 0x100, end: BASE + 0x120 }), fact({ entry: BASE + 0x108, end: BASE + 0x110 })];
  assert.deepEqual(listedEntriesOf(analysisOf(rom, { functions }), HEADER_END), [
    { entry: BASE + 0x100, label: false },
    { entry: BASE + 0x108, label: true },
  ]);
  const confirm = analysisOf(rom, {
    functions,
    seeds: [
      { entry: BASE + 0x108, mode: 'thumb', rule: 'seed.listed', label: true },
      { entry: BASE + 0x100, mode: 'thumb', rule: 'seed.listed', size: 0x10 },
      { entry: BASE + 0x140, mode: 'thumb', rule: 'seed.evidence-hint' },
    ],
  });
  assert.deepEqual(listedEntriesOf(confirm, HEADER_END), [
    { entry: BASE + 0x100, label: false, size: 0x10 },
    { entry: BASE + 0x108, label: true },
  ]);
});

test('placeEntries: the size first, then the analysis extent, then a code override, else up to the next chunk', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x120 })],
    overrides: [{ span: { start: BASE + 0x140, end: BASE + 0x150 }, kind: 'code' }],
  });
  assert.deepEqual(
    placeEntries(
      [
        { entry: BASE + 0x100, label: false },
        { entry: BASE + 0x130, label: false, size: 6 },
        { entry: BASE + 0x144, label: false },
        { entry: BASE + 0x160, label: true },
      ],
      analysis,
    ),
    [
      { entry: BASE + 0x100, label: false, end: BASE + 0x120, source: 'analysis' },
      { entry: BASE + 0x130, label: false, end: BASE + 0x136, source: 'toml-size' },
      { entry: BASE + 0x144, label: false, end: BASE + 0x150, source: 'override' },
      { entry: BASE + 0x160, label: true, end: undefined, source: 'next-listed' },
    ],
  );
  assert.equal(factsByEntry(analysis).get(BASE + 0x100)?.extent.end, BASE + 0x120);
});
