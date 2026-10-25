// proposeFromSignatures (architecture §7.3, D9): a function placement proposes its entry and name, with `size` only
// when the signature's extent is larger than the analysis function at that entry (it restores an extent the analysis
// split); a table proposes a symbol typed 'pointers' when its words name members, else 'bytes'; each with the
// signature source, sorted by address.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { proposeFromSignatures } from '../../../../src/core/signatures/propose.ts';
import type { SignaturePlacement } from '../../../../src/core/signatures/schema.ts';
import { analysisOf, factAt, idOf } from '../../../helpers/signatures.ts';

function fn(name: string, addr: number, size: number, mode: 'thumb' | 'arm' = 'thumb'): SignaturePlacement {
  return { library: 'libgcc', version: 'agbcc', member: idOf(name), name, kind: 'function', addr, size, mode, rule: 'sig.link-order-run' };
}

function table(name: string, addr: number, size: number): SignaturePlacement {
  return { library: 'm4a', version: '2001', member: idOf(name), name, kind: 'table', addr, size, rule: 'sig.unique-fit' };
}

test('a function proposes its size only where the signature restores an extent the analysis split', () => {
  const analysis = analysisOf([factAt(0x0800_1000, 0x0800_1020), factAt(0x0800_1020, 0x0800_1040), factAt(0x0800_2000, 0x0800_2040), factAt(0x0800_3000, 0x0800_3080, 'arm')]);
  const placements = [fn('Split', 0x0800_1000, 0x40), fn('Whole', 0x0800_2000, 0x40), fn('Shorter', 0x0800_3000, 0x40, 'arm'), fn('New', 0x0800_4000, 0x10)];
  assert.deepEqual(proposeFromSignatures({ placements, pointerTables: [] }, analysis), [
    { kind: 'function', addr: 0x0800_1000, mode: 'thumb', name: 'Split', size: 0x40, source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.link-order-run' } },
    { kind: 'function', addr: 0x0800_2000, mode: 'thumb', name: 'Whole', source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.link-order-run' } },
    { kind: 'function', addr: 0x0800_3000, mode: 'arm', name: 'Shorter', source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.link-order-run' } },
    { kind: 'function', addr: 0x0800_4000, mode: 'thumb', name: 'New', source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.link-order-run' } },
  ]);
});

test("a table proposes a symbol: 'pointers' when its words name members, else 'bytes'; sorted by address", () => {
  const placements = [table('gPlain', 0x0810_0100, 12), table('gJumps', 0x0810_0000, 0x90), fn('First', 0x0800_0400, 8)];
  const out = proposeFromSignatures({ placements, pointerTables: [{ library: 'm4a', version: '2001', member: idOf('gJumps') }] }, analysisOf([]));
  assert.deepEqual(out, [
    { kind: 'function', addr: 0x0800_0400, mode: 'thumb', name: 'First', source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.link-order-run' } },
    { kind: 'symbol', addr: 0x0810_0000, name: 'gJumps', size: 0x90, type: 'pointers', source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' } },
    { kind: 'symbol', addr: 0x0810_0100, name: 'gPlain', size: 12, type: 'bytes', source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' } },
  ]);
});
