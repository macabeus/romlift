// The model's items (architecture §6.2 step 1, §9.4, D14, D15): every ROM byte in exactly one item (a property
// test over seeded hand-made analyses), instructions from code spans (insn when they round-trip, raw-insn with
// the reason otherwise, cross-module-short-branch with W_CROSS_MODULE_SHORT_BRANCH), pool words, table entries,
// padding, notes on data inside extents, a data module as a few large items split at labels, and a printing
// cache that changes no answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnalysisResult, ClaimRun, FunctionFact, JumpTable } from '../../../src/core/analysis/types.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import { codeLayout } from '../../../src/core/layout/borders.ts';
import { itemAt } from '../../../src/core/model/item-table.ts';
import { segmentsOf } from '../../../src/core/model/segments.ts';
import { printingCache } from '../../../src/core/model/printing-cache.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import { resolverFor } from '../../../src/core/model/resolver.ts';
import type { Item, Model } from '../../../src/core/model/types.ts';
import { ITEM_RAW_REASONS, ItemKind } from '../../../src/core/model/types.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { decode, thumbWordAt } from '../../../src/foundation/isa/decode.ts';
import { rawReason } from '../../../src/foundation/isa/roundtrip.ts';
import { romFromBytes, u32 } from '../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import type { Addr, Span } from '../../../src/foundation/rom/span.ts';
import { prngSequence } from '../../helpers/prng.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith, thumbAt, tiles } from '../layout/hand-made.ts';

/** Every item of the model, decoded, in address order. */
function itemsOf(model: Model, rom: Rom): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < model.items.count; i++) out.push(itemAt(model.items, i, rom));
  return out;
}

/** Whether every chunk spans exactly its items, chunks tile the ROM, and modules hold their chunks. */
function consistent(model: Model, rom: Rom): string[] {
  const problems: string[] = [];
  let at: Addr = rom.base;
  model.chunks.forEach((c, i) => {
    if (c.span.start !== at) problems.push(`chunk ${i} starts at ${c.span.start.toString(16)}, not ${at.toString(16)}`);
    at = c.span.end;
    const first = model.items.start[c.items.first];
    const lastIndex = c.items.first + c.items.count - 1;
    const last = (model.items.start[lastIndex] ?? 0) + (model.items.length[lastIndex] ?? 0);
    if (c.items.count === 0 || first !== c.span.start || last !== c.span.end) problems.push(`chunk ${c.name} does not span its items`);
  });
  if (at !== rom.end) problems.push('the chunks do not reach the ROM end');
  model.modules.forEach((m) => {
    const own = model.chunks.slice(m.chunks.first, m.chunks.first + m.chunks.count);
    if (own.some((c) => c.module !== m.name) || own[0]?.span.start !== m.span.start || own[own.length - 1]?.span.end !== m.span.end) problems.push(`module ${m.name} does not hold its chunks`);
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// The tiling invariant, over seeded hand-made analyses.

/** A random analysis of a random ROM: facts that overlap, disagree and leave gaps, as a stress for the tiling. */
function randomCase(seed: number): { rom: Rom; analysis: AnalysisResult } {
  const r = prngSequence(seed, 4096);
  let k = 0;
  const next = (n: number): number => (r[k++ % r.length] ?? 0) % n;
  const size = 0x400 + 0x100 * next(8);
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = next(4) === 0 ? 0 : next(256);
  const rom = romFromBytes(bytes, `seed-${seed}`);
  const functions: FunctionFact[] = [];
  const claims: ClaimRun[] = [];
  let at = BASE + 0xc0 + 2 * next(32);
  while (at < rom.end - 0x40 && functions.length < 24) {
    const mode = next(5) === 0 ? 'arm' : 'thumb';
    const entry = mode === 'arm' ? at & ~3 : at & ~1;
    const length = 4 + 2 * next(40);
    const end = Math.min(rom.end, entry + length);
    const code: Span[] = [{ start: entry, end: Math.min(end, entry + (mode === 'arm' ? 4 : 2) * (1 + next(12))) }];
    if (next(3) === 0) code.push({ start: entry + 2 * next(length / 2), end: Math.min(rom.end, entry + 2 * next(length)) + 2 });
    const pools = Array.from({ length: next(3) }, () => ((entry + next(length + 16)) & ~3) >>> 0).filter((a) => a + 4 <= rom.end);
    const tables: JumpTable[] = [];
    if (next(4) === 0) {
      const base = ((entry + next(length)) & ~3) >>> 0;
      if (base + 8 <= rom.end) tables.push({ base, targets: [u32(rom, base) & ~1, next(2) === 0 ? u32(rom, base + 4) & ~1 : entry], thumbBit: next(2) === 0 });
    }
    const piece = (): Span[] => (next(3) === 0 ? [{ start: entry + next(length), end: Math.min(rom.end, entry + next(length) + 4) }] : []);
    functions.push(fact({ entry, end, mode, code: code.filter((s) => s.end > s.start), pools, tables, dead: piece(), holes: piece(), ...(next(6) === 0 ? { farPools: [((BASE + 0xc0 + next(size - 0xc4)) & ~3) >>> 0] } : {}) }));
    if (next(3) === 0) claims.push({ span: { start: end, end: Math.min(rom.end, end + 1 + next(6)) }, kind: next(2) === 0 ? Claim.padding : Claim.data });
    at = end + (next(3) === 0 ? 0 : 2 * next(16));
  }
  const unique = functions.filter((f, i) => functions.findIndex((g) => g.entry === f.entry) === i);
  return { rom, analysis: analysisOf(rom, { functions: unique, claims, startupEnd: next(2) === 0 ? HEADER_END : (unique[0]?.extent.end ?? HEADER_END) }) };
}

test('property: on seeded hand-made analyses the items tile the ROM exactly, every byte once', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { rom, analysis } = randomCase(seed);
    const config = configFromDiscover(rom, analysis);
    const model = buildModel(rom, analysis, config);
    assert.ok(tiles(model.items, rom.base, rom.end), `seed ${seed}: the items do not tile the ROM`);
    assert.deepEqual(consistent(model, rom), [], `seed ${seed}`);
    for (const item of itemsOf(model, rom)) {
      if (item.kind === 'pool') assert.equal(item.value, u32(rom, item.span.start), `seed ${seed}: pool value`);
      if (item.kind === 'table-entry') assert.equal((item.target | (item.thumbBit ? 1 : 0)) >>> 0, u32(rom, item.span.start), `seed ${seed}: table entry`);
    }
    assert.deepEqual(buildModel(rom, analysis, config), model, `seed ${seed}: deterministic`);
    // A moved border (any word-aligned address) still tiles, whatever its diagnostics say.
    const moved = configOf({ modules: [['rom_header', rom.base], ['a', HEADER_END], ['b', (rom.base + 0x100 + 4 * (seed % 16)) >>> 0]], functions: [...config.functions].map(([a, f]) => [a, f]) });
    const other = buildModel(rom, analysis, moved);
    assert.ok(tiles(other.items, rom.base, rom.end), `seed ${seed}: moved border`);
    assert.deepEqual(consistent(other, rom), [], `seed ${seed}: moved border`);
  }
});

test('on every committed fixture the items tile the ROM and decode', () => {
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const analysis = discover(rom);
    const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
    assert.ok(tiles(model.items, rom.base, rom.end), fixture.name);
    assert.deepEqual(consistent(model, rom), [], fixture.name);
    assert.equal(itemsOf(model, rom).length, model.items.count);
  }
});

// ---------------------------------------------------------------------------------------------------
// What each byte becomes.

test('segments: code wins over a pool word it overlaps, a pool partly overlapped is dropped, padding is zeros up to a word', () => {
  const bytes = romWith([{ at: BASE + 0x120, bytes: Uint8Array.of(0, 0, 0xc0, 0x46, 0, 0) }], { size: 0x200 });
  const analysis = analysisOf(bytes, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x118, code: [{ start: BASE + 0x100, end: BASE + 0x10a }], pools: [BASE + 0x108, BASE + 0x10c] })],
    claims: [
      { span: { start: BASE + 0x11e, end: BASE + 0x120 }, kind: Claim.padding },
      { span: { start: BASE + 0x122, end: BASE + 0x124 }, kind: Claim.padding },
      { span: { start: BASE + 0x126, end: BASE + 0x12c }, kind: Claim.padding },
    ],
  });
  const { concrete } = segmentsOf(bytes, analysis, HEADER_END);
  assert.deepEqual(
    concrete.map((s) => [s.kind, s.start - BASE, s.end - BASE]),
    [
      ['code', 0x100, 0x10a],
      ['pool', 0x10c, 0x110],
      ['padding', 0x11e, 0x120],
      ['data', 0x122, 0x124],
      ['padding', 0x126, 0x128],
      ['data', 0x128, 0x12c],
    ],
  );
});

test('data notes: dead, mixer-hole and unreached inside extents, none outside them nor in the header', () => {
  const rom = romWith([], { size: 0x200 });
  const analysis = analysisOf(rom, {
    functions: [
      fact({ entry: BASE, end: BASE + 0xc4, mode: 'arm', code: [{ start: BASE, end: BASE + 4 }], holes: [{ start: BASE + 4, end: BASE + 0xbe }] }),
      fact({
        entry: BASE + 0x100,
        end: BASE + 0x120,
        code: [{ start: BASE + 0x100, end: BASE + 0x104 }],
        dead: [{ start: BASE + 0x104, end: BASE + 0x108 }],
        holes: [{ start: BASE + 0x10c, end: BASE + 0x110 }],
      }),
    ],
  });
  const model = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x120, kind: 'data', generated: true }], functions: [[BASE, { mode: 'arm' }], [BASE + 0x100, 'F']] }));
  const notes = itemsOf(model, rom)
    .filter((i) => i.kind === 'data')
    .map((i) => [i.span.start - BASE, i.span.end - BASE, i.kind === 'data' ? (i.note ?? '-') : '']);
  assert.deepEqual(notes, [
    [4, 0xc0, '-'],
    [0xc0, 0xc4, 'unreached'],
    [0xc4, 0x100, '-'],
    [0x104, 0x108, 'dead'],
    [0x108, 0x10c, 'unreached'],
    [0x10c, 0x110, 'mixer-hole'],
    [0x110, 0x120, 'unreached'],
    [0x120, 0x200, '-'],
  ]);
});

test('the zeros up to a word before a pool word inside a function are padding (D16); other free bytes stay data', () => {
  const code = thumbAt(BASE + 0x100)`
    ldr r0, _08000108
    adds r0, #1
    bx lr
  `;
  const pool = Uint8Array.of(0x00, 0x00, 0x00, 0x02);
  const cases: readonly { readonly gap: Uint8Array; readonly expect: readonly (readonly [string, number, number])[] }[] = [
    { gap: Uint8Array.of(0, 0), expect: [['padding', 0x106, 0x108], ['pool', 0x108, 0x10c]] },
    { gap: Uint8Array.of(0xc0, 0x46), expect: [['data', 0x106, 0x108], ['pool', 0x108, 0x10c]] },
  ];
  for (const { gap, expect } of cases) {
    const rom = romWith([{ at: BASE + 0x100, bytes: code }, { at: BASE + 0x106, bytes: gap }, { at: BASE + 0x108, bytes: pool }], { size: 0x200 });
    const analysis = analysisOf(rom, {
      functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10c, code: [{ start: BASE + 0x100, end: BASE + 0x106 }], dead: [{ start: BASE + 0x106, end: BASE + 0x108 }], pools: [BASE + 0x108] })],
    });
    const model = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x10c, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'F']] }));
    const tail = itemsOf(model, rom).filter((i) => i.span.start >= BASE + 0x106 && i.span.start < BASE + 0x10c);
    assert.deepEqual(
      tail.map((i) => [i.kind, i.span.start - BASE, i.span.end - BASE]),
      expect,
    );
  }
});

test('a data module is a few large items, split where a label starts', () => {
  const code = thumbAt(BASE + 0x100)`
    ldr r0, _08000108
    bx lr
    mov r8, r8
    mov r8, r8
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }, { at: BASE + 0x108, bytes: Uint8Array.of(0x40, 0x01, 0x00, 0x08) }], { size: 0x400 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10c, code: [{ start: BASE + 0x100, end: BASE + 0x104 }], pools: [BASE + 0x108] })] });
  const model = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], { name: 'data', start: BASE + 0x10c, kind: 'data', generated: true }], functions: [[BASE + 0x100, 'F']], symbols: [[BASE + 0x300, { name: 'gThing', aliases: [] }]] }));
  const data = itemsOf(model, rom).filter((i) => i.span.start >= BASE + 0x10c);
  assert.deepEqual(data.map((i) => [i.kind, i.span.start - BASE, i.span.end - BASE]), [
    ['data', 0x10c, 0x140],
    ['data', 0x140, 0x300],
    ['data', 0x300, 0x400],
  ]);
  assert.deepEqual(model.labels.filter((l) => l.addr >= BASE + 0x10c).map((l) => [l.name, l.kind, l.scope]), [
    ['gUnk_0800010C', 'data', 'module'],
    ['gUnk_08000140', 'data', 'global'],
    ['gThing', 'data', 'module'],
  ]);
});

test('an instruction is insn when it round-trips, raw-insn with its reason otherwise', () => {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    bl _08100000
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }, { at: BASE + 0x10a, bytes: Uint8Array.of(0x00, 0xde) }], { size: 0x200 });
  const analysis = analysisOf(rom, { functions: [fact({ entry: BASE + 0x100, end: BASE + 0x10c })] });
  const model = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions: [[BASE + 0x100, 'F']] }));
  const code0 = itemsOf(model, rom).filter((i) => i.span.start >= BASE + 0x100 && i.span.start < BASE + 0x10c);
  assert.deepEqual(code0.map((i) => [i.kind, i.span.start - BASE, i.kind === 'raw-insn' ? i.reason : '']), [
    ['insn', 0x100, ''],
    ['raw-insn', 0x102, 'no-roundtrip'],
    ['insn', 0x106, ''],
    ['insn', 0x108, ''],
    ['raw-insn', 0x10a, 'undefined'],
  ]);
});

test('a short Thumb branch across a moved border prints raw with W_CROSS_MODULE_SHORT_BRANCH (D15)', () => {
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
  const functions: [Addr, string][] = [[BASE + 0x100, 'A'], [BASE + 0x108, 'B']];
  const together = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], functions }));
  assert.deepEqual(together.diagnostics, []);
  const at = (model: Model, a: Addr): number => [...model.items.start].indexOf(a);
  assert.equal(together.items.kind[at(together, BASE + 0x102)], ItemKind.insn, 'b B in one module prints symbolically');

  const split = buildModel(rom, analysis, configOf({ modules: [['rom_header', BASE], ['main', HEADER_END], ['moved', BASE + 0x108]], functions }));
  assert.deepEqual(split.diagnostics.map((d) => [d.code, d.addr]), [
    ['W_CROSS_MODULE_SHORT_BRANCH', BASE + 0x102],
    ['E_MODULE_BORDER', BASE + 0x108],
  ]);
  const branch = itemsOf(split, rom).find((i) => i.span.start === BASE + 0x102);
  assert.deepEqual(branch?.kind === 'raw-insn' ? [branch.reason, branch.insn?.specId] : branch, ['cross-module-short-branch', 'thumb.b']);
  assert.equal(split.items.aux[at(split, BASE + 0x102)], ITEM_RAW_REASONS.indexOf('cross-module-short-branch'));
  assert.equal(split.labels.find((l) => l.name === 'B')?.scope, 'module', 'a raw branch references nothing');
});

test('a bl naming a function of the other state prints raw with W_INTERWORKING_BRANCH: ld would insert a veneer (correctness-r2-2)', () => {
  const code = thumbAt(BASE + 0x100)`
    push {lr}
    bl _08000108
    pop {r0}
    bx r0
    push {lr}
    pop {r0}
    bx r0
  `;
  const rom = romWith([{ at: BASE + 0x100, bytes: code }], { size: 0x200 });
  const modules = [['rom_header', BASE], ['main', HEADER_END]] as const;
  const caller = fact({ entry: BASE + 0x100, end: BASE + 0x108 });
  // B as the bytes are (Thumb): the bl names it.
  const thumb = buildModel(rom, analysisOf(rom, { functions: [caller, fact({ entry: BASE + 0x108, end: BASE + 0x10e })] }), configOf({ modules, functions: [[BASE + 0x100, 'A'], [BASE + 0x108, 'B']] }));
  assert.deepEqual(thumb.diagnostics, []);
  assert.equal(itemsOf(thumb, rom).find((i) => i.span.start === BASE + 0x102)?.kind, 'insn');
  // B listed `arm`, as a config may say against its Thumb callers: the bl prints raw and its bytes stay the ROM's.
  const armB = fact({ entry: BASE + 0x108, end: BASE + 0x108, mode: 'arm', code: [] });
  const arm = buildModel(rom, analysisOf(rom, { functions: [caller, armB] }), configOf({ modules, functions: [[BASE + 0x100, 'A'], [BASE + 0x108, { name: 'B', mode: 'arm' }]] }));
  assert.equal(arm.labels.find((l) => l.name === 'B')?.thumb, false);
  assert.deepEqual(arm.diagnostics.map((d) => [d.code, d.addr, d.cites]), [['W_INTERWORKING_BRANCH', BASE + 0x102, [BASE + 0x108]]]);
  assert.match(arm.diagnostics[0]?.message ?? '', /the Thumb branch at 0x08000102 reaches B at 0x08000108, an ARM function/);
  const branch = itemsOf(arm, rom).find((i) => i.span.start === BASE + 0x102);
  assert.deepEqual(branch?.kind === 'raw-insn' ? [branch.reason, branch.insn?.specId] : branch, ['interworking-branch', 'thumb.bl']);
  assert.equal(arm.items.aux[[...arm.items.start].indexOf(BASE + 0x102)], ITEM_RAW_REASONS.indexOf('interworking-branch'));
});

test('the printing cache gives the answer rawReason gives, on every instruction of every fixture', () => {
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const analysis = discover(rom);
    const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
    const cache = printingCache();
    const layout = codeLayout(rom, analysis);
    for (const f of analysis.functions) {
      const module = model.modules.find((m) => f.entry >= m.span.start && f.entry < m.span.end)?.name ?? '';
      const resolver = resolverFor(model, module);
      for (const span of f.code) {
        for (let a = Math.max(span.start, layout.headerEnd); a < span.end; ) {
          const insn = decode(f.mode, f.mode === 'thumb' ? thumbWordAt(rom, a) : u32(rom, a), a);
          // Twice: the second answer comes from the cache.
          assert.equal(cache.reasonOf(insn, resolver), rawReason(insn, resolver), `${fixture.name} 0x${a.toString(16)}`);
          assert.equal(cache.reasonOf(insn, resolver), rawReason(insn, resolver), `${fixture.name} 0x${a.toString(16)} (cached)`);
          a += insn.size;
        }
      }
    }
  }
});
