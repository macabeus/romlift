// The config init writes with the signature layer (core/workflow/init-config.ts initConfigOf; architecture §7.3, D9,
// D93), on the library-game fixture with in-memory signature files: libfix's committed golden file (built from the
// self-authored library fixtures) names every placed function with `from = "sig:libfix@1.0"`, its table becomes a
// [symbols] entry with size and type, its region an `asm` module carrying library and version, and [signatures] lists
// the library; a member that restores an extent the analysis split gets `size` and the entry it holds an [entry_points] entry;
// a member that contradicts the analysis is W_EVIDENCE_CONFLICT and changes nothing; no file leaves every default name;
// `signatures: false` (`--no-signatures`) writes `enabled = false` and ignores the files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile } from '../../../src/core/signatures/schema.ts';
import { initConfigOf } from '../../../src/core/workflow/init-config.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';
import { signatureFile } from '../../helpers/signatures.ts';

const GAME = listSyntheticFixtures().find((f) => f.name === 'library-game') ?? assert.fail('library-game');
const ROM: Rom = readFixtureRom(GAME);
const parsed = parseSignatureFile(JSON.parse(readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), 'utf8')));
assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
const LIBFIX: SignatureFile = parsed.value;

/** The ROM's bytes [start, end) as a signature member's bytes. */
function bytesAt(start: number, end: number): Uint8Array {
  return ROM.bytes.slice(start - ROM.base, end - ROM.base);
}

function configOf(files?: readonly SignatureFile[], signatures?: boolean): ReturnType<typeof initConfigOf> & { readonly ok: true } {
  const made = initConfigOf(ROM, { ...(files === undefined ? {} : { signatureFiles: files }), ...(signatures === undefined ? {} : { signatures }) });
  assert.ok(made.ok, made.ok ? '' : made.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  return made;
}

test("libfix's file: every placement named with its from, the table a symbol, the region an asm module, the library listed", () => {
  const made = configOf([LIBFIX]);
  const { config } = made;
  const named = [...config.functions].filter(([, f]) => f.from !== undefined).map(([a, f]) => [a.toString(16), f.name, f.from]);
  assert.deepEqual(named, [
    ['80001b4', 'FixMulShift', 'sig:libfix@1.0'],
    ['80001d0', 'FixClamp', 'sig:libfix@1.0'],
    ['80001dc', 'FixFillWords', 'sig:libfix@1.0'],
    ['80001f8', 'FixScale', 'sig:libfix@1.0'],
    ['800021c', 'FixCopyHalves', 'sig:libfix@1.0'],
    ['8000234', 'FixSwiDiv', 'sig:libfix@1.0'],
    ['8000238', 'FixSwiSqrt', 'sig:libfix@1.0'],
    ['800023c', 'FixSwiCpuSet', 'sig:libfix@1.0'],
    ['8000240', 'Halt', 'sig:libfix@1.0'],
    ['8000244', 'FixAbs', 'sig:libfix@1.0'],
    ['8000254', 'FixReturnZero', 'sig:libfix@1.0'],
    ['8000258', 'FixReturnOne', 'sig:libfix@1.0'],
    ['800025c', 'FixShort', 'sig:libfix@1.0'],
  ]);
  assert.ok([...config.functions.values()].every((f) => f.size === undefined), 'no member restores an extent here');
  assert.deepEqual([...config.symbols], [[0x0800_0274, { name: 'gFixTable', size: 0x10, type: 'pointers', aliases: [], from: 'sig:libfix@1.0' }]]);
  const libfix = config.modules.find((m) => m.library !== undefined);
  assert.deepEqual(libfix, { name: 'libfix', start: 0x0800_01b4, kind: 'asm', generated: true, library: 'libfix', version: '1.0' });
  assert.deepEqual(config.signatures, { enabled: true, libraries: ['libfix'] });
  assert.match(made.tomlText, /\[signatures\]\nenabled = true\nlibraries = \["libfix"\]\n/);
  assert.match(made.tomlText, /^0x080001B4 = \{ name = "FixMulShift", from = "sig:libfix@1\.0" \}$/m);
  assert.deepEqual(made.diagnostics.map((d) => d.code), ['W_SIGNATURE_CONSTANT'], "FixScale's game constant, reported by the matcher");
});

test('a member restoring an extent the analysis split: its size, and an [entry_points] entry for the one it holds', () => {
  // GameShift [0x154, 0x15A), its pad and GameReturnZero [0x15C, 0x160) as one member: one function of 12 bytes.
  const pair = signatureFile('gamelib', { id: '1', members: [{ name: 'GamePair', bytes: bytesAt(0x0800_0154, 0x0800_0160) }] });
  const { config } = configOf([pair]);
  assert.deepEqual(config.functions.get(0x0800_0154), { name: 'GamePair', mode: 'thumb', size: 0xc, aliases: [], from: 'sig:gamelib@1' });
  assert.equal(config.functions.has(0x0800_015c), false);
  assert.deepEqual(config.entryPoints.get(0x0800_015c), { name: 'sub_0800015C', mode: 'thumb', aliases: [] });
  assert.deepEqual(
    config.modules.filter((m) => m.library !== undefined).map((m) => [m.name, m.start]),
    [['gamelib', 0x0800_0154]],
  );
});

test('a member that contradicts the analysis is W_EVIDENCE_CONFLICT and changes nothing', () => {
  // GameFiller's Thumb bytes as an ARM member: placed at a Thumb function the analysis found.
  const arm = signatureFile('armlib', { id: '1', members: [{ name: 'NotArm', mode: 'arm', bytes: bytesAt(0x0800_0160, 0x0800_0180) }] });
  const made = configOf([arm]);
  const conflict = made.diagnostics.find((d) => d.code === 'W_EVIDENCE_CONFLICT');
  assert.ok(conflict !== undefined, made.diagnostics.map((d) => d.code).join(', '));
  assert.equal(conflict.addr, 0x0800_0160);
  assert.match(conflict.message, /the signature armlib@1 \(sig\.unique-fit\) proposes NotArm as a arm function at 0x08000160, but the analysis found a thumb function there/);
  assert.deepEqual(made.config.functions.get(0x0800_0160), { name: 'sub_08000160', mode: 'thumb', aliases: [] });
  assert.deepEqual(made.config.signatures, { enabled: true }, 'no proposal of armlib was kept, so it is not listed');
  assert.deepEqual(made.config.modules, configOf().config.modules, 'its region still shapes nothing a kept proposal needs');
});

test('no file: enabled, no library, every default name; signatures false: enabled = false and the files ignored', () => {
  const none = configOf();
  assert.deepEqual(none.config.signatures, { enabled: true });
  assert.ok([...none.config.functions.values()].every((f) => f.from === undefined));
  const off = configOf([LIBFIX], false);
  assert.deepEqual(off.config.signatures, { enabled: false });
  assert.match(off.tomlText, /\[signatures\]\nenabled = false\n/);
  assert.deepEqual(off.config.functions, none.config.functions);
  assert.deepEqual(off.config.modules, none.config.modules);
  assert.deepEqual(off.diagnostics, []);
});
