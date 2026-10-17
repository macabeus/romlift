// Runs hand-written row cases: decode the word, then check its row, printed text (or raw reason),
// flow, stack delta and chosen fields, and that a printed text round-trips.
import assert from 'node:assert/strict';

import { decode } from '../../../src/foundation/isa/decode.ts';
import { format, formatRaw } from '../../../src/foundation/isa/format.ts';
import { rawReason, roundTrips } from '../../../src/foundation/isa/roundtrip.ts';
import { specOf } from '../../../src/foundation/isa/rows.ts';
import type { Fields, Flow, RawReason, SpecId } from '../../../src/foundation/isa/types.ts';
import type { Mode } from '../../../src/foundation/rom/span.ts';
import { LABELS } from './resolver.ts';

export interface RowCase {
  readonly word: number;
  readonly addr?: number;
  readonly spec: SpecId;
  /** The printed mnemonic, or the raw reason when it prints raw. */
  readonly text?: string;
  readonly raw?: RawReason;
  readonly flow?: Flow;
  readonly stack?: number;
  readonly fields?: Fields;
}

export function checkCase(mode: Mode, c: RowCase): void {
  const addr = c.addr ?? 0x0800_0000;
  const insn = decode(mode, c.word, addr);
  const where = `${mode} 0x${c.word.toString(16)}`;
  assert.equal(insn.specId, c.spec, `${where}: row`);
  const reason = rawReason(insn, LABELS);
  if (c.raw !== undefined) {
    assert.equal(reason, c.raw, `${where}: raw reason`);
    assert.ok(formatRaw(insn).startsWith(mode === 'arm' ? '.inst 0x' : '.inst.'), `${where}: raw text`);
  } else {
    assert.equal(reason, null, `${where}: prints (${formatRaw(insn)})`);
    assert.equal(format(insn, LABELS), c.text, `${where}: text`);
    assert.ok(roundTrips(insn, LABELS), `${where}: round trip`);
  }
  if (c.flow !== undefined) assert.deepEqual(insn.flow, c.flow, `${where}: flow`);
  if (c.stack !== undefined) assert.equal(specOf(insn.specId).stack?.(insn.fields) ?? 0, c.stack, `${where}: stack`);
  if (c.fields !== undefined) for (const [k, v] of Object.entries(c.fields)) assert.equal(insn.fields[k], v, `${where}: field ${k}`);
}
