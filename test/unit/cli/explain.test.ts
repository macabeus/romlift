// `romlift explain <addr> --rom <rom> [--json]` (architecture §2.1, §9.2): in process through `main`: the
// report line and the summary, the text sections, the usage errors (missing --rom, a bad address) and the
// content errors (an unreadable file, an image that is not a cartridge).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { claimName } from '../../../src/api/analysis.ts';
import { explainRecord, parseAddrArg } from '../../../src/cli/commands/explain.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import { explain } from '../../../src/core/workflow/explain.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const FAR_JUMP = listSyntheticFixtures().find((f) => f.name === 'far-jump');
if (FAR_JUMP === undefined) throw new Error('the far-jump fixture is missing');
const ROM = FAR_JUMP.rom;
const TMP = mkdtempSync(join(tmpdir(), 'romlift-explain-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

async function run(argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = capturingIo();
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
  for (const bad of ['', 'main', '0x', '0x123456789', '08000104h', '-1', '99999999999']) assert.equal(parseAddrArg(bad), undefined, bad);
});

test('claimName names every claim kind', () => {
  for (const [name, kind] of Object.entries(Claim)) assert.equal(claimName(kind), name);
});

test('explain --json: one report line, then the summary', async () => {
  const out = await run(['explain', '0x08000104', '--rom', ROM, '--json']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  const parsed = lines(out.stdout);
  assert.equal(parsed.length, 2);
  const bytes = new Uint8Array(readFileSync(ROM));
  const report = explain(romFromBytes(bytes, sha1Of(bytes)), 0x0800_0104);
  assert.deepEqual(parsed[0], { type: 'explain', ...JSON.parse(JSON.stringify(explainRecord(report))) });
  assert.equal(parsed[0]?.['addr'], '0x08000104');
  assert.equal(parsed[0]?.['claim'], 'code');
  assert.deepEqual(parsed[1], { type: 'summary', ok: true, exitCode: 0 });
});

test('explain text: claim, owner and provenance, the always-shown groups, the rule meta, the summary', async () => {
  const out = await run(['explain', '0x08000104', '--rom', ROM]);
  assert.equal(out.code, ExitCode.ok);
  assert.match(out.stdout, /^0x08000104\n {2}claim: code\n {2}owner: 0x08000104 \(origin call\)\n {2}provenance:\n/);
  for (const label of ['rejections', 'verdicts', 'waits']) assert.match(out.stdout, new RegExp(`\\n {2}${label}(: none| \\(\\d+\\):)\\n`));
  assert.match(out.stdout, /\n {6}rests on: /);
  assert.match(out.stdout, /\n {6}recovers: /);
  assert.match(out.stdout, /\nexplain: ok \(exit 0\)\n$/);
});

test('a missing --rom is a usage error (exit 2)', async () => {
  const out = await run(['explain', '0x08000104', '--json']);
  assert.equal(out.code, ExitCode.usage);
  assert.equal(out.stdout, '');
  assert.match(out.stderr, /explain: needs --rom <rom>/);
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
