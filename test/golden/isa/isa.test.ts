// Golden printer output (architecture §10): for a representative list of encodings (each row's own
// match bits when they decode to it, and three seeded encodings that decode to it; PC-relative rows of Thumb also at a
// 2-mod-4 address), the row, the printed text or its raw fallback. UPDATE_GOLDEN=1 rewrites the
// files; the diff is the review.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';

import { decode } from '../../../src/foundation/isa/decode.ts';
import { format, formatRaw } from '../../../src/foundation/isa/format.ts';
import { rawReason } from '../../../src/foundation/isa/roundtrip.ts';
import { specsOf } from '../../../src/foundation/isa/rows.ts';
import { hex } from '../../../src/foundation/util/hex.ts';
import type { Mode } from '../../../src/foundation/rom/span.ts';
import { prngSequence } from '../../helpers/prng.ts';
import { LABELS } from '../../unit/isa/resolver.ts';

const VARIANTS = 3;
const ADDRESS_FLOWS = new Set(['branch', 'cond-branch', 'bl', 'pc-load', 'adr']);

function golden(mode: Mode): string {
  const random = prngSequence(mode === 'thumb' ? 0x7407 : 0xa404, 1 << 16);
  let at = 0;
  const lines: string[] = [];
  for (const spec of specsOf(mode)) {
    const words = decode(mode, spec.match, 0x0800_0000).specId === spec.id ? [spec.match] : [];
    for (let attempt = 0; words.length <= VARIANTS && attempt < 256; attempt++) {
      const word = (((random[at++ % random.length] ?? 0) & ~spec.mask) | spec.match) >>> 0;
      const sized = spec.size === 2 ? word & 0xffff : word;
      if (decode(mode, sized, 0x0800_0000).specId === spec.id && !words.includes(sized)) words.push(sized);
    }
    const addrs = mode === 'thumb' && ADDRESS_FLOWS.has(spec.flow) ? [0x0800_0000, 0x0800_0002] : [0x0800_0000];
    for (const word of words) {
      for (const addr of addrs) {
        const insn = decode(mode, word, addr);
        const text = rawReason(insn, LABELS) === null ? (format(insn, LABELS) ?? '') : formatRaw(insn);
        lines.push(`${hex(addr)} ${hex(insn.word, insn.size * 2).padEnd(8)} ${insn.specId.padEnd(26)} ${text}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

for (const mode of ['thumb', 'arm'] as const) {
  test(`${mode} printer output matches test/golden/isa/${mode}.txt`, () => {
    const file = new URL(`./${mode}.txt`, import.meta.url);
    const actual = golden(mode);
    if (process.env['UPDATE_GOLDEN'] === '1') writeFileSync(file, actual);
    assert.equal(actual, readFileSync(file, 'utf8'));
  });
}
