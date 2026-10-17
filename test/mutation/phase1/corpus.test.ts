// Fault injection into the corpus comparator (architecture §10, roadmap 1.I): one flipped byte in an
// assembled corpus file is reported as exactly that case's disagreement, and the summary is not ok.
// The file is assembled with the real arm-none-eabi-as when it is installed, by a perfect simulated
// assembler otherwise.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import { corpusOk } from '../../../src/core/workflow/doctor.ts';
import { armCoverage, compareCorpusFile, corpusFiles, summarizeCorpus } from '../../../src/foundation/corpus/corpus.ts';
import type { CorpusAssembly, CorpusOptions } from '../../../src/foundation/corpus/corpus.ts';
import { assembleWithBinutils, findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { perfectAs } from '../../unit/corpus/simulate.ts';

const OPTIONS: CorpusOptions = { seed: 11, armSample: 512, blSample: 65_536 };

test('a flipped byte in an assembled corpus file fails exactly its case and the summary', async () => {
  const files = [...corpusFiles(OPTIONS)];
  const target = files.find((f) => f.name === 'thumb-000.s');
  assert.ok(target !== undefined);

  let assembled: CorpusAssembly = perfectAs(target);
  if (!('code' in findBinutils(process.env))) {
    const real = await assembleWithBinutils(target.text, { mode: 'thumb', files: { 'include/macros.inc': DIALECT.macrosInc } });
    assert.ok(real.ok, real.ok ? '' : real.stderr);
    assembled = { ok: true, bytes: real.bytes };
  }
  assert.ok(assembled.ok);
  const clean = compareCorpusFile(target, assembled);
  assert.equal(clean.sections.thumb.disagree, 0);

  const victim = target.cases[1234];
  assert.ok(victim !== undefined);
  const bytes = Uint8Array.from(assembled.bytes);
  bytes[victim.offset + 1] = (bytes[victim.offset + 1] ?? 0) ^ 0x40;
  const broken = compareCorpusFile(target, { ok: true, bytes });
  assert.equal(broken.sections.thumb.disagree, 1);
  assert.equal(broken.sections.thumb.examples.length, 1);
  assert.equal(broken.sections.thumb.examples[0]?.offset, victim.offset);
  assert.equal(broken.sections.thumb.examples[0]?.text, victim.text);

  const others = files.filter((f) => f !== target).map((f) => compareCorpusFile(f, perfectAs(f)));
  assert.equal(corpusOk(summarizeCorpus([clean, ...others], armCoverage()), OPTIONS), true);
  const summary = summarizeCorpus([broken, ...others], armCoverage());
  assert.equal(corpusOk(summary, OPTIONS), false);
  assert.equal(summary.sections.thumb.disagree, 1);
  assert.equal(summary.sections.bl.disagree + summary.sections.arm.disagree, 0);
});
