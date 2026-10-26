// The library fixtures (bench/dataset/synthetic/library*, roadmap 6.A): libfix's spec built by the pure builder from
// the committed builds of library and library-ref2 (ROM, ELF, map, romlift's discover run) equals the committed
// signatures.golden.json, apart from builtWith; and the members land as the fixture's build.mk documents: FixShort
// only from library-ref2, every member of library-ref2 but FixShort matched by id, gFixTable naming three functions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractSignatures, mapPlacements, signatureFileText } from '../../../../src/core/signatures/extract.ts';
import type { ReferenceInput } from '../../../../src/core/signatures/extract.ts';
import { parseSignatureFile } from '../../../../src/core/signatures/schema.ts';
import { parseSignatureSpec } from '../../../../src/core/signatures/spec.ts';
import { discover } from '../../../../src/core/workflow/discover.ts';
import { parseElf } from '../../../../src/foundation/formats/elf.ts';
import { parseGnuMap } from '../../../../src/foundation/formats/gnu-map.ts';
import { romFromBytes } from '../../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';

const SYNTHETIC = fileURLToPath(new URL('../../../../bench/dataset/synthetic/', import.meta.url));

function fixtureReference(name: string): ReferenceInput {
  const at = (ext: string): string => join(SYNTHETIC, name, 'build', `${name}.${ext}`);
  const bytes = new Uint8Array(readFileSync(at('gba')));
  const rom = romFromBytes(bytes, sha1Of(bytes));
  const elf = parseElf(new Uint8Array(readFileSync(at('elf'))));
  assert.ok(elf.ok, name);
  const map = parseGnuMap(readFileSync(at('map'), 'utf8'));
  assert.ok(map.ok, name);
  const placements = mapPlacements(map.value);
  return { dataset: name, commit: 'synthetic', romSha1: rom.sha1, rom, analysis: discover(rom), symbols: elf.value.symbols, textPlacements: placements.text, dataPlacements: placements.data };
}

const spec = parseSignatureSpec(JSON.parse(readFileSync(join(SYNTHETIC, 'library', 'spec.json'), 'utf8')));
assert.ok(spec.ok, spec.ok ? '' : spec.error);
const inputs = spec.value.versions.map((v) => v.references.map((r) => fixtureReference(r.dataset)));
const golden = parseSignatureFile(JSON.parse(readFileSync(join(SYNTHETIC, 'library', 'signatures.golden.json'), 'utf8')));
assert.ok(golden.ok, golden.ok ? '' : golden.error);

test("libfix's file, built from the two references, equals the committed golden but for builtWith; two builds give one text", () => {
  const first = extractSignatures(spec.value, inputs, golden.value.builtWith);
  const second = extractSignatures(spec.value, inputs, golden.value.builtWith);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(first.value, golden.value);
  assert.equal(signatureFileText(first.value), signatureFileText(second.value));
  assert.equal(signatureFileText(first.value), readFileSync(join(SYNTHETIC, 'library', 'signatures.golden.json'), 'utf8'));
});

test("the golden's members: FixShort from library-ref2 only, the reviewed Halt, gFixTable's names, the link orders", () => {
  const version = golden.value.versions[0];
  assert.ok(version !== undefined);
  assert.deepEqual(version.functions.map((f) => f.id).filter((id) => id.endsWith('@fix_short.o')), ['FixShort@fix_short.o']);
  assert.equal(version.functions.at(-1)?.id, 'FixShort@fix_short.o', 'added after every member of the first reference');
  assert.equal(version.functions.find((f) => f.id === 'FixSwiHalt@fix_stub.o')?.name, 'Halt');
  assert.deepEqual(version.tables.map((t) => [t.id, t.names]), [['gFixTable@fix_data.o', ['FixMulShift@fix_math.o', 'FixClamp@fix_math.o', null, 'FixReturnZero@fix_util.o']]]);
  const [first, second] = version.linkOrder;
  assert.equal(first?.reference, 'library');
  assert.equal(first?.members.length, 13);
  assert.equal(second?.reference, 'library-ref2');
  assert.deepEqual(second?.members.map((m) => m.id), ['FixMulShift@fix_math.o', 'FixClamp@fix_math.o', 'FixShort@fix_short.o', 'FixAbs@fix_util.o', 'FixReturnZero@fix_util.o', 'FixReturnOne@fix_util.o']);
  // FixScale keeps its two literal constants; FixFillWords drops its IWRAM pool word.
  assert.ok(version.functions.find((f) => f.id === 'FixScale@fix_mem.o')?.mask.endsWith('ffffffffffffffff'));
  assert.ok(version.functions.find((f) => f.id === 'FixFillWords@fix_mem.o')?.mask.endsWith('00000000'));
});
