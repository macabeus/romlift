// Determinism (architecture §4.4, D10): the matcher, the resolver and the proposals give the same result whatever
// the order of the signature files and of the versions inside them (a seeded property test over several libraries
// whose versions claim overlapping bytes), and the same result run twice.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchSignatures } from '../../../../src/core/signatures/match.ts';
import { proposeFromSignatures } from '../../../../src/core/signatures/propose.ts';
import { resolvePlacements } from '../../../../src/core/signatures/resolve.ts';
import type { SignatureFile } from '../../../../src/core/signatures/schema.ts';
import { romWith } from '../../../helpers/analysis.ts';
import { codeRange, concat, distinct, signatureFile } from '../../../helpers/signatures.ts';
import type { FunctionSpec, TableSpec } from '../../../helpers/signatures.ts';
import { prngSequence } from '../../../helpers/prng.ts';
import { thumb } from '../../../helpers/thumb.ts';

const big = (name: string, seed: number, size = 32): FunctionSpec => ({ name, bytes: distinct(seed, size) });
const stub = (n: number): FunctionSpec => ({ name: `Swi${n}`, bytes: thumb`swi #${n}; bx lr` });

const shared = big('Shared', 1);
const a1 = [shared, big('OnlyOld', 2), stub(1), stub(2), stub(3)];
const a2 = [shared, big('OnlyNew', 3), stub(1), stub(2)];
const table: TableSpec = { kind: 'table', name: 'gTable', bytes: concat(new Uint8Array(4), distinct(4, 12)), masked: [0, 1, 2, 3], names: ['Other', null, null, null] };
const other = big('Other', 5);
const rom = romWith([
  { at: 0x0800_1000, bytes: concat(...a1.map((m) => m.bytes)) },
  { at: 0x0800_2000, bytes: concat(big('OnlyNew', 3).bytes, stub(1).bytes, stub(2).bytes) },
  { at: 0x0800_3000, bytes: other.bytes },
  { at: 0x0800_4000, bytes: concat(new Uint8Array([0x01, 0x30, 0x00, 0x08]), distinct(4, 12)) },
]);
const files: readonly SignatureFile[] = [
  signatureFile('alib', { id: '1', members: a1 }, { id: '2', members: a2 }),
  signatureFile('blib', { id: 'x', members: [other, table] }),
  // The same bytes as alib's Shared under another name: three versions claim them, alib@1 keeps them.
  signatureFile('Clib', { id: 'y', members: [{ name: 'Alias', bytes: shared.bytes }] }),
];
const analysis = codeRange(0x0800_0100, 0x0801_0000);

function everything(input: readonly SignatureFile[]): unknown {
  const matched = matchSignatures(rom, analysis, input);
  const resolved = resolvePlacements(rom, matched);
  return { matched, resolved, proposals: proposeFromSignatures(resolved, analysis) };
}

/** A seeded permutation of `items`. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const r = prngSequence(seed, out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = (r[i] ?? 0) % (i + 1);
    const [x, y] = [out[i], out[j]];
    if (x !== undefined && y !== undefined) [out[i], out[j]] = [y, x];
  }
  return out;
}

test('the fixture exercises several versions, overlaps and a pointer table', () => {
  const { matched, resolved } = everything(files) as { matched: { placements: readonly unknown[] }; resolved: { diagnostics: readonly { code: string }[]; pointerTables: readonly unknown[] } };
  assert.ok(matched.placements.length >= 8, `${matched.placements.length} placements`);
  assert.ok(resolved.diagnostics.some((d) => d.code === 'W_SIGNATURE_DROPPED'));
  assert.equal(resolved.pointerTables.length, 1);
});

test('shuffling the files and their versions changes nothing', () => {
  const base = everything(files);
  assert.deepEqual(everything(files), base, 'run twice');
  for (let seed = 1; seed <= 25; seed++) {
    const input = shuffled(files, seed).map((f, i) => ({ ...f, versions: shuffled(f.versions, seed * 31 + i + 1) }));
    assert.deepEqual(everything(input), base, `seed ${seed}`);
  }
});
