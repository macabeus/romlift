// resolvePlacements (architecture §7.2, roadmap 6.B): overlaps between versions (the version that placed more takes
// the bytes, ties by `library@version` in code-unit order, never the locale), regions (one library and kind within
// policy.moduleNear bytes, named by the version that placed most there), interleaving regions (the smaller yields),
// W_SIGNATURE_DROPPED with its counts, and the matcher's W_SIGNATURE_CONSTANT kept only for kept placements.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { constantDiagnostic } from '../../../../src/core/signatures/match.ts';
import type { SignatureMatch } from '../../../../src/core/signatures/match.ts';
import { resolvePlacements } from '../../../../src/core/signatures/resolve.ts';
import type { SignaturePlacement } from '../../../../src/core/signatures/schema.ts';
import { romWith } from '../../../helpers/analysis.ts';
import { idOf } from '../../../helpers/signatures.ts';

const ROM = romWith([], { size: 0x8000 });

function pl(library: string, version: string, name: string, addr: number, size = 16, extra: Partial<SignaturePlacement> = {}): SignaturePlacement {
  return { library, version, member: idOf(name), name, kind: 'function', addr, size, mode: 'thumb', rule: 'sig.unique-fit', ...extra };
}

function matched(placements: readonly SignaturePlacement[], extra: Partial<SignatureMatch> = {}): SignatureMatch {
  return { placements, pointerTables: [], diagnostics: [], ...extra };
}

const names = (ps: readonly SignaturePlacement[]): string[] => ps.map((p) => `${p.library}@${p.version} ${p.name}`);

test('a version of a library whose every placement another version of it took is dropped without a warning (final-review clean-clone-6)', () => {
  const r = resolvePlacements(ROM, matched([pl('a', '1', 'A1', 0x0800_1000), pl('a', '1', 'A2', 0x0800_1010), pl('a', '2', 'A1', 0x0800_1000)]));
  assert.deepEqual(names(r.placements), ['a@1 A1', 'a@1 A2']);
  assert.deepEqual(r.diagnostics, [], 'a@2 lost wholly to a@1: the ROM links a@1');
  const other = resolvePlacements(ROM, matched([pl('a', '1', 'A1', 0x0800_1000), pl('a', '1', 'A2', 0x0800_1010), pl('b', '1', 'B1', 0x0800_1000)]));
  assert.deepEqual(other.diagnostics.map((d) => d.message), ['b@1: 1 of its 1 placements overlap a version that placed more; dropped'], 'another library is still reported');
});

test('a placement overlapping a version that placed more is dropped, with counts', () => {
  const r = resolvePlacements(ROM, matched([pl('a', '1', 'A1', 0x0800_1000), pl('a', '1', 'A2', 0x0800_1010), pl('a', '1', 'A3', 0x0800_1020), pl('b', '1', 'B1', 0x0800_1018), pl('b', '1', 'B2', 0x0800_5000)]));
  assert.deepEqual(names(r.placements), ['a@1 A1', 'a@1 A2', 'a@1 A3', 'b@1 B2']);
  assert.deepEqual(r.diagnostics.map((d) => [d.code, d.message]), [['W_SIGNATURE_DROPPED', 'b@1: 1 of its 2 placements overlap a version that placed more; dropped']]);
  assert.deepEqual(r.regions, [
    { span: { start: 0x0800_1000, end: 0x0800_1030 }, library: 'a', version: '1' },
    { span: { start: 0x0800_5000, end: 0x0800_5010 }, library: 'b', version: '1' },
  ]);
});

test('ties go to library@version in code-unit order, not the locale', () => {
  // 'Z' (0x5A) sorts before 'a' (0x61) by code unit; localeCompare would put 'alib' first.
  const r = resolvePlacements(ROM, matched([pl('alib', '1', 'A', 0x0800_1000), pl('Zlib', '1', 'Z', 0x0800_1008)]));
  assert.deepEqual(names(r.placements), ['Zlib@1 Z']);
  assert.match(r.diagnostics[0]?.message ?? '', /^alib@1: 1 of its 1 placements overlap/);
  const versions = resolvePlacements(ROM, matched([pl('m4a', '2004', 'Late', 0x0800_1000), pl('m4a', '2001', 'Early', 0x0800_1000)]));
  assert.deepEqual(names(versions.placements), ['m4a@2001 Early']);
});

test('interleaving regions: the one with fewer placements yields', () => {
  const r = resolvePlacements(ROM, matched([pl('x', '1', 'X1', 0x0800_1000), pl('x', '1', 'X2', 0x0800_1080), pl('x', '1', 'X3', 0x0800_1100), pl('y', '1', 'Y1', 0x0800_1040)]));
  assert.deepEqual(names(r.placements), ['x@1 X1', 'x@1 X2', 'x@1 X3']);
  assert.deepEqual(r.regions, [{ span: { start: 0x0800_1000, end: 0x0800_1110 }, library: 'x', version: '1' }]);
  assert.deepEqual(
    r.diagnostics.map((d) => [d.code, d.message, d.addr, d.span]),
    [['W_SIGNATURE_DROPPED', "y@1: its 1 placements from 0x08001040 interleave with x@1's 3; dropped", 0x0800_1040, { start: 0x0800_1040, end: 0x0800_1050 }]],
  );
});

test('interleaving regions of equal size: the earlier one yields', () => {
  const r = resolvePlacements(ROM, matched([pl('x', '1', 'X1', 0x0800_1000), pl('x', '1', 'X2', 0x0800_1100), pl('y', '1', 'Y1', 0x0800_1040), pl('y', '1', 'Y2', 0x0800_1120)]));
  assert.deepEqual(names(r.placements), ['y@1 Y1', 'y@1 Y2']);
});

test('regions: one library and kind within moduleNear bytes; named by the version that placed most there', () => {
  const near = resolvePlacements(ROM, matched([pl('m4a', '2001', 'A', 0x0800_1000), pl('m4a', '2001', 'B', 0x0800_1010), pl('m4a', '2004', 'C', 0x0800_1020), pl('m4a', '2001', 'D', 0x0800_1030 + 256)]));
  assert.deepEqual(near.regions, [{ span: { start: 0x0800_1000, end: 0x0800_1140 }, library: 'm4a', version: '2001' }]);
  const far = resolvePlacements(ROM, matched([pl('m4a', '2001', 'A', 0x0800_1000), pl('m4a', '2001', 'B', 0x0800_1010 + 257)]));
  assert.deepEqual(far.regions.map((r) => r.span.start), [0x0800_1000, 0x0800_1111]);
  const tie = resolvePlacements(ROM, matched([pl('m4a', '2004', 'A', 0x0800_1000), pl('m4a', '2001', 'B', 0x0800_1010)]));
  assert.deepEqual(tie.regions.map((r) => r.version), ['2001']);
  const kinds = resolvePlacements(ROM, matched([pl('m4a', '2001', 'F', 0x0800_1000), pl('m4a', '2001', 'gT', 0x0800_1010, 16, { kind: 'table', rule: 'sig.unique-fit' })]));
  assert.deepEqual(kinds.regions.map((r) => [r.span.start, r.span.end]), [[0x0800_1000, 0x0800_1010], [0x0800_1010, 0x0800_1020]]);
});

test("the matcher's game constants are kept only for kept placements; pointer tables only when kept", () => {
  const constants = [{ offset: 8, reference: 1, rom: 2 }];
  const kept = pl('a', '1', 'Kept', 0x0800_1000, 16, { rule: 'sig.pinned-both-sides', constants });
  const lost = pl('b', '1', 'Lost', 0x0800_1008, 16, { rule: 'sig.pinned-both-sides', constants });
  const table = pl('a', '1', 'gT', 0x0800_1010, 16, { kind: 'table' });
  const lostTable = pl('b', '1', 'gU', 0x0800_1014, 8, { kind: 'table' });
  const ambiguous = { code: 'W_SIGNATURE_AMBIGUOUS', severity: 'warning', message: 'c@1: M fits at 2 places and no neighbour settles it' } as const;
  const r = resolvePlacements(
    ROM,
    matched([kept, table, lost, lostTable], {
      pointerTables: [
        { library: 'a', version: '1', member: idOf('gT') },
        { library: 'b', version: '1', member: idOf('gU') },
      ],
      diagnostics: [constantDiagnostic(kept), constantDiagnostic(lost), ambiguous],
    }),
  );
  assert.deepEqual(names(r.placements), ['a@1 Kept', 'a@1 gT']);
  assert.deepEqual(r.pointerTables, [{ library: 'a', version: '1', member: idOf('gT') }]);
  assert.deepEqual(r.diagnostics.map((d) => [d.code, d.addr]), [['W_SIGNATURE_AMBIGUOUS', undefined], ['W_SIGNATURE_CONSTANT', 0x0800_1000], ['W_SIGNATURE_DROPPED', undefined]]);
});
