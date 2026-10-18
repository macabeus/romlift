// The journal (architecture §6.4, D17): derived from a plan's ops (a keep changes nothing and is left out),
// encoded canonically in plan order, and read back strictly.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeJournal, encodeJournal, journalOf } from '../../../src/core/write-plan/journal.ts';
import type { Journal } from '../../../src/core/write-plan/journal.ts';
import type { WriteOp } from '../../../src/core/write-plan/types.ts';

const S1 = '1111111111111111111111111111111111111111';
const S2 = '2222222222222222222222222222222222222222';

const OPS: readonly WriteOp[] = [
  { op: 'write', path: 'asm/main.s', text: '.include "x"\n', sha1: S1, writer: 'module' },
  { op: 'keep', path: 'asm/crt0.s', sha1: S2 },
  { op: 'edit', path: 'src/main.c', baseSha1: S1, resultSha1: S2, text: 'int x;\n' },
  { op: 'delete', path: 'asm/nonmatchings/main/Gone.s' },
];

test('journalOf keeps every op that changes a file, in plan order', () => {
  assert.deepEqual(journalOf(OPS), {
    schema: 1,
    ops: [
      { op: 'write', path: 'asm/main.s', resultSha1: S1 },
      { op: 'edit', path: 'src/main.c', baseSha1: S1, resultSha1: S2 },
      { op: 'delete', path: 'asm/nonmatchings/main/Gone.s' },
    ],
  });
});

test('a journal encodes canonically, keeps its op order, and decodes to itself', () => {
  const journal = journalOf(OPS);
  const text = [...encodeJournal(journal)].join('');
  assert.ok(text.endsWith('\n'));
  assert.ok(text.indexOf('asm/main.s') < text.indexOf('src/main.c') && text.indexOf('src/main.c') < text.indexOf('Gone.s'));
  assert.deepEqual(decodeJournal(text), { ok: true, journal });
  const empty: Journal = { schema: 1, ops: [] };
  assert.deepEqual(decodeJournal([...encodeJournal(empty)].join('')), { ok: true, journal: empty });
});

test('a malformed journal is an error value', () => {
  const bad: readonly [string, RegExp][] = [
    ['{', /not JSON/],
    ['{"schema":1}', /ops is not an array/],
    ['{"schema":0,"ops":[]}', /schema 0/],
    ['{"schema":1,"ops":[],"x":1}', /unknown member "x"/],
    ['{"schema":1,"ops":[1]}', /ops\[0\] is not an object/],
    ['{"schema":1,"ops":[{"op":"keep","path":"a"}]}', /is not write, edit or delete/],
    [`{"schema":1,"ops":[{"op":"write","path":"../a","resultSha1":"${S1}"}]}`, /not a project path/],
    ['{"schema":1,"ops":[{"op":"write","path":"a"}]}', /a write carries resultSha1 only/],
    [`{"schema":1,"ops":[{"op":"edit","path":"a","resultSha1":"${S1}"}]}`, /an edit carries baseSha1 and resultSha1/],
    [`{"schema":1,"ops":[{"op":"delete","path":"a","baseSha1":"${S1}"}]}`, /a delete carries no sha1/],
    ['{"schema":1,"ops":[{"op":"write","path":"a","resultSha1":"xyz"}]}', /resultSha1 is not/],
    [`{"schema":1,"ops":[{"op":"delete","path":"a","why":1}]}`, /unknown member "why"/],
  ];
  for (const [input, message] of bad) {
    const result = decodeJournal(input);
    assert.equal(result.ok, false, input);
    if (!result.ok) assert.match(result.error, message, input);
  }
});
