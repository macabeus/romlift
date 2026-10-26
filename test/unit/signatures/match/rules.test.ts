// The five sig.* placement rules (architecture §7.2, roadmap 6.B), each on synthetic ROM bytes where it is the rule
// that decides and every stronger rule does not: the placement carries its id, and the same run without that rule's
// stage places nothing there. Plus the matcher's scan (anchors, the code range, the candidate cap) and the pointer
// table refusal (W_SIGNATURE_POINTERS).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchSignatures } from '../../../../src/core/signatures/match.ts';
import type { SignatureMatch } from '../../../../src/core/signatures/match.ts';
import { SIGNATURE_POLICY } from '../../../../src/core/signatures/policy.ts';
import type { SignaturePolicy } from '../../../../src/core/signatures/policy.ts';
import type { SignatureFile, SignatureRuleId } from '../../../../src/core/signatures/schema.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import { romWith } from '../../../helpers/analysis.ts';
import type { Placed } from '../../../helpers/analysis.ts';
import { arm } from '../../../helpers/arm.ts';
import { codeRange, concat, contiguous, distinct, idOf, signatureFile, withWord, wordBytes } from '../../../helpers/signatures.ts';
import type { FunctionSpec, MemberSpec, TableSpec } from '../../../helpers/signatures.ts';
import { thumb } from '../../../helpers/thumb.ts';

const CODE = codeRange(0x0800_0100, 0x0801_0000);

/** The policy without the stage rules `rule` belongs to (the other rules of its stage stay). */
function without(rule: SignatureRuleId): SignaturePolicy {
  return { ...SIGNATURE_POLICY, stages: SIGNATURE_POLICY.stages.map((s) => ({ ...s, rules: s.rules.filter((r) => r !== rule) })) };
}

function run(rom: Rom, files: readonly SignatureFile[], policy: SignaturePolicy = SIGNATURE_POLICY): SignatureMatch {
  return matchSignatures(rom, CODE, files, policy);
}

/** Each placement as `name rule 0xADDR`. */
function placed(m: SignatureMatch): string[] {
  return m.placements.map((p) => `${p.name} ${p.rule} 0x${p.addr.toString(16)}`);
}

const at = (addr: number, bytes: Uint8Array): Placed => ({ at: addr, bytes });

// Four-byte BIOS call stubs: nothing alone (4 unmasked bytes), common on a ROM.
const stub = (n: number, name = `Swi${n}`): FunctionSpec => ({ name, bytes: thumb`swi #${n}; bx lr` });
const big = (name: string, seed: number, size = 32): FunctionSpec => ({ name, bytes: distinct(seed, size) });

test('sig.unique-fit: a free member that fits once is placed there', () => {
  const fn: FunctionSpec = { name: 'Compute', bytes: thumb`push {r4, r5, lr}; movs r4, #3; movs r5, #7; adds r0, r4, r5; lsls r0, r0, #2; subs r0, #1; pop {r4, r5, pc}` };
  const rom = romWith([at(0x0800_1000, fn.bytes)]);
  const file = signatureFile('lib', { id: '1', members: [fn] });
  const m = run(rom, [file]);
  assert.deepEqual(m.placements, [{ library: 'lib', version: '1', member: idOf('Compute'), name: 'Compute', kind: 'function', addr: 0x0800_1000, size: 14, mode: 'thumb', rule: 'sig.unique-fit' }]);
  assert.deepEqual(m.diagnostics, []);
  assert.deepEqual(run(rom, [file], without('sig.unique-fit')).placements, []);
});

test('sig.unique-fit: two fits are ambiguous, counted without addresses', () => {
  const fn = big('Twice', 1);
  const rom = romWith([at(0x0800_1000, fn.bytes), at(0x0800_2000, fn.bytes)]);
  const m = run(rom, [signatureFile('lib', { id: '1', members: [fn] })]);
  assert.deepEqual(m.placements, []);
  assert.equal(m.diagnostics.length, 1);
  const d = m.diagnostics[0];
  assert.equal(d?.code, 'W_SIGNATURE_AMBIGUOUS');
  assert.equal(d.message, 'lib@1: Twice fits at 2 places and no neighbour settles it; nothing of lib@1 is placed, so the ROM likely does not link it');
  assert.equal(d.addr, undefined);
});

test('sig.unique-fit: the ambiguous members of a version are one line, which says when the version placed nothing (final-review clean-clone-6)', () => {
  const twice = big('Twice', 1);
  const thrice = big('Thrice', 4);
  const placedFn = big('Once', 5);
  const rom = romWith([at(0x0800_1000, twice.bytes), at(0x0800_2000, twice.bytes), at(0x0800_3000, thrice.bytes), at(0x0800_4000, thrice.bytes), at(0x0800_5000, thrice.bytes)]);
  const alone = run(rom, [signatureFile('lib', { id: '1', members: [twice, thrice] })]);
  assert.deepEqual(alone.diagnostics.map((d) => [d.code, d.message]), [
    ['W_SIGNATURE_AMBIGUOUS', 'lib@1: 2 members fit at several places and no neighbour settles them: Twice (2), Thrice (3); nothing of lib@1 is placed, so the ROM likely does not link it'],
  ]);
  const anchored = run(romWith([at(0x0800_1000, twice.bytes), at(0x0800_2000, twice.bytes), at(0x0800_6000, placedFn.bytes)]), [signatureFile('lib', { id: '1', members: [twice, placedFn], linkOrder: [] })]);
  assert.deepEqual(anchored.diagnostics.map((d) => d.message), ['lib@1: Twice fits at 2 places and no neighbour settles it']);
});

test('sig.unique-fit: fewer than minUnmaskedBytes, or no anchor word, is never searched alone', () => {
  const short = big('Short', 2, 8);
  const masked: FunctionSpec = { name: 'Masked', bytes: distinct(3, 32), masked: [1, 5, 9, 13, 17, 21, 25, 29] };
  const rom = romWith([at(0x0800_1000, short.bytes), at(0x0800_2000, masked.bytes)]);
  assert.deepEqual(run(rom, [signatureFile('lib', { id: '1', members: [short, masked], linkOrder: [] })]).placements, []);
});

test('the scan: a function is a candidate only inside the code range; a table anywhere; ARM only on a word', () => {
  const fn = big('Far', 4);
  const table: TableSpec = { kind: 'table', name: 'gTable', bytes: distinct(5, 16) };
  const armFn: FunctionSpec = { name: 'ArmFn', mode: 'arm', bytes: arm`mov r0, #1; add r0, r0, #2; mov r1, #3; bx lr` };
  const rom = romWith([at(0x0802_0000, fn.bytes), at(0x0802_1000, table.bytes), at(0x0800_3002, armFn.bytes)], { size: 0x2_2000 });
  const m = run(rom, [signatureFile('lib', { id: '1', members: [fn, table, armFn] })]);
  assert.deepEqual(placed(m), ['gTable sig.unique-fit 0x8021000']);
});

test('the scan: candidates stop at policy.candidateCap', () => {
  const fn = big('Many', 6, 16);
  const rom = romWith([0, 1, 2, 3, 4].map((i) => at(0x0800_1000 + 0x100 * i, fn.bytes)));
  const m = run(rom, [signatureFile('lib', { id: '1', members: [fn] })], { ...SIGNATURE_POLICY, candidateCap: 3 });
  assert.equal(m.diagnostics[0]?.message, 'lib@1: Many fits at 3 or more places and no neighbour settles it; nothing of lib@1 is placed, so the ROM likely does not link it');
});

test('sig.link-order-run: members contiguous in link order and on the ROM are placed as a run', () => {
  const [a, b, c] = [stub(1), stub(2), stub(3)];
  const run3 = concat(a.bytes, b.bytes, c.bytes);
  const rom = romWith([at(0x0800_1000, a.bytes), at(0x0800_1100, b.bytes), at(0x0800_1200, c.bytes), at(0x0800_1300, a.bytes), at(0x0800_2000, run3)]);
  const file = signatureFile('lib', { id: '1', members: [a, b, c] });
  assert.deepEqual(placed(run(rom, [file])), ['Swi1 sig.link-order-run 0x8002000', 'Swi2 sig.link-order-run 0x8002004', 'Swi3 sig.link-order-run 0x8002008']);
  assert.deepEqual(run(rom, [file], without('sig.link-order-run')).placements, []);
});

test('sig.link-order-run: a run below minUnmaskedBytes is not taken', () => {
  const [a, b] = [stub(1), stub(2)];
  const rom = romWith([at(0x0800_2000, new Uint8Array([...a.bytes, ...b.bytes]))]);
  assert.deepEqual(run(rom, [signatureFile('lib', { id: '1', members: [a, b] })]).placements, []);
});

test('sig.link-order-run: the longest run wins over a shorter one found first', () => {
  const [a, b, c, d, e] = [stub(1), stub(2), stub(3), stub(4), stub(5)];
  // a b c at 0x2000 (12 unmasked bytes, the run of the first link) and b c d e at 0x3000 (16) share b and c: the longer
  // run is taken, and the shorter one is refused because b is now placed elsewhere.
  const rom = romWith([at(0x0800_2000, concat(a.bytes, b.bytes, c.bytes)), at(0x0800_3000, concat(b.bytes, c.bytes, d.bytes, e.bytes))]);
  const m = run(rom, [signatureFile('lib', { id: '1', members: [a, b, c, d, e] })]);
  assert.deepEqual(placed(m), ['Swi2 sig.link-order-run 0x8003000', 'Swi3 sig.link-order-run 0x8003004', 'Swi4 sig.link-order-run 0x8003008', 'Swi5 sig.link-order-run 0x800300c']);
});

test('sig.link-order-run: an object is linked whole, so a run never skips a link of the object before or after the gap', () => {
  // Two 16-byte wrappers with the same code and a long member, all of one object in this order: on the ROM the
  // wrapper right before Long is Second, never First reached by skipping Second.
  const wrapper = (name: string): FunctionSpec => ({ name, bytes: thumb`push {lr}; movs r0, #4; lsls r0, r0, #8; adds r0, #1; movs r1, #9; adds r0, r0, r1; pop {r0}; bx r0` });
  const [first, second] = [wrapper('First'), wrapper('Second')];
  const long = big('Long', 30, 64);
  const rom = romWith([at(0x0800_1000, first.bytes), at(0x0800_2000, concat(second.bytes, long.bytes))]);
  const m = run(rom, [signatureFile('lib', { id: '1', members: [first, second, long] })]);
  assert.deepEqual(placed(m), ['Second sig.link-order-run 0x8002000', 'Long sig.unique-fit 0x8002010']);
});

test('sig.link-order-run: across an object border the next member may start at the next word', () => {
  // Mod (6 bytes) ends its object off a word; the next object starts on the word after the linker's padding.
  const mod: FunctionSpec = { name: 'Mod', object: 'mod', bytes: thumb`swi #6; movs r0, r1; bx lr` };
  const next: FunctionSpec = { name: 'Next', object: 'next', bytes: thumb`movs r0, #1; movs r1, #2; adds r0, r0, r1; bx lr` };
  const rom = romWith([at(0x0800_2000, concat(mod.bytes, new Uint8Array(2), next.bytes))]);
  const linkOrder = [{ reference: 'ref', members: [{ name: 'Mod', addr: 0x0810_0000 }, { name: 'Next', addr: 0x0810_0008 }] }];
  assert.deepEqual(placed(run(rom, [signatureFile('lib', { id: '1', members: [mod, next], linkOrder })])), ['Mod sig.link-order-run 0x8002000', 'Next sig.link-order-run 0x8002008']);
  const oneObject = [{ ...mod, object: 'one' }, { ...next, object: 'one' }];
  assert.deepEqual(placed(run(rom, [signatureFile('lib', { id: '1', members: oneObject, linkOrder })])), [], 'inside one object the run stops at the gap');
});

test('sig.link-order-run: the runs of every chain are weighed together, and no member lands on bytes another holds', () => {
  // Reference one links S1 S2 Mod; reference two links S1 S2 DivRem S3 S4, where DivRem is Mod's code and its
  // padding. On a ROM laid out as reference two, two's longer run wins although one's chain comes first, and Mod,
  // which fits at DivRem's address, is not placed over it.
  const s1 = stub(1);
  const s2 = stub(2);
  const s3 = stub(3);
  const s4 = stub(4);
  const mod: FunctionSpec = { name: 'Mod', object: 'mod', bytes: thumb`swi #6; movs r0, r1; bx lr` };
  const divRem: FunctionSpec = { name: 'DivRem', object: 'gba', bytes: concat(mod.bytes, new Uint8Array(2)) };
  const gba = [s1, s2, s3, s4].map((m) => ({ ...m, object: 'gba' }));
  const [g1, g2, g3, g4] = gba;
  assert.ok(g1 !== undefined && g2 !== undefined && g3 !== undefined && g4 !== undefined);
  const rom = romWith([at(0x0800_2000, concat(g1.bytes, g2.bytes, divRem.bytes, g3.bytes, g4.bytes))]);
  const linkOrder = [contiguous('one', [g1, g2, mod]), contiguous('two', [g1, g2, divRem, g3, g4], 0x0820_0000)];
  const m = run(rom, [signatureFile('lib', { id: '1', members: [g1, g2, mod, divRem, g3, g4], linkOrder })]);
  assert.deepEqual(placed(m), ['Swi1 sig.link-order-run 0x8002000', 'Swi2 sig.link-order-run 0x8002004', 'DivRem sig.link-order-run 0x8002008', 'Swi3 sig.link-order-run 0x8002010', 'Swi4 sig.link-order-run 0x8002014']);
});

test('sig.unique-fit: a member is never placed over the bytes of a larger member placed before it', () => {
  const whole = big('Whole', 31, 48);
  const tail: FunctionSpec = { name: 'Tail', bytes: whole.bytes.slice(16) };
  const rom = romWith([at(0x0800_1000, whole.bytes)]);
  const linkOrder = [{ reference: 'ref', members: [{ name: 'Whole', addr: 0x0810_0000 }] }, { reference: 'other', members: [{ name: 'Tail', addr: 0x0820_0000 }] }];
  assert.deepEqual(placed(run(rom, [signatureFile('lib', { id: '1', members: [whole, tail], linkOrder })])), ['Whole sig.unique-fit 0x8001000']);
});

test('sig.neighbour-spacing: the reference spacing from a placed neighbour', () => {
  const f = big('Anchor', 7);
  const s = stub(5);
  const rom = romWith([at(0x0800_1000, f.bytes), at(0x0800_1028, s.bytes), at(0x0800_3000, s.bytes), at(0x0800_3100, s.bytes)]);
  const file = signatureFile('lib', { id: '1', members: [f, s], linkOrder: [contiguous('ref', [f, s], 0x0810_0000, { Swi5: 8 })] });
  assert.deepEqual(placed(run(rom, [file])), ['Anchor sig.unique-fit 0x8001000', 'Swi5 sig.neighbour-spacing 0x8001028']);
  // Without it, the short member's window still finds it (the only candidate near the placed library), as the weaker rule.
  assert.deepEqual(placed(run(rom, [file], without('sig.neighbour-spacing'))), ['Anchor sig.unique-fit 0x8001000', 'Swi5 sig.short-member-window 0x8001028']);
});

test('sig.neighbour-spacing: right after a placed neighbour, for a member with no anchor word to search by', () => {
  const f = big('Anchor', 8);
  const s: FunctionSpec = { name: 'Tail', bytes: thumb`movs r0, #1; bx lr`, masked: [1] };
  const rom = romWith([at(0x0800_1000, new Uint8Array([...f.bytes, ...s.bytes]))]);
  const file = signatureFile('lib', { id: '1', members: [f, s], linkOrder: [contiguous('ref', [f, s], 0x0810_0000, { Tail: 16 })] });
  assert.deepEqual(placed(run(rom, [file])), ['Anchor sig.unique-fit 0x8001000', 'Tail sig.neighbour-spacing 0x8001020']);
  assert.deepEqual(placed(run(rom, [file], without('sig.neighbour-spacing'))), ['Anchor sig.unique-fit 0x8001000']);
});

test('sig.neighbour-spacing: the only candidate within the window of a neighbour', () => {
  const f = big('Anchor', 9);
  const s = stub(6);
  const g = big('Other', 10);
  // Reference: Anchor, 8 bytes, Swi6, then Other far away; ROM: Swi6 16 bytes after Anchor and again far beyond.
  const rom = romWith([at(0x0800_1000, f.bytes), at(0x0800_1030, s.bytes), at(0x0800_1400, g.bytes), at(0x0800_1200, s.bytes)]);
  const file = signatureFile('lib', { id: '1', members: [f, s, g], linkOrder: [contiguous('ref', [f, s, g], 0x0810_0000, { Swi6: 8, Other: 0x1000 })] });
  assert.deepEqual(placed(run(rom, [file])), ['Anchor sig.unique-fit 0x8001000', 'Swi6 sig.neighbour-spacing 0x8001030', 'Other sig.unique-fit 0x8001400']);
});

test('sig.pinned-both-sides: both neighbours pin a member that differs in one word, reported as a game constant', () => {
  const a = big('Before', 11);
  const mid = big('Configured', 12, 40);
  const b = big('After', 13);
  const rom = romWith([at(0x0800_1000, new Uint8Array([...a.bytes, ...withWord(mid.bytes, 8, 0x1234_5678), ...b.bytes]))]);
  const file = signatureFile('lib', { id: '1', members: [a, mid, b] });
  const m = run(rom, [file]);
  assert.deepEqual(placed(m), ['Before sig.unique-fit 0x8001000', 'Configured sig.pinned-both-sides 0x8001020', 'After sig.unique-fit 0x8001048']);
  const reference = new DataView(mid.bytes.buffer, mid.bytes.byteOffset).getUint32(8, true);
  assert.deepEqual(m.placements[1]?.constants, [{ offset: 8, reference, rom: 0x1234_5678 }]);
  assert.deepEqual(
    m.diagnostics.map((d) => [d.code, d.addr, d.rule]),
    [['W_SIGNATURE_CONSTANT', 0x0800_1020, 'sig.pinned-both-sides']],
  );
  assert.match(m.diagnostics[0]?.message ?? '', /^lib@1: Configured differs from the reference in game constants: \+0x8 0x[0-9A-F]{8} -> 0x12345678$/);
  assert.deepEqual(placed(run(rom, [file], without('sig.pinned-both-sides'))), ['Before sig.unique-fit 0x8001000', 'After sig.unique-fit 0x8001048']);
});

test('sig.pinned-both-sides: more than maxDiffWords words, or a member below pinnedMinBytes, is not pinned', () => {
  const a = big('Before', 14);
  const mid = big('Configured', 15, 40);
  const small = big('Small', 16, 28);
  const b = big('After', 17);
  const three = withWord(withWord(withWord(mid.bytes, 0, 1), 8, 2), 16, 3);
  const romMany = romWith([at(0x0800_1000, new Uint8Array([...a.bytes, ...three, ...b.bytes]))]);
  assert.deepEqual(placed(run(romMany, [signatureFile('lib', { id: '1', members: [a, mid, b] })])), ['Before sig.unique-fit 0x8001000', 'After sig.unique-fit 0x8001048']);
  const romSmall = romWith([at(0x0800_1000, new Uint8Array([...a.bytes, ...withWord(small.bytes, 4, 9), ...b.bytes]))]);
  assert.deepEqual(placed(run(romSmall, [signatureFile('lib', { id: '1', members: [a, small, b] })])), ['Before sig.unique-fit 0x8001000', 'After sig.unique-fit 0x800103c']);
});

test('sig.short-member-window: a member another reference contributed, at its only fit near the placed library', () => {
  const f1 = big('First', 18);
  const f2 = big('Second', 19);
  const s = stub(9);
  const rom = romWith([at(0x0800_1000, new Uint8Array([...f1.bytes, ...f2.bytes])), at(0x0800_1050, s.bytes), at(0x0800_3000, s.bytes)]);
  const linkOrder = [contiguous('one', [f1, f2]), { reference: 'two', members: [{ name: 'Swi9', addr: 0x0820_0000 }] }];
  const file = signatureFile('lib', { id: '1', members: [f1, f2, s], linkOrder });
  assert.deepEqual(placed(run(rom, [file])), ['First sig.unique-fit 0x8001000', 'Second sig.unique-fit 0x8001020', 'Swi9 sig.short-member-window 0x8001050']);
  assert.deepEqual(placed(run(rom, [file], without('sig.short-member-window'))), ['First sig.unique-fit 0x8001000', 'Second sig.unique-fit 0x8001020']);
});

test('sig.short-member-window: two fits within the window settle nothing', () => {
  const f1 = big('First', 20);
  const s = stub(9);
  const rom = romWith([at(0x0800_1000, f1.bytes), at(0x0800_1030, s.bytes), at(0x0800_1040, s.bytes)]);
  const linkOrder = [contiguous('one', [f1]), { reference: 'two', members: [{ name: 'Swi9', addr: 0x0820_0000 }] }];
  const m = run(rom, [signatureFile('lib', { id: '1', members: [f1, s], linkOrder })]);
  assert.deepEqual(placed(m), ['First sig.unique-fit 0x8001000']);
  assert.deepEqual(m.diagnostics.map((d) => d.code), ['W_SIGNATURE_AMBIGUOUS']);
});

/** A 16-byte table whose first word points at `target` (masked, as the builder masks addresses) and that names it. */
function pointerTable(name: string, target: string, seed: number): TableSpec {
  return { kind: 'table', name, bytes: new Uint8Array([0, 0, 0, 0, ...distinct(seed, 12)]), masked: [0, 1, 2, 3], names: [target, null, null, null] };
}

function tableRom(fn: MemberSpec, fnAt: number, table: TableSpec, word: number): Rom {
  return romWith([at(fnAt, fn.bytes), at(0x0800_4000, withWord(table.bytes, 0, word))]);
}

test('a pointer table is placed when its words name the placed functions, with the Thumb bit', () => {
  const fn = big('Handler', 21);
  const table = pointerTable('gHandlers', 'Handler', 22);
  const file = signatureFile('lib', { id: '1', members: [fn, table] });
  const m = run(tableRom(fn, 0x0800_1000, table, 0x0800_1001), [file]);
  assert.deepEqual(placed(m), ['Handler sig.unique-fit 0x8001000', 'gHandlers sig.unique-fit 0x8004000']);
  assert.deepEqual(m.pointerTables, [{ library: 'lib', version: '1', member: idOf('gHandlers') }]);
});

test('a pointer table whose word names another address is refused: W_SIGNATURE_POINTERS', () => {
  const fn = big('Handler', 21);
  const table = pointerTable('gHandlers', 'Handler', 22);
  const file = signatureFile('lib', { id: '1', members: [fn, table] });
  for (const word of [0x0800_1000, 0x0800_1005]) {
    const m = run(tableRom(fn, 0x0800_1000, table, word), [file]);
    assert.deepEqual(placed(m), ['Handler sig.unique-fit 0x8001000'], `word 0x${word.toString(16)}`);
    assert.deepEqual(m.pointerTables, []);
    assert.deepEqual(m.diagnostics.map((d) => [d.code, d.addr]), [['W_SIGNATURE_POINTERS', 0x0800_4000]]);
  }
});

test('a table whose every byte is masked is placed by its neighbours only where a pointer proves it', () => {
  const fn = big('Handler', 32);
  const head: TableSpec = { kind: 'table', name: 'gHead', bytes: distinct(33, 16) };
  const masked = (names?: readonly (string | null)[]): TableSpec => ({ kind: 'table', name: 'gPointers', bytes: new Uint8Array(8), masked: [0, 1, 2, 3, 4, 5, 6, 7], ...(names === undefined ? {} : { names }) });
  const rom = (word: number): Rom => romWith([at(0x0800_1000, fn.bytes), at(0x0800_4000, concat(head.bytes, wordBytes(word, 0x0800_9000)))]);
  const file = (t: TableSpec): SignatureFile => signatureFile('lib', { id: '1', members: [fn, head, t], linkOrder: [contiguous('ref', [fn]), contiguous('ref', [head, t], 0x0830_0000)] });
  assert.deepEqual(placed(run(rom(0x0800_1001), [file(masked())])), ['Handler sig.unique-fit 0x8001000', 'gHead sig.unique-fit 0x8004000'], 'no pointer: fitting anywhere proves nothing');
  assert.deepEqual(placed(run(rom(0x0800_1001), [file(masked(['Handler', null]))])), ['Handler sig.unique-fit 0x8001000', 'gHead sig.unique-fit 0x8004000', 'gPointers sig.neighbour-spacing 0x8004010']);
  assert.deepEqual(placed(run(rom(0x0800_1101), [file(masked(['Handler', null]))])), ['Handler sig.unique-fit 0x8001000', 'gHead sig.unique-fit 0x8004000'], 'a pointer that names another address');
});

test('a pointer to an ARM function carries no Thumb bit', () => {
  const fn: FunctionSpec = { name: 'ArmHandler', mode: 'arm', bytes: distinct(23, 32) };
  const table = pointerTable('gArm', 'ArmHandler', 24);
  const file = signatureFile('lib', { id: '1', members: [fn, table] });
  assert.deepEqual(placed(run(tableRom(fn, 0x0800_1000, table, 0x0800_1000), [file])), ['ArmHandler sig.unique-fit 0x8001000', 'gArm sig.unique-fit 0x8004000']);
  assert.deepEqual(placed(run(tableRom(fn, 0x0800_1000, table, 0x0800_1001), [file])), ['ArmHandler sig.unique-fit 0x8001000']);
});
