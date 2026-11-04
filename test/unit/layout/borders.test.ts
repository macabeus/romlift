// Legal borders (architecture §6.2, D15, D20, D109): the code region tiled like the PoC's tile(), word-aligned chunk
// starts, none that a short Thumb branch or a PC-relative load or adr crosses (D63); a start inside an assembly-only
// range is legal too (D109), and the layout says why a start is refused; the cartridge
// entry's extent over the header clipped when nesting entries (correctness-6).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asmOnlyRanges, asmOnlyReasons } from '../../../src/core/layout/asm-only.ts';
import { codeLayout, isLegalStart, legalBorders, legalStartsBetween, nearestBorders, nearestLegalStarts } from '../../../src/core/layout/borders.ts';
import { coveredEntries, factsByEntry, headerCoveredEntries, isLabelEntry, listedEntriesOf, nestedEntries, placeEntries } from '../../../src/core/layout/entries.ts';
import type { PlacedEntry } from '../../../src/core/layout/entries.ts';
import { borderRefs } from '../../../src/core/layout/refs.ts';
import { tileCode } from '../../../src/core/layout/tiling.ts';
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

test('coveredEntries clips nothing; headerCoveredEntries is what only the cartridge entry covers; isLabelEntry starts a chunk there', () => {
  const functions = [
    fact({ entry: BASE, end: BASE + 0xf4, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }] }),
    fact({ entry: HEADER_END, end: BASE + 0xe0, mode: 'arm' }),
    fact({ entry: BASE + 0xe0, end: BASE + 0xf4, mode: 'arm' }),
    fact({ entry: BASE + 0x100, end: BASE + 0x120 }),
    fact({ entry: BASE + 0x110, end: BASE + 0x118 }),
  ];
  assert.deepEqual([...coveredEntries(functions)], [HEADER_END, BASE + 0xe0, BASE + 0x110]);
  assert.deepEqual([...nestedEntries(functions, HEADER_END)], [BASE + 0x110]);
  const headerCovered = headerCoveredEntries(functions, HEADER_END);
  assert.deepEqual([...headerCovered], [HEADER_END, BASE + 0xe0]);
  assert.equal(isLabelEntry(HEADER_END, true, headerCovered), false);
  assert.equal(isLabelEntry(BASE + 0x110, true, headerCovered), true);
  assert.equal(isLabelEntry(BASE + 0x110, undefined, headerCovered), false);
});

test('listedEntriesOf in confirm mode: a label entry only the cartridge entry covers is not a label', () => {
  const rom = romWith([], { size: 0x200 });
  const functions = [
    fact({ entry: BASE, end: BASE + 0xf4, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }] }),
    fact({ entry: HEADER_END, end: BASE + 0xf4, mode: 'arm' }),
    fact({ entry: BASE + 0x100, end: BASE + 0x120 }),
    fact({ entry: BASE + 0x108, end: BASE + 0x110 }),
  ];
  const confirm = analysisOf(rom, {
    functions,
    seeds: [
      { entry: BASE, mode: 'arm', rule: 'seed.listed' },
      { entry: HEADER_END, mode: 'arm', rule: 'seed.listed', label: true },
      { entry: BASE + 0x100, mode: 'thumb', rule: 'seed.listed' },
      { entry: BASE + 0x108, mode: 'thumb', rule: 'seed.listed', label: true },
    ],
  });
  assert.deepEqual(listedEntriesOf(confirm, HEADER_END), [
    { entry: BASE, label: false },
    { entry: HEADER_END, label: false },
    { entry: BASE + 0x100, label: false },
    { entry: BASE + 0x108, label: true },
  ]);
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

test('borderRefs decodes the b and bcc of the Thumb code spans', () => {
  const { rom, analysis } = crossingRom();
  assert.deepEqual(borderRefs(rom, analysis).shortBranches, [{ site: BASE + 0x102, target: BASE + 0x110 }]);
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

/**
 * A Thumb function loading a pool word that lies in the next chunk, an orphan; then an ARM function whose adr
 * names the word after its extent (another orphan), and a Thumb function after it. Every chunk start is
 * word-aligned and no short branch crosses one.
 */
function pcRelativeRom() {
  const thumb = thumbAt(BASE + 0x100)`
    ldr r0, _08000108
    bx lr
  `;
  const arm = armAt(BASE + 0x110)`
    adr r0, _08000118
    bx lr
  `;
  const tail = thumbAt(BASE + 0x120)`
    bx lr
  `;
  const rom = romWith(
    [
      { at: BASE + 0x100, bytes: thumb },
      { at: BASE + 0x110, bytes: arm },
      { at: BASE + 0x120, bytes: tail },
    ],
    { size: 0x200 },
  );
  const analysis = analysisOf(rom, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x104 }), fact({ entry: BASE + 0x110, end: BASE + 0x118, mode: 'arm' }), fact({ entry: BASE + 0x120, end: BASE + 0x122 })],
  });
  return { rom, analysis };
}

test('borderRefs decodes the PC-relative loads and adrs of the Thumb and ARM code spans', () => {
  const { rom, analysis } = pcRelativeRom();
  assert.deepEqual(borderRefs(rom, analysis).pcRelative, [
    { site: BASE + 0x100, target: BASE + 0x108 },
    { site: BASE + 0x110, target: BASE + 0x118 },
  ]);
});

test('legalBorders: no PC-relative load or adr crosses a border, since as cannot relocate one to another object (D63)', () => {
  const { rom, analysis } = pcRelativeRom();
  const layout = codeLayout(rom, analysis);
  assert.deepEqual(
    layout.chunks.map((c) => c.span.start),
    [HEADER_END, BASE + 0x100, BASE + 0x104, BASE + 0x110, BASE + 0x118, BASE + 0x120, BASE + 0x122],
  );
  // The load at 0x100 names 0x108, past the orphan's start 0x104; the adr at 0x110 names 0x118, the orphan after
  // its extent. 0x118 itself stays illegal (in (0x110, 0x118]); 0x110 and 0x120 are legal.
  assert.deepEqual(legalBorders(rom, analysis), [BASE, HEADER_END, BASE + 0x100, BASE + 0x110, BASE + 0x120, BASE + 0x124]);
});

test('legalBorders: a chunk start inside an assembly-only range that nothing crosses is legal (D109)', () => {
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
  // Inference still sees one assembly-only run of the two ARM functions; the border between them is legal all the same.
  assert.deepEqual(layout.asmOnly, [{ start: BASE + 0x100, end: BASE + 0x110 }]);
  assert.deepEqual(layout.borders, [BASE, HEADER_END, BASE + 0x100, BASE + 0x108, BASE + 0x110, BASE + 0x118]);
  assert.ok(isLegalStart(layout, BASE + 0x108));
  assert.equal(layout.why?.(BASE + 0x108), undefined);
});

test('why: an illegal start is named as unaligned, as no chunk start, or by the first reference that crosses it', () => {
  const code = thumbAt(BASE + 0x100)`
    movs r0, #0
    b _0800010A
    movs r0, #1
    bx lr
    movs r0, #2
    bx lr
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x108 }), fact({ entry: BASE + 0x108, end: BASE + 0x10c })] });
  const layout = codeLayout(rom, analysis);
  assert.ok(!isLegalStart(layout, BASE + 0x108));
  assert.match(layout.why?.(BASE + 0x108) ?? '', /^the short branch at 0x08000102 to 0x0800010A crosses it/);
  assert.match(layout.why?.(BASE + 0x102) ?? '', /^it is not word-aligned/);
  assert.match(layout.why?.(BASE + 0x104) ?? '', /^no function or orphan chunk starts there/);
  assert.equal(layout.why?.(BASE + 0x100), undefined);
});

test('asmOnlyReasons: ARM code, a Thumb entry at 2 mod 4, a shared tail, a tiled hole, a Thumb bx pc', () => {
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108 })), []);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' })), ['arm']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x102, end: BASE + 0x108 })), ['unaligned-entry']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, exits: [{ at: BASE + 0x104, rule: 'walk.branch-into-function', kind: 'tail' }] })), ['shared-tail']);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x108, exits: [{ at: BASE + 0x104, rule: 'walk.decoder-flow', kind: 'return' }] })), []);
  assert.deepEqual(asmOnlyReasons(fact({ entry: BASE + 0x100, end: BASE + 0x110, holes: [{ start: BASE + 0x104, end: BASE + 0x108 }] })), ['tiled-hole']);
  // A Thumb `bx pc` veneer: agbcc emits no `bx pc`, so the stub stays with its ARM half (final-review end-to-end-user-3).
  assert.deepEqual(asmOnlyReasons({ ...fact({ entry: BASE + 0x100, end: BASE + 0x102 }), veneers: [BASE + 0x104] }), ['mode-switch']);
  assert.deepEqual(asmOnlyReasons({ ...fact({ entry: BASE + 0x100, end: BASE + 0x108, mode: 'arm' }), veneers: [BASE + 0x104] }), ['arm']);
});

test('asmOnlyRanges: a run of Thumb `bx pc` stubs, their nop orphans and the ARM code behind them is one range', () => {
  // klonoa's linker thunks: `bx pc` at 0x…AC, `.2byte 0x46C0` at 0x…AE, the ARM branch at 0x…B0, six times over.
  const functions = [
    fact({ entry: BASE + 0x100, end: BASE + 0x104, mode: 'arm' }),
    { ...fact({ entry: BASE + 0x104, end: BASE + 0x106 }), veneers: [BASE + 0x108] },
    fact({ entry: BASE + 0x108, end: BASE + 0x10c, mode: 'arm' }),
    { ...fact({ entry: BASE + 0x10c, end: BASE + 0x10e }), veneers: [BASE + 0x110] },
    fact({ entry: BASE + 0x110, end: BASE + 0x114, mode: 'arm' }),
    fact({ entry: BASE + 0x114, end: BASE + 0x118 }),
  ];
  const chunks = tileCode(
    functions.map((f) => placed(f.entry, f.extent.end)),
    HEADER_END,
    BASE + 0x118,
    [],
  );
  const facts = new Map(functions.map((f) => [f.entry, f] as const));
  assert.deepEqual(asmOnlyRanges(chunks, facts, HEADER_END), [{ start: BASE + 0x100, end: BASE + 0x114 }]);
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

test('isLegalStart is the whole rule: the code borders, then every word from the data start to the ROM end (architecture-r1-3, D75 a)', () => {
  const { rom, analysis } = crossingRom();
  const layout = codeLayout(rom, analysis);
  assert.equal(layout.end, rom.end);
  // Below the data start only the borders; 0x104 is crossed by the branch, 0x10E is no word.
  for (const b of layout.borders) assert.ok(isLegalStart(layout, b), `border ${b.toString(16)}`);
  assert.deepEqual([BASE + 0x104, BASE + 0x10e, BASE + 0x110, BASE + 0x116].map((a) => isLegalStart(layout, a)), [false, false, false, false]);
  // At or past the data start every word before the ROM end.
  assert.deepEqual([layout.dataStart, layout.dataStart + 4, layout.dataStart + 2, rom.end - 4, rom.end].map((a) => isLegalStart(layout, a)), [true, true, false, true, false]);
  const rule = { borders: [BASE, HEADER_END, BASE + 0x100], dataStart: BASE + 0x120, end: BASE + 0x140 };
  assert.deepEqual(legalStartsBetween(rule, BASE + 0x100, BASE + 0x130), [BASE + 0x120, BASE + 0x124, BASE + 0x128, BASE + 0x12c]);
  assert.deepEqual(legalStartsBetween(rule, BASE, BASE + 0x124), [HEADER_END, BASE + 0x100, BASE + 0x120]);
  assert.deepEqual(legalStartsBetween(rule, BASE + 0x13c, BASE + 0x200), [], 'the ROM end starts nothing');
  for (let a = BASE; a < BASE + 0x150; a += 2) assert.equal(legalStartsBetween(rule, a - 1, a + 1).length === 1, isLegalStart(rule, a), `between agrees with the predicate at ${a.toString(16)}`);
});

test('nearestLegalStarts: the nearest borders below the data start, the nearest words past it', () => {
  const rule = { borders: [BASE, HEADER_END, BASE + 0x100, BASE + 0x118], dataStart: BASE + 0x118, end: BASE + 0x200 };
  assert.deepEqual(nearestLegalStarts(rule, BASE + 0x104), { below: BASE + 0x100, above: BASE + 0x118 });
  assert.deepEqual(nearestLegalStarts(rule, BASE + 0x11a), { below: BASE + 0x118, above: BASE + 0x11c });
  assert.deepEqual(nearestLegalStarts(rule, BASE + 0x1fe), { below: BASE + 0x1fc, above: undefined });
  assert.deepEqual(nearestLegalStarts(rule, BASE + 0x100), { below: HEADER_END, above: BASE + 0x118 });
  // With no data region (the data start at the ROM end) it is nearestBorders.
  const none = { ...rule, dataStart: rule.end };
  assert.deepEqual(nearestLegalStarts(none, BASE + 0x1fe), nearestBorders(rule.borders, BASE + 0x1fe));
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
      { entry: BASE + 0x140, mode: 'thumb', rule: 'seed.override' },
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
      { entry: BASE + 0x144, label: false, end: BASE + 0x150, source: 'override', override: { span: { start: BASE + 0x140, end: BASE + 0x150 }, kind: 'code' } },
      { entry: BASE + 0x160, label: true, end: undefined, source: 'next-listed' },
    ],
  );
  assert.equal(factsByEntry(analysis).get(BASE + 0x100)?.extent.end, BASE + 0x120);
});
