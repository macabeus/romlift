// `romlift explain <addr> --rom <rom> [--json]` (architecture §2.1, §9.2): in process through `main`: the
// report line and the summary, the text sections, the phase-3 chunk and item, the usage errors (missing
// --rom, a bad address) and the content errors (an unreadable file, an image that is not a cartridge); the phase-4
// name and project mode; the phase-6 signature part (--signatures, and the from key in a project).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { claimName } from '../../../src/api/analysis.ts';
import { explainRecord, itemJson, parseAddrArg } from '../../../src/cli/commands/explain.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import { explain } from '../../../src/core/workflow/explain.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const ROM = FAR_JUMP.rom;
const TMP = mkdtempSync(join(tmpdir(), 'romlift-explain-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
/** No built signature file, whatever the checkout's signatures/ holds: `--rom` then reports W_SIGNATURES_ABSENT (D95 b). */
const NO_SIGNATURES = mkdtempSync(join(TMP, 'no-signatures-'));

async function run(
  argv: readonly string[],
): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), env: { ROMLIFT_SIGNATURES: NO_SIGNATURES } };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

test('parseAddrArg reads 0x-hex and decimal addresses and nothing else', () => {
  assert.equal(parseAddrArg('0x08000104'), 0x0800_0104);
  assert.equal(parseAddrArg('0X8000104'), 0x0800_0104);
  assert.equal(parseAddrArg('134217988'), 0x0800_0104);
  for (const bad of ['', 'main', '0x', '0x123456789', '08000104h', '-1', '99999999999'])
    assert.equal(parseAddrArg(bad), undefined, bad);
});

test('claimName names every claim kind', () => {
  for (const [name, kind] of Object.entries(Claim)) assert.equal(claimName(kind), name);
});

test('explain --json: one report line, the W_SIGNATURES_ABSENT note of a run with no built file, then the summary', async () => {
  const out = await run(['explain', '0x08000104', '--rom', ROM, '--json']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  const parsed = lines(out.stdout);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[1]?.['code'], 'W_SIGNATURES_ABSENT');
  const bytes = new Uint8Array(readFileSync(ROM));
  const report = explain(romFromBytes(bytes, sha1Of(bytes)), 0x0800_0104);
  assert.deepEqual(parsed[0], { type: 'explain', ...JSON.parse(JSON.stringify(explainRecord(report))) });
  assert.equal(parsed[0]?.['addr'], '0x08000104');
  assert.equal(parsed[0]?.['claim'], 'code');
  assert.deepEqual(parsed[2], { type: 'summary', ok: true, exitCode: 0 });
});

test('explain text: claim, owner and provenance, the always-shown groups, the rule meta, the summary', async () => {
  const out = await run(['explain', '0x08000104', '--rom', ROM]);
  assert.equal(out.code, ExitCode.ok);
  assert.match(out.stdout, /^0x08000104\n {2}claim: code\n {2}owner: 0x08000104 \(origin call\)\n {2}provenance:\n/);
  for (const label of ['rejections', 'verdicts', 'waits'])
    assert.match(out.stdout, new RegExp(`\\n {2}${label}(: none| \\(\\d+\\):)\\n`));
  assert.match(out.stdout, /\n {6}rests on: /);
  assert.match(out.stdout, /\n {6}recovers: /);
  assert.match(out.stdout, /\nexplain: ok \(exit 0\)\n$/);
});

test('phase 3: the record and the text name the chunk and the item of the address', async () => {
  const json = lines((await run(['explain', '0x08000104', '--rom', ROM, '--json'])).stdout)[0];
  assert.deepEqual(json?.['chunk'], { name: 'sub_08000104', kind: 'function', module: 'main' });
  const item = json?.['item'] as Record<string, unknown> | undefined;
  assert.equal(item?.['kind'], 'insn');
  assert.deepEqual(item?.['span'], { start: '0x08000104', end: '0x08000106' });
  const insn = item?.['insn'] as Record<string, unknown> | undefined;
  assert.equal(insn?.['mode'], 'thumb');
  assert.equal(insn?.['size'], 2);
  assert.match(String(insn?.['text']), /^\.inst\.n 0x[0-9A-F]{4} @ /);
  const text = (await run(['explain', '0x08000104', '--rom', ROM])).stdout;
  assert.match(
    text,
    /\n {2}chunk: sub_08000104 \(function\) in module main\n {2}item: insn 0x08000104\.\.0x08000106: \.inst\.n 0x[0-9A-F]{4} @ /,
  );
  const outside = (await run(['explain', '0x03000000', '--rom', ROM])).stdout;
  assert.match(outside, /\n {2}chunk: none \(outside the model\)\n {2}item: none\n/);
  assert.equal(lines((await run(['explain', '0x03000000', '--rom', ROM, '--json'])).stdout)[0]?.['item'], undefined);
});

test('itemJson spells every item kind with hexAddr addresses', () => {
  const span = { start: 0x0800_0100, end: 0x0800_0104 };
  assert.deepEqual(itemJson({ kind: 'pool', span, value: 0x0300_0001 }), {
    kind: 'pool',
    span: { start: '0x08000100', end: '0x08000104' },
    value: '0x03000001',
  });
  assert.deepEqual(itemJson({ kind: 'table-entry', span, target: 0x0800_0200, thumbBit: true }), {
    kind: 'table-entry',
    span: { start: '0x08000100', end: '0x08000104' },
    target: '0x08000200',
    thumbBit: true,
  });
  assert.deepEqual(itemJson({ kind: 'padding', span }), {
    kind: 'padding',
    span: { start: '0x08000100', end: '0x08000104' },
  });
  assert.deepEqual(itemJson({ kind: 'data', span, note: 'dead' }), {
    kind: 'data',
    span: { start: '0x08000100', end: '0x08000104' },
    note: 'dead',
  });
  assert.deepEqual(itemJson({ kind: 'raw-insn', span, reason: 'cross-module-short-branch' }), {
    kind: 'raw-insn',
    span: { start: '0x08000100', end: '0x08000104' },
    reason: 'cross-module-short-branch',
    insn: undefined,
  });
});

test('without --rom outside a project: E_PROJECT_NOT_FOUND (exit 1), with a summary', async () => {
  const out = await run(['explain', '0x08000104', '--json']);
  assert.equal(out.code, ExitCode.errors);
  const parsed = out.stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.equal(parsed[0]?.['code'], 'E_PROJECT_NOT_FOUND');
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
});

test('an address that does not parse is a usage error (exit 2); a missing one too', async () => {
  const out = await run(['explain', 'main', '--rom', ROM]);
  assert.equal(out.code, ExitCode.usage);
  assert.match(out.stderr, /'main' is not an address/);
  assert.equal((await run(['explain', '--rom', ROM])).code, ExitCode.usage);
});

test('an unreadable ROM (exit 1) and an image that is not a cartridge (exit 1) are diagnostics', async () => {
  const absent = await run(['explain', '0x08000000', '--rom', join(TMP, 'absent.gba'), '--json']);
  assert.equal(absent.code, ExitCode.errors);
  const parsedAbsent = lines(absent.stdout);
  assert.equal(parsedAbsent[0]?.['code'], 'E_IO_READ');
  assert.deepEqual(parsedAbsent.at(-1), { type: 'summary', ok: false, exitCode: 1 });

  const file = join(TMP, 'not-a-rom.gba');
  writeFileSync(file, new Uint8Array(0x40));
  const out = await run(['explain', '0x08000000', '--rom', file, '--json']);
  assert.equal(out.code, ExitCode.errors);
  const parsed = lines(out.stdout);
  assert.equal(parsed[0]?.['type'], 'explain');
  assert.equal(parsed[1]?.['code'], 'E_ROM_NOT_GBA');
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
  const text = await run(['explain', '0x08000000', '--rom', file]);
  assert.equal(text.code, ExitCode.errors);
  assert.match(text.stderr, /^E_ROM_NOT_GBA error/);
});

// Phase 4: the name and its source; explain inside a project (its ROM and romlift.toml), without --rom.

test('explain names the function holding the address: analysis on a bare ROM, toml (with from) in a project', async () => {
  const bare = await run(['explain', '0x08000104', '--rom', ROM, '--json']);
  assert.deepEqual(lines(bare.stdout)[0]?.['name'], { value: 'sub_08000104', source: 'analysis' });
  const dir = mkdtempSync(join(TMP, 'project-'));
  writeFileSync(join(dir, 'baserom.gba'), readFileSync(ROM));
  assert.equal(await main(['init', 'baserom.gba'], { ...capturingIo(), cwd: dir }), ExitCode.ok);
  const file = join(dir, 'romlift.toml');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(
      '0x08000104 = "sub_08000104"',
      '0x08000104 = { name = "FarJumpCaller", from = "legacy" }',
    ),
  );
  const io = { ...capturingIo(), cwd: dir };
  assert.equal(await main(['explain', '0x08000106', '--json'], io), ExitCode.ok, io.out.join(''));
  const report = lines(io.out.join(''))[0];
  assert.deepEqual(report?.['name'], { value: 'FarJumpCaller', source: 'toml', from: 'legacy' });
  assert.deepEqual(report?.['chunk'], { name: 'FarJumpCaller', kind: 'function', module: 'main' });
  const text = { ...capturingIo(), cwd: dir };
  assert.equal(await main(['explain', '0x08000106'], text), ExitCode.ok);
  assert.match(text.out.join(''), /^ {2}name: FarJumpCaller \(toml, from legacy\)$/m);
});

// Phase 6: the signature part, from --signatures on a bare ROM (with the placement's rule) and from romlift.toml's
// `from` key in a project; --signatures goes with --rom only.

test('explain --rom --signatures: the placement holding the address, in the record and the text', async () => {
  const game = listSyntheticFixtures().find((f) => f.name === 'library-game') ?? assert.fail('library-game');
  const dir = mkdtempSync(join(TMP, 'signatures-'));
  writeFileSync(join(dir, 'libfix.json'), readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json')));
  const json = await run(['explain', '0x08000246', '--rom', game.rom, '--signatures', dir, '--json']);
  assert.equal(json.code, ExitCode.ok, json.stdout);
  assert.deepEqual(lines(json.stdout)[0]?.['signature'], {
    library: 'libfix',
    version: '1.0',
    name: 'FixAbs',
    rule: 'sig.unique-fit',
  });
  const text = await run(['explain', '0x08000246', '--rom', game.rom, '--signatures', dir]);
  assert.match(text.stdout, /^ {2}signature: libfix@1\.0 FixAbs \(sig\.unique-fit\)$/m);
  const empty = mkdtempSync(join(TMP, 'no-signatures-'));
  const none = await run(['explain', '0x08000246', '--rom', game.rom, '--signatures', empty, '--json']);
  assert.equal(lines(none.stdout)[0]?.['signature'], undefined);
  assert.doesNotMatch(
    (await run(['explain', '0x08000246', '--rom', game.rom, '--signatures', empty])).stdout,
    /signature:/,
  );
  assert.equal((await run(['explain', '0x08000246', '--signatures', dir])).code, ExitCode.usage);
});

test('explain in a project reads the signature from the from key, without a rule', async () => {
  const dir = mkdtempSync(join(TMP, 'project-sig-'));
  writeFileSync(join(dir, 'baserom.gba'), readFileSync(ROM));
  assert.equal(await main(['init', 'baserom.gba'], { ...capturingIo(), cwd: dir }), ExitCode.ok);
  const file = join(dir, 'romlift.toml');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(
      '0x08000104 = "sub_08000104"',
      '0x08000104 = { name = "FarJumpCaller", from = "sig:farlib@2" }',
    ),
  );
  const io = { ...capturingIo(), cwd: dir };
  assert.equal(await main(['explain', '0x08000106', '--json'], io), ExitCode.ok, io.out.join(''));
  assert.deepEqual(lines(io.out.join(''))[0]?.['signature'], {
    library: 'farlib',
    version: '2',
    name: 'FarJumpCaller',
  });
  const text = { ...capturingIo(), cwd: dir };
  assert.equal(await main(['explain', '0x08000106'], text), ExitCode.ok);
  assert.match(text.out.join(''), /^ {2}signature: farlib@2 FarJumpCaller$/m);
});
