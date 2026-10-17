import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parityDigest, parseParityView, parsePocDigests, PARITY_SCHEMA, type ParityView } from '../../../bench/src/parity-view.ts';
import {
  checkCommittedDigest,
  deterministicDigest,
  isExportMode,
  parityFromChild,
  pocDigestsDocument,
  pocDigestsText,
  queriesFromChild,
} from '../../../bench/tools/export-poc.ts';

const SOURCE = 'a'.repeat(64);
const OTHER_SOURCE = 'b'.repeat(64);

function rawView(codeEnd = 0x0800_0010): Record<string, unknown> {
  return {
    schema: PARITY_SCHEMA,
    functions: [{ entry: 0x0800_0000, mode: 'arm', end: codeEnd, codeEnd, code: [[0x0800_0000, codeEnd]], pools: [], tables: [], far: [], noreturn: [], origin: 'rom-entry' }],
    claims: [[0x0800_0000, codeEnd, 1]],
    startup: { end: codeEnd, entries: [0x0800_0000] },
    codeEnd,
  };
}

const view = (codeEnd?: number): ParityView => parseParityView(rawView(codeEnd), 'v');

test('export-poc accepts the three modes only', () => {
  assert.ok(isExportMode('scored') && isExportMode('parity') && isExportMode('queries'));
  assert.ok(!isExportMode('all') && !isExportMode(undefined));
});

test('a deterministic pair yields its parity digest; a nondeterministic pair is refused with the difference', () => {
  assert.equal(deterministicDigest('tiny', view(), view()), parityDigest(view()));
  assert.throws(() => deterministicDigest('tiny', view(), view(0x0800_0014)), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^tiny: the PoC is not deterministic: two runs have parity digests [0-9a-f]{64} and [0-9a-f]{64}/);
    assert.match(error.message, /codeEnd: expected 134217744, got 134217748/);
    assert.match(error.message, /nothing written$/);
    return true;
  });
});

test('the digests file: schema, the pinned PoC, ROM keys sorted, every key sorted when written', () => {
  const doc = pocDigestsDocument(SOURCE, { sa2: 'c'.repeat(64), klonoa: 'd'.repeat(64) });
  assert.equal(doc.schema, 'romlift-bench/poc-digests@1');
  assert.equal(doc.pocSourceDigest, SOURCE);
  assert.deepEqual(Object.keys(doc.roms), ['klonoa', 'sa2']);
  const text = pocDigestsText(doc);
  assert.equal(
    text,
    `{\n  "pocSourceDigest": "${SOURCE}",\n  "roms": {\n    "klonoa": "${'d'.repeat(64)}",\n    "sa2": "${'c'.repeat(64)}"\n  },\n  "schema": "romlift-bench/poc-digests@1"\n}\n`,
  );
  assert.deepEqual(parsePocDigests(JSON.parse(text) as unknown, 'd'), doc);
});

test('an --only run keeps the other ROMs of the same PoC checkout and drops those of another', () => {
  const previous = pocDigestsDocument(SOURCE, { klonoa: 'd'.repeat(64), sa2: 'c'.repeat(64) });
  assert.deepEqual(pocDigestsDocument(SOURCE, { sa2: 'e'.repeat(64) }, previous).roms, { klonoa: 'd'.repeat(64), sa2: 'e'.repeat(64) });
  assert.deepEqual(pocDigestsDocument(OTHER_SOURCE, { sa2: 'e'.repeat(64) }, previous).roms, { sa2: 'e'.repeat(64) });
  assert.throws(() => pocDigestsDocument(SOURCE, { sa2: 'not a digest' }), /poc-digests\.roms\.sa2/);
});

test("the child's parity and queries documents are validated", () => {
  const run = parityFromChild({ parity: rawView(), seconds: 1.5 }, 'tiny');
  assert.equal(run.view.codeEnd, 0x0800_0010);
  assert.equal(run.seconds, 1.5);
  assert.throws(() => parityFromChild({ parity: { ...rawView(), schema: 'x' }, seconds: 1 }, 'tiny'), /tiny: parity\.schema/);
  assert.throws(() => parityFromChild({ parity: rawView() }, 'tiny'), /tiny: seconds/);
  assert.throws(() => parityFromChild([], 'tiny'), /printed no \{parity, seconds\}/);
  const queries = queriesFromChild({ parity: rawView(), seconds: 2, queries: 10, readings: 3, queryBytes: 100, readingBytes: 50 }, 'tiny');
  assert.deepEqual([queries.queries, queries.readings, queries.queryBytes, queries.readingBytes], [10, 3, 100, 50]);
  assert.throws(() => queriesFromChild({ parity: rawView(), seconds: 2, queries: -1, readings: 3, queryBytes: 1, readingBytes: 1 }, 'tiny'), /tiny: queries/);
});

test('a queries run is refused unless its parity digest is the committed one', () => {
  const digest = parityDigest(view());
  const committed = pocDigestsDocument(SOURCE, { tiny: digest });
  assert.doesNotThrow(() => checkCommittedDigest('tiny', digest, committed, SOURCE));
  assert.throws(() => checkCommittedDigest('tiny', parityDigest(view(0x0800_0014)), committed, SOURCE), /tiny: the instrumented run has parity digest/);
  assert.throws(() => checkCommittedDigest('sa2', digest, committed, SOURCE), /sa2: .* has no digest for it; run --mode parity first/);
  assert.throws(() => checkCommittedDigest('tiny', digest, committed, OTHER_SOURCE), /pins another PoC checkout/);
});
