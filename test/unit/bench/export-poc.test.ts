import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parityDigest, parseParityView, parsePocDigests, PARITY_SCHEMA, type ParityView } from '../../../bench/src/parity-view.ts';
import {
  checkCommittedDigest,
  deterministicDigest,
  isExportMode,
  parityFromChild,
  pocChunkFile,
  pocChunkLines,
  pocDigestsDocument,
  pocDigestsText,
  pocRawDump,
  POC_RAW_SCHEMA,
  queriesFromChild,
  rawFromChild,
  type PocRawChunk,
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

test('export-poc accepts the four modes only', () => {
  assert.ok(isExportMode('scored') && isExportMode('parity') && isExportMode('queries') && isExportMode('raw'));
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

// ---------------------------------------------------------------- --mode raw

const FUNC: PocRawChunk = { start: 0x0800_00f4, end: 0x0800_0104, name: 'sub_080000F4', kind: 'func', mode: 'thumb', module: 'main', labels: [] };
const GAP: PocRawChunk = { start: 0x0800_0104, end: 0x0800_0106, name: 'unk_08000104', kind: 'gap', mode: 'none', module: 'main', labels: [] };
const START: PocRawChunk = { start: 0x0800_00c0, end: 0x0800_00f4, name: 'sub_080000C0', kind: 'func', mode: 'arm', module: 'crt0', labels: [] };

// The files exactly as the PoC's writeGenerated() lays them out (romlift-poc src/emit.ts, chunkLines).
const FUNC_FILE = '\tthumb_func_start sub_080000F4\nsub_080000F4: @ 080000F4\n\t.2byte 0xB500, 0x2001\nloc_080000F8: @ 080000F8, thumb entry\n\t.4byte 0x02000000\n\tthumb_func_end sub_080000F4\n';
const GAP_FILE = '@ bytes between functions: 2 bytes\n.global unk_08000104\nunk_08000104: @ 08000104\n\t.2byte 0x0000\n';
const CRT0_FILE =
  '.include "include/macros.inc"\n.syntax unified\n.text\n\n@ startup region 080000C0..080000F4: the entry\n\n\tarm_func_start sub_080000C0\nsub_080000C0: @ 080000C0\n\t.2byte 0x0012, 0xE3A0\n\tarm_func_end sub_080000C0\n\n@ bytes between functions: 4 bytes\n.global unk_080000F0\nunk_080000F0: @ 080000F0\n\t.4byte 0x080000F5\n';

test('a raw chunk lives in its module file, the startup region in asm/crt0.s', () => {
  assert.equal(pocChunkFile(FUNC), 'asm/nonmatchings/main/sub_080000F4.s');
  assert.equal(pocChunkFile(GAP), 'asm/nonmatchings/main/unk_08000104.s');
  assert.equal(pocChunkFile(START), 'asm/crt0.s');
});

test("a chunk's body is cut between its label line and its func_end, or the end of a gap", () => {
  assert.deepEqual(pocChunkLines(FUNC_FILE, FUNC), ['\t.2byte 0xB500, 0x2001', 'loc_080000F8: @ 080000F8, thumb entry', '\t.4byte 0x02000000']);
  assert.deepEqual(pocChunkLines(GAP_FILE, GAP), ['\t.2byte 0x0000']);
  assert.deepEqual(pocChunkLines(CRT0_FILE, START), ['\t.2byte 0x0012, 0xE3A0']);
  const crt0Gap: PocRawChunk = { ...GAP, start: 0x0800_00f0, end: 0x0800_00f4, name: 'unk_080000F0', module: 'crt0' };
  assert.deepEqual(pocChunkLines(CRT0_FILE, crt0Gap), ['\t.4byte 0x080000F5']);
  assert.throws(() => pocChunkLines(GAP_FILE, FUNC), /sub_080000F4: no line "sub_080000F4: @ 080000F4" in asm\/nonmatchings\/main\/sub_080000F4\.s/);
  assert.throws(() => pocChunkLines(FUNC_FILE.replace('\tthumb_func_end sub_080000F4\n', ''), FUNC), /no "thumb_func_end sub_080000F4" line/);
});

test("the child's raw document is validated: chunks, labels and claim kinds", () => {
  const doc = { summary: 's', chunks: [FUNC, { ...GAP, labels: [{ addr: 0x0800_0104, name: 'x', note: 'n' }] }], claims: [0, 1, 2, 3, 4] };
  const child = rawFromChild(doc, 'tiny');
  assert.equal(child.chunks.length, 2);
  assert.deepEqual(child.chunks[1]?.labels, [{ addr: 0x0800_0104, name: 'x', note: 'n' }]);
  assert.throws(() => rawFromChild({ ...doc, claims: [5] }, 'tiny'), /tiny: claims holds a value other than a claim kind/);
  assert.throws(() => rawFromChild({ ...doc, chunks: [GAP, FUNC] }, 'tiny'), /tiny: chunks\[1\] starts inside chunks\[0\]/);
  assert.throws(() => rawFromChild({ ...doc, chunks: [{ ...FUNC, kind: 'data' }] }, 'tiny'), /tiny: chunks\[0\]\.kind/);
  assert.throws(() => rawFromChild({ ...doc, chunks: [{ ...FUNC, end: FUNC.start }] }, 'tiny'), /not a non-empty span/);
  assert.throws(() => rawFromChild({ ...doc, chunks: [{ ...FUNC, labels: [{ addr: 1 }] }] }, 'tiny'), /tiny: chunks\[0\]\.labels\[0\]/);
  assert.throws(() => rawFromChild({ chunks: [] }, 'tiny'), /printed no \{summary, chunks, claims\}/);
});

test('raw.json carries every chunk with its body lines, the fixture SHA-1 and the PoC checkout', () => {
  const child = rawFromChild({ summary: 's', chunks: [FUNC, GAP], claims: [] }, 'tiny');
  const files: Readonly<Record<string, string>> = { [pocChunkFile(FUNC)]: FUNC_FILE, [pocChunkFile(GAP)]: GAP_FILE };
  const dump = pocRawDump('tiny', 'c'.repeat(40), SOURCE, child, (file) => files[file] ?? '');
  assert.equal(dump.schema, POC_RAW_SCHEMA);
  assert.deepEqual([dump.fixture, dump.sha1, dump.pocSourceDigest], ['tiny', 'c'.repeat(40), SOURCE]);
  assert.deepEqual(
    dump.chunks.map((c) => c.lines.length),
    [3, 1],
  );
});
