// The in-process equivalent of the corpus round trip (architecture §5, D49): seeded Thumb halfwords, bl
// pairs and ARM words, each decoded where it sits and printed as the writers print it (the mnemonic when
// the printing rule allows it, its `.inst` fallback otherwise) with synthetic labels, are parsed back by
// parseStatements and laid out by layoutStatements into exactly their original bytes.
import { formatRaw } from '@match-kit/isa/armv4t';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIALECT } from '../../../src/foundation/asm/dialect.ts';
import { layoutStatements } from '../../../src/foundation/asm/layout.ts';
import { parseStatements } from '../../../src/foundation/asm/statements.ts';
import { decode, printing } from '../../../src/foundation/isa.ts';
import type { Mode } from '../../../src/foundation/rom/span.ts';
import { prngSequence } from '../../helpers/prng.ts';
import { LABELS } from '../isa/resolver.ts';

const BASE = 0x0800_0000;

interface Sample {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly mnemonics: number;
  readonly raws: number;
}

/** Prints `words` one after another from `start` as a writer would, with the bytes they stand for. */
function sample(mode: Mode, start: number, words: readonly number[]): Sample {
  const lines = [DIALECT.preamble(mode).trimEnd()];
  const bytes: number[] = [];
  let addr = start;
  let mnemonics = 0;
  let raws = 0;
  for (const word of words) {
    const insn = decode(mode, word, addr);
    const printed = printing(insn, LABELS);
    if (printed.kind === 'mnemonic') mnemonics++;
    else raws++;
    lines.push(`\t${printed.kind === 'mnemonic' ? printed.text : formatRaw(insn)}`);
    for (let i = 0; i < insn.size; i++) bytes.push(Math.floor(insn.word / 2 ** (8 * i)) & 0xff);
    addr += insn.size;
  }
  return { text: `${lines.join('\n')}\n`, bytes: Uint8Array.from(bytes), mnemonics, raws };
}

function roundTrip(mode: Mode, start: number, words: readonly number[]): Sample {
  const s = sample(mode, start, words);
  const parsed = parseStatements(s.text, { includes: new Map([['include/macros.inc', DIALECT.macrosInc]]) });
  assert.deepEqual(parsed.errors, []);
  const out = layoutStatements({
    statements: parsed.statements,
    start,
    mode,
    resolve: (name) => {
      const addr = LABELS.addressOf(name);
      return addr === undefined ? undefined : { addr, thumbFunction: false };
    },
    incbin: () => undefined,
  });
  assert.deepEqual(out.errors.slice(0, 5), []);
  assert.equal(out.bytes.length, s.bytes.length);
  for (let i = 0; i < s.bytes.length; i++) {
    if (out.bytes[i] !== s.bytes[i])
      assert.fail(`${mode} byte ${i} (0x${(start + i).toString(16)}): ${out.bytes[i]} !== ${s.bytes[i]}`);
  }
  return s;
}

test('seeded Thumb halfwords lay out to their bytes, at both alignments', () => {
  const words = Array.from(prngSequence(0x7417_0001, 16_384), (r) => r & 0xffff);
  for (const start of [BASE, BASE + 2]) {
    const s = roundTrip('thumb', start, words);
    assert.ok(s.mnemonics > 10_000 && s.raws > 0, `${s.mnemonics} mnemonics, ${s.raws} raw`);
  }
});

test('seeded bl pairs lay out to their bytes', () => {
  const words = Array.from(
    prngSequence(0x0b1b_1b1b, 4096),
    (r) => (0xf000 | (r & 0x7ff) | ((0xf800 | ((r >>> 11) & 0x7ff)) << 16)) >>> 0,
  );
  const s = roundTrip('thumb', BASE + 0x40_0000, words);
  assert.equal(s.raws, 0);
});

test('seeded ARM words lay out to their bytes', () => {
  const s = roundTrip('arm', BASE, Array.from(prngSequence(0xa5a5_0001, 16_384)));
  assert.ok(s.mnemonics > 1000 && s.raws > 0, `${s.mnemonics} mnemonics, ${s.raws} raw`);
});
