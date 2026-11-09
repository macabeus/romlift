// inferSymbolExtents (core/model/extents.ts, D110): the least extent of an unsized work-RAM [symbols] entry is the
// largest end of an access the code makes through a register holding the entry's address, cut at the next named start;
// and W_POOL_WORD_PAST_SYMBOL names the pool words a function loads beside the entry, past that extent.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ExtentFact } from '../../../src/core/model/extents.ts';
import { inferSymbolExtents } from '../../../src/core/model/extents.ts';
import { sizedEntries, sizedEntryAt } from '../../../src/core/model/resolver.ts';
import type { ModelSymbol } from '../../../src/core/model/types.ts';
import type { Addr } from '../../../src/foundation/rom/span.ts';
import { romWith, words } from '../../helpers/analysis.ts';
import { thumbAt } from '../../helpers/thumb.ts';

const CODE = 0x0800_0100;
const POOL = 0x0800_0180;
const G_A = 0x0300_0100;

/** One Thumb function at CODE whose pool at POOL holds `pool`; `text` names pool word i as `_<POOL + 4i>`. */
function run(text: string, pool: readonly number[], symbols: readonly ModelSymbol[], extra: Partial<ExtentFact> = {}): ReturnType<typeof inferSymbolExtents> {
  const code = thumbAt(CODE)([text] as unknown as TemplateStringsArray);
  assert.ok(CODE + code.length <= POOL, 'the code fits below the pool');
  const rom = romWith([
    { at: CODE, bytes: code },
    { at: POOL, bytes: words(...pool) },
  ]);
  const fact: ExtentFact = {
    entry: CODE,
    mode: 'thumb',
    code: [{ start: CODE, end: CODE + code.length }],
    pools: pool.map((_, i) => POOL + 4 * i),
    farPools: [],
    branchTargets: [],
    tables: [],
    ...extra,
  };
  return inferSymbolExtents(rom, { functions: [fact] }, symbols, [], []);
}

const p = (i: number): string => `_${(POOL + 4 * i).toString(16).toUpperCase().padStart(8, '0')}`;

function sizeOf(result: ReturnType<typeof inferSymbolExtents>, addr: Addr): number | undefined {
  return result.symbols.find((s) => s.addr === addr)?.inferredSize;
}

test('an immediate displacement through the loaded address proves the extent to its end', () => {
  const r = run(`ldr r1, ${p(0)}; ldrb r0, [r1, #5]; ldrh r2, [r1, #8]; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]);
  assert.equal(sizeOf(r, G_A), 10);
  assert.deepEqual(r.diagnostics, []);
});

test('a register offset from a constant, built by movs and lsls, and an adds on the base count too', () => {
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; movs r2, #0x39; ldrb r0, [r1, r2]; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]), G_A), 0x3a);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; movs r2, #0x80; lsls r2, r2, #1; ldrh r0, [r2, r1]; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]), G_A), 0x102);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; adds r1, #0x40; str r0, [r1, #4]; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]), G_A), 0x48);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; mov r8, r1; mov r3, r8; ldmia r3!, {r0, r2}; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]), G_A), 8);
});

test('the extent stops at the next named start and at the region end', () => {
  const symbols = [
    { addr: G_A, name: 'gA' },
    { addr: G_A + 8, name: 'gB' },
  ];
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; ldrb r0, [r1, #0x10]; bx lr`, [G_A], symbols), G_A), 8);
  const iwramEnd = 0x0300_7ff8;
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; ldr r0, [r1, #0x10]; bx lr`, [iwramEnd], [{ addr: iwramEnd, name: 'gLast' }]), iwramEnd), 8);
});

test('a value is forgotten when it is overwritten, at a branch target, after an unconditional branch, and in r0-r3 across a call', () => {
  const gA = [{ addr: G_A, name: 'gA' }];
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; movs r1, #0; ldrb r0, [r1, #9]; bx lr`, [G_A], gA), G_A), undefined);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; L: ldrb r0, [r1, #9]; bx lr`, [G_A], gA, { branchTargets: [CODE + 2] }), G_A), undefined);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; b L; L: ldrb r0, [r1, #9]; bx lr`, [G_A], gA), G_A), undefined);
  assert.equal(sizeOf(run(`ldr r1, ${p(0)}; ldr r4, ${p(0)}; bl _08000170; ldrb r0, [r1, #7]; ldrb r0, [r4, #3]; bx lr`, [G_A], gA), G_A), 4);
});

test('only an unsized work-RAM entry gets an inferred size, and it names the words inside it', () => {
  const symbols = [
    { addr: G_A, name: 'gA', size: 2 },
    { addr: 0x0400_0000, name: 'REG_DISPCNT' },
  ];
  const r = run(`ldr r1, ${p(0)}; ldrb r0, [r1, #9]; ldr r2, ${p(1)}; ldrh r0, [r2, #8]; bx lr`, [G_A, 0x0400_0000], symbols);
  assert.deepEqual(r.symbols, symbols);
  const named = run(`ldr r1, ${p(0)}; ldrb r0, [r1, #9]; bx lr`, [G_A], [{ addr: G_A, name: 'gA' }]);
  const entries = sizedEntries({ symbols: named.symbols, functions: [] });
  assert.equal(sizedEntryAt(entries, G_A + 5)?.name, 'gA');
  assert.equal(sizedEntryAt(entries, G_A + 10), undefined);
});

test('W_POOL_WORD_PAST_SYMBOL: one per entry, naming the words past its extent and before the next named start', () => {
  const symbols = [
    { addr: G_A, name: 'gA' },
    { addr: G_A + 0x100, name: 'gB', size: 8 },
  ];
  const r = run(`ldr r1, ${p(0)}; ldrb r0, [r1, #5]; bx lr`, [G_A, G_A + 3, G_A + 0x80, G_A + 0x100, G_A + 0x104], symbols);
  assert.equal(sizeOf(r, G_A), 6);
  assert.deepEqual(
    r.diagnostics.map((d) => [d.code, d.addr]),
    [['W_POOL_WORD_PAST_SYMBOL', G_A]],
  );
  const message = r.diagnostics[0]?.message ?? '';
  assert.match(message, /0x03000180 \(\+0x80\)/);
  assert.match(message, /at least 0x6 bytes/);
  assert.doesNotMatch(message, /0x03000103|0x03000200|0x03000204/, 'not a word inside the extent, nor one at or past the next named start');
  assert.deepEqual(run(`bx lr`, [G_A + 0x80], symbols).diagnostics, [], 'a word past an entry the function does not load is not reported');
});
