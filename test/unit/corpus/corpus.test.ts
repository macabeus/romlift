// The corpus core without a toolchain: what it generates, where it puts labels, and how the
// comparator judges assembled bytes (hand-made here; test/corpus/generate.ts feeds it real `as`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { corpusOk } from '../../../src/foundation/corpus/threshold.ts';
import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import { armCoverage, CASES_PER_FILE, compareCorpusFile, CORPUS_BASE, corpusFiles, corpusSummary, parseCorpusSummary, summarizeCorpus } from '../../../src/foundation/corpus/corpus.ts';
import type { CorpusFile, CorpusOptions } from '../../../src/foundation/corpus/corpus.ts';
import { decode } from '../../../src/foundation/isa/decode.ts';
import { specOf, specsOf } from '../../../src/foundation/isa/rows.ts';
import { perfectAs } from './simulate.ts';

// The bl threshold (65,536 cases) needs the full bl sample; the ARM sample is cut down for speed.
const OPTIONS: CorpusOptions = { seed: 7, armSample: 256, blSample: 65_536 };
const FILES: readonly CorpusFile[] = [...corpusFiles(OPTIONS)];
const byName = (name: string): CorpusFile => {
  const file = FILES.find((f) => f.name === name);
  assert.ok(file !== undefined, name);
  return file;
};
const HEAD = { inputsDigest: 'test', as: 'GNU assembler (test)', options: OPTIONS };

const ADDRESS_FLOWS = new Set(['branch', 'cond-branch', 'bl', 'pc-load', 'adr']);

test('every Thumb halfword is a case, address-dependent ones once per alignment', () => {
  const thumb = FILES.filter((f) => /^thumb-\d{3}\.s$/.test(f.name));
  const cases = thumb.flatMap((f) => f.cases);
  let addressDependent = 0;
  for (let hw = 0; hw < 0x10000; hw++) if (ADDRESS_FLOWS.has(specOf(decode('thumb', hw, 0).specId).flow)) addressDependent++;
  assert.equal(cases.length, 0x10000 + addressDependent);
  assert.deepEqual(new Set(cases.map((c) => c.word)).size, 0x10000);
  assert.ok(thumb.every((f) => f.cases.length <= CASES_PER_FILE));
  // A doubled case sits at o and o + 2, so at both alignments.
  const ldr = cases.filter((c) => c.word === 0x4801);
  assert.deepEqual(ldr.map((c) => c.context?.alignment), ['0-mod-4', '2-mod-4']);
  assert.equal((ldr[1]?.offset ?? 0) - (ldr[0]?.offset ?? 0), 2);
});

test('bl: every prefix with six boundary suffixes plus the seeded sample, at alternating alignments', () => {
  const bl = FILES.filter((f) => /^bl-\d{3}\.s$/.test(f.name)).flatMap((f) => f.cases);
  assert.equal(bl.length, 2048 * 6 + OPTIONS.blSample);
  assert.ok(bl.every((c) => c.size === 4 && c.kind === 'mnemonic' && c.specId === 'thumb.bl'));
  assert.deepEqual(bl.slice(0, 4).map((c) => c.context?.alignment), ['0-mod-4', '2-mod-4', '0-mod-4', '2-mod-4']);
});

test('ARM: every row swept, the sample, and per-row coverage', () => {
  const sample = FILES.filter((f) => f.name.startsWith('arm-sample-')).flatMap((f) => f.cases);
  assert.equal(sample.length, OPTIONS.armSample);
  const sweep = FILES.filter((f) => f.name.startsWith('arm-sweep-')).flatMap((f) => f.cases);
  const conditions = new Map<string, Set<number>>();
  for (const c of sweep) {
    const set = conditions.get(c.specId) ?? new Set<number>();
    set.add(c.word >>> 28);
    conditions.set(c.specId, set);
  }
  // A row with a condition field shows all 16 conditions in the sweep words generated for it.
  assert.equal(conditions.get('arm.add_imm')?.size, 15);
  const coverage = armCoverage();
  assert.deepEqual(coverage['arm.add_imm'], { exhaustive: ['cond', 's', 'rn', 'rd'], sampled: ['imm12'] });
  assert.equal(Object.keys(coverage).length, specsOf('arm').length);
});

test('labels are defined in the same file at the computed targets', () => {
  for (const file of FILES.filter((f) => f.expect === 'bytes')) {
    const defined = new Set([...file.text.matchAll(/^\.set (_[0-9A-F]{8}), corpus_base ([+-]) 0x([0-9a-f]+)$/gm)].map((m) => {
      const target = CORPUS_BASE + (m[2] === '-' ? -1 : 1) * Number.parseInt(m[3] ?? '', 16);
      assert.equal(m[1], `_${target.toString(16).toUpperCase().padStart(8, '0')}`, `${file.name}: ${m[0]}`);
      return m[1];
    }));
    for (const c of file.cases) {
      for (const label of c.text.match(/\b_[0-9A-F]{8}\b/g) ?? []) assert.ok(defined.has(label), `${file.name}: ${c.text}`);
    }
    assert.ok(file.text.startsWith(`${DIALECT.preamble(file.mode)}.balign 4\ncorpus_base:\n`), file.name);
  }
});

test('offset extremes: both ends at both alignments, and one step past them in files that must fail', () => {
  const extremes = byName('thumb-extremes.s').cases;
  const b = extremes.filter((c) => c.specId === 'thumb.b');
  assert.deepEqual(b.map((c) => [c.text, c.context?.extreme, c.context?.alignment]), [
    ['b _07FFF804', 'min', '0-mod-4'],
    ['b _07FFF806', 'min', '2-mod-4'],
    ['b _08000806', 'max', '0-mod-4'],
    ['b _08000808', 'max', '2-mod-4'],
  ]);
  const probes = FILES.filter((f) => f.expect === 'error');
  assert.equal(probes.length, 2 * 2 * 17 + 2 * 2 + 2 * 3);
  const above = byName('probe-thumb-b-above-a2.s');
  assert.equal(above.probe?.text, 'b _08000806');
  assert.equal(above.probe?.context.extreme, 'max+1');
  assert.equal(above.probe?.assembled, undefined);
  assert.match(above.text, /\t\.space 2\n\tb _08000806\n\.set _08000806, corpus_base \+ 0x806\n$/);
  const ldr = byName('probe-thumb-ldr_pc-below-a0.s');
  assert.equal(ldr.probe?.text, 'ldr r0, _08000000');
  assert.ok(probes.every((f) => f.probe !== undefined && f.probe.assembled === undefined), 'assemble refuses every probe');
  assert.deepEqual(byName('probe-thumb-bl-above-a0.s').probe?.text, 'bl _08400004');
  assert.deepEqual(byName('probe-arm-ldr_pc-above-a0.s').probe?.text, 'ldr r0, _08001008');
});

test('a perfect assembler gives an ok summary that meets every threshold', () => {
  const counts = summarizeCorpus(FILES.map((f) => compareCorpusFile(f, perfectAs(f))), armCoverage());
  const summary = corpusSummary(HEAD, counts, corpusOk(counts, OPTIONS));
  assert.equal(summary.schema, 'romlift/corpus-summary@1');
  assert.equal(summary.ok, true);
  assert.deepEqual(parseCorpusSummary(JSON.parse(JSON.stringify(summary))), { ok: true, value: summary });
  for (const s of [summary.sections.thumb, summary.sections.bl, summary.sections.arm]) {
    assert.equal(s.disagree, 0);
    assert.equal(s.agree, s.cases);
    assert.equal(s.mnemonic + s.raw, s.cases);
  }
  assert.equal(summary.sections.thumb.rawByReason['no-roundtrip'], 0);
  assert.ok(summary.sections.thumb.rawByReason.undefined > 0);
  assert.deepEqual(summary.context.alignments, ['0-mod-4', '2-mod-4']);
  assert.equal(summary.context.extremes, 156);
  assert.equal(summary.encoderAgrees.disagree, 0);
  assert.deepEqual(Object.keys(summary), ['schema', 'inputsDigest', 'as', 'options', 'sections', 'encoderAgrees', 'context', 'ok']);
  assert.deepEqual(Object.keys(summary.sections.thumb), ['cases', 'mnemonic', 'raw', 'agree', 'disagree', 'rawByReason', 'examples']);
});

test('the comparator: a wrong word, a short .text, an as failure, an accepted probe', () => {
  const file = byName('thumb-extremes.s');
  const good = perfectAs(file);
  assert.ok(good.ok);
  const bytes = Uint8Array.from(good.bytes);
  bytes[1] = (bytes[1] ?? 0) ^ 0x01;
  const flipped = compareCorpusFile(file, { ok: true, bytes });
  assert.equal(flipped.sections.thumb.disagree, 1);
  assert.equal(flipped.sections.thumb.examples[0]?.offset, 0);
  assert.equal(flipped.encoder.disagree, 1);
  assert.equal(flipped.context.disagree, 1);

  const short = compareCorpusFile(file, { ok: true, bytes: good.bytes.subarray(0, good.bytes.length - 2) });
  assert.equal(short.sections.thumb.disagree, file.cases.length);
  assert.match(short.sections.thumb.examples[0]?.got ?? '', /^\.text is \d+ bytes, expected \d+$/);

  const failed = compareCorpusFile(file, { ok: false, stderr: 'source.s: Assembler messages:\nsource.s:9: Error: bad\n' });
  assert.equal(failed.sections.thumb.disagree, file.cases.length);
  assert.equal(failed.sections.thumb.examples[0]?.got, 'as failed: source.s:9: Error: bad');

  const probe = byName('probe-arm-b-below-a0.s');
  assert.equal(compareCorpusFile(probe, perfectAs(probe)).context.disagree, 0);
  const accepted = compareCorpusFile(probe, { ok: true, bytes: new Uint8Array(4) });
  assert.equal(accepted.context.disagree, 1);
  assert.equal(accepted.encoder.disagree, 1);
  assert.equal(accepted.context.examples[0]?.got, 'as accepted, assemble refused');
});

test('corpusOk is false when a threshold is missed', () => {
  const comparisons = FILES.map((f) => compareCorpusFile(f, perfectAs(f)));
  const counts = summarizeCorpus(comparisons, armCoverage());
  assert.equal(corpusOk(counts, OPTIONS), true);
  assert.equal(corpusOk(counts, { ...OPTIONS, armSample: 1 << 24 }), false);
  const { 'arm.add_imm': _dropped, ...partial } = armCoverage();
  assert.equal(corpusOk(summarizeCorpus(comparisons, partial), OPTIONS), false);
  assert.equal(corpusOk(summarizeCorpus(comparisons.filter((c) => !c.file.startsWith('bl-')), armCoverage()), OPTIONS), false);
  assert.equal(corpusOk(summarizeCorpus([], armCoverage()), OPTIONS), false);
});

test('parseCorpusSummary names the first field that breaks the contract', () => {
  const counts = summarizeCorpus(FILES.slice(0, 2).map((f) => compareCorpusFile(f, perfectAs(f))), armCoverage());
  const summary: Record<string, unknown> = JSON.parse(JSON.stringify(corpusSummary(HEAD, counts, false))) as Record<string, unknown>;
  assert.deepEqual(parseCorpusSummary({ ...summary, schema: 'romlift/corpus-summary@2' }), { ok: false, error: "schema is not 'romlift/corpus-summary@1'" });
  assert.deepEqual(parseCorpusSummary({ ...summary, ok: 'yes' }), { ok: false, error: 'ok is not a boolean' });
  assert.deepEqual(parseCorpusSummary({ ...summary, inputsDigest: 1 }), { ok: false, error: 'inputsDigest is not a string' });
  assert.deepEqual(parseCorpusSummary(null), { ok: false, error: 'the summary is not an object' });
});
