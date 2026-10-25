// `romlift signatures build <spec> [--out <dir>] [--json]` (architecture §2.1, §7.1, roadmap 6.A): in process through
// `main`. The fixture spec builds <out>/libfix.json, the golden apart from builtWith, with one version line and the
// summary; the default --out is the spec's repository's signatures/; a missing spec exits 1 with the summary. And
// `romlift signatures <rom> [--signatures <dir>] [--json]` (roadmap 6.B): the library fixture's file placed on the
// library-game ROM, one placement line per member with its sig.* rule, the regions, the diagnostics and the summary;
// no built file is W_SIGNATURES_ABSENT with exit 0; an unreadable ROM exits 1; the two forms' options do not mix.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { placementRecord, regionRecord } from '../../../src/cli/commands/signatures.ts';
import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { capturingIo } from './fake.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LIBRARY = join(REPO, 'bench', 'dataset', 'synthetic', 'library');
const SPEC = join(LIBRARY, 'spec.json');
const GOLDEN = JSON.parse(readFileSync(join(LIBRARY, 'signatures.golden.json'), 'utf8')) as { readonly builtWith: string };
const TMP = mkdtempSync(join(tmpdir(), 'romlift-cli-signatures-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

async function run(argv: readonly string[], cwd: string = REPO): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { ...io, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

function lines(stdout: string): readonly Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const withoutBuiltWith = (text: string): unknown => ({ ...(JSON.parse(text) as Record<string, unknown>), builtWith: GOLDEN.builtWith });

test('signatures build <spec> --out <dir> --json: the file, one version line, the summary', async () => {
  const out = join(TMP, 'json');
  const result = await run(['signatures', 'build', SPEC, '--out', out, '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  assert.deepEqual(lines(result.stdout), [
    { type: 'version', library: 'libfix', version: '1.0', functions: 13, tables: 1, references: ['library', 'library-ref2'] },
    { type: 'summary', ok: true, exitCode: 0, counts: { diagnostics: 0, functions: 13, tables: 1, versions: 1, written: 1 } },
  ]);
  assert.deepEqual(withoutBuiltWith(readFileSync(join(out, 'libfix.json'), 'utf8')), GOLDEN);
});

test('signatures build in text: the version line, the file written, the summary; a relative spec resolves against the cwd', async () => {
  const out = join(TMP, 'text');
  const result = await run(['signatures', 'build', 'bench/dataset/synthetic/library/spec.json', '--out', out]);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  assert.equal(
    result.stdout,
    [
      'libfix 1.0: 13 functions, 1 tables from library, library-ref2',
      `wrote ${join(out, 'libfix.json')}`,
      'signatures build: ok (exit 0): diagnostics 0, functions 13, tables 1, versions 1, written 1',
      '',
    ].join('\n'),
  );
});

test("without --out the file goes to the spec's repository's signatures/", async () => {
  const repo = join(TMP, 'repo');
  mkdirSync(join(repo, 'bench', 'dataset', 'real'), { recursive: true });
  mkdirSync(join(repo, 'signatures', 'specs'), { recursive: true });
  const at = (ext: string): string => join(LIBRARY, 'build', `library.${ext}`);
  const dataset = { rom: at('gba'), elf: at('elf'), map: at('map'), sha1: sha1Of(new Uint8Array(readFileSync(at('gba')))), elfCommit: 'c0ffee1', heldout: false, revealed: [] };
  writeFileSync(join(repo, 'bench', 'dataset', 'real', 'lib.json'), JSON.stringify(dataset));
  const spec = { library: 'libfix', versions: [{ id: '1', idNote: '', references: [{ dataset: 'lib', objects: ['fix_*.o'] }] }], reviewedNames: {} };
  writeFileSync(join(repo, 'signatures', 'specs', 'libfix.json'), JSON.stringify(spec));
  const result = await run(['signatures', 'build', 'signatures/specs/libfix.json', '--json'], repo);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  const file = JSON.parse(readFileSync(join(repo, 'signatures', 'libfix.json'), 'utf8')) as { readonly versions: readonly { readonly references: readonly unknown[] }[] };
  assert.deepEqual(file.versions[0]?.references, [{ commit: 'c0ffee1', dataset: 'lib', romSha1: dataset.sha1 }]);
});

test('a spec that does not exist: exit 1, its E_IO_READ and the summary, nothing written', async () => {
  const out = join(TMP, 'none');
  const result = await run(['signatures', 'build', 'romlift-no-such-spec.json', '--out', out, '--json']);
  assert.equal(result.code, ExitCode.errors);
  const all = lines(result.stdout);
  assert.deepEqual(all.map((l) => [l['type'], l['code']]), [['diagnostic', 'E_IO_READ'], ['summary', undefined]]);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: false, exitCode: 1, counts: { diagnostics: 1, functions: 0, tables: 0, versions: 0, written: 0 } });
});

const GAME_ROM = join(REPO, 'bench', 'dataset', 'synthetic', 'library-game', 'build', 'library-game.gba');

/** The fixture's signature file, built once into its own directory. */
let built: string | undefined;
async function fixtureSignatures(): Promise<string> {
  if (built !== undefined) return built;
  const dir = join(TMP, 'fixture-signatures');
  const result = await run(['signatures', 'build', SPEC, '--out', dir, '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  built = dir;
  return dir;
}

test('signatures <rom> --signatures <dir> --json: one placement line per member with its rule, the regions, the summary', async () => {
  const result = await run(['signatures', GAME_ROM, '--signatures', await fixtureSignatures(), '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  const all = lines(result.stdout);
  const placements = all.filter((l) => l['type'] === 'placement');
  const regions = all.filter((l) => l['type'] === 'region');
  assert.equal(placements.length, 14);
  assert.deepEqual(placements[0], { type: 'placement', library: 'libfix', version: '1.0', member: 'FixMulShift@fix_math.o', name: 'FixMulShift', kind: 'function', addr: '0x080001B4', size: 26, mode: 'thumb', rule: 'sig.unique-fit' });
  // Every placement rule decides at least one member of the fixture.
  assert.deepEqual([...new Set(placements.map((p) => p['rule']))].sort(), ['sig.link-order-run', 'sig.neighbour-spacing', 'sig.pinned-both-sides', 'sig.short-member-window', 'sig.unique-fit']);
  const pinned = placements.find((p) => p['rule'] === 'sig.pinned-both-sides');
  assert.deepEqual(pinned?.['constants'], [{ offset: 28, reference: '0x00001234', rom: '0x00005678' }]);
  const table = placements.find((p) => p['kind'] === 'table');
  assert.equal(table?.['mode'], undefined);
  assert.deepEqual(regions, [
    { type: 'region', library: 'libfix', version: '1.0', start: '0x080001B4', end: '0x08000262' },
    { type: 'region', library: 'libfix', version: '1.0', start: '0x08000274', end: '0x08000284' },
  ]);
  assert.deepEqual(all.filter((l) => l['type'] === 'diagnostic').map((l) => l['code']), ['W_SIGNATURE_CONSTANT']);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: true, exitCode: 0, counts: { diagnostics: 1, files: 1, functions: 13, placements: 14, regions: 2, tables: 1 } });
  // Placements in address order, then the regions, then the diagnostics.
  const addrs = placements.map((p) => Number.parseInt(String(p['addr']), 16));
  assert.deepEqual(addrs, [...addrs].sort((a, b) => a - b));
  assert.deepEqual(all.map((l) => l['type']), [...placements.map(() => 'placement'), 'region', 'region', 'diagnostic', 'summary']);
});

test('signatures <rom> in text: one line per placement and region, the diagnostic on stderr, the summary; $ROMLIFT_SIGNATURES is read', async () => {
  const dir = await fixtureSignatures();
  const io = { ...capturingIo(), cwd: REPO, env: { ROMLIFT_SIGNATURES: dir } };
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(['signatures', GAME_ROM], { ...io, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  assert.equal(code, ExitCode.ok, err.join(''));
  const text = out.join('').trimEnd().split('\n');
  assert.equal(text[0], '0x080001B4 function thumb FixMulShift (FixMulShift@fix_math.o, libfix@1.0) size 26 sig.unique-fit');
  assert.ok(text.includes('0x08000240 function thumb Halt (FixSwiHalt@fix_stub.o, libfix@1.0) size 4 sig.link-order-run'), 'a reviewed display name with its member id');
  assert.ok(text.includes('0x080001F8 function thumb FixScale (FixScale@fix_mem.o, libfix@1.0) size 36 sig.pinned-both-sides, 1 constants'));
  assert.ok(text.includes('region 0x080001B4..0x08000262 libfix@1.0'));
  assert.equal(text.at(-1), 'signatures: ok (exit 0): diagnostics 1, files 1, functions 13, placements 14, regions 2, tables 1');
  assert.match(err.join(''), /^W_SIGNATURE_CONSTANT warning 0x080001F8/);
});

test('signatures <rom> with no built file: W_SIGNATURES_ABSENT, nothing placed, exit 0', async () => {
  const empty = join(TMP, 'no-signatures');
  mkdirSync(empty, { recursive: true });
  const result = await run(['signatures', GAME_ROM, '--signatures', empty, '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  const all = lines(result.stdout);
  assert.deepEqual(all.map((l) => [l['type'], l['code']]), [['diagnostic', 'W_SIGNATURES_ABSENT'], ['summary', undefined]]);
  assert.equal(all[0]?.['severity'], 'warning');
  assert.equal(all[0]?.['path'], empty);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: true, exitCode: 0, counts: { diagnostics: 1, files: 0, functions: 0, placements: 0, regions: 0, tables: 0 } });
  // A relative directory resolves against the cwd, and a directory that does not exist is absent too.
  const missing = await run(['signatures', GAME_ROM, '--signatures', 'romlift-no-such-dir', '--json']);
  assert.equal(missing.code, ExitCode.ok);
  assert.equal(lines(missing.stdout)[0]?.['path'], join(REPO, 'romlift-no-such-dir'));
});

test('signatures <rom>: a file that is no signature file is skipped with W_SIGNATURE_FILE_SKIPPED, then absent', async () => {
  const dir = join(TMP, 'bad-signatures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'broken.json'), '{"schema": 2}');
  const result = await run(['signatures', GAME_ROM, '--signatures', dir, '--json']);
  assert.equal(result.code, ExitCode.ok, result.stderr);
  assert.deepEqual(lines(result.stdout).map((l) => l['code'] ?? l['type']), ['W_SIGNATURE_FILE_SKIPPED', 'W_SIGNATURES_ABSENT', 'summary']);
});

test('signatures <rom>: a ROM that cannot be read exits 1; one that is no cartridge exits 1 with nothing placed', async () => {
  const unread = await run(['signatures', 'romlift-no-such.gba', '--json']);
  assert.equal(unread.code, ExitCode.errors);
  assert.deepEqual(lines(unread.stdout).map((l) => l['code'] ?? l['type']), ['E_IO_READ', 'summary']);
  const junk = join(TMP, 'junk.gba');
  writeFileSync(junk, new Uint8Array(64));
  const notGba = await run(['signatures', junk, '--signatures', await fixtureSignatures(), '--json']);
  assert.equal(notGba.code, ExitCode.errors);
  const all = lines(notGba.stdout);
  assert.equal(all.filter((l) => l['type'] === 'placement').length, 0);
  assert.ok(all.some((l) => l['code'] === 'E_ROM_NOT_GBA'), notGba.stdout);
  assert.deepEqual(all.at(-1), { type: 'summary', ok: false, exitCode: 1, counts: { diagnostics: all.length - 1, files: 1, functions: 0, placements: 0, regions: 0, tables: 0 } });
});

test('the records spell addresses and constants as hexAddr strings and leave an absent mode out', () => {
  assert.deepEqual(
    placementRecord({ library: 'l', version: '1', member: 'f@a.o', name: 'f', kind: 'function', addr: 0x0800_0100, size: 8, mode: 'arm', rule: 'sig.pinned-both-sides', constants: [{ offset: 4, reference: 1, rom: 0x0300_0000 }] }),
    { library: 'l', version: '1', member: 'f@a.o', name: 'f', kind: 'function', addr: '0x08000100', size: 8, mode: 'arm', rule: 'sig.pinned-both-sides', constants: [{ offset: 4, reference: '0x00000001', rom: '0x03000000' }] },
  );
  assert.deepEqual(regionRecord({ library: 'l', version: '1', span: { start: 0x0800_0100, end: 0x0800_0200 } }), { library: 'l', version: '1', start: '0x08000100', end: '0x08000200' });
});

test('usage errors: build without <spec>, a second argument after <rom>, and options of the other form', async () => {
  const bare = await run(['signatures', 'build']);
  assert.equal(bare.code, ExitCode.usage);
  assert.match(bare.stderr, /build needs <spec>/);
  assert.equal((await run(['signatures', 'build', SPEC, 'extra'])).code, ExitCode.usage);
  const two = await run(['signatures', GAME_ROM, 'extra']);
  assert.equal(two.code, ExitCode.usage);
  assert.match(two.stderr, /takes one argument/);
  const out = await run(['signatures', GAME_ROM, '--out', TMP]);
  assert.equal(out.code, ExitCode.usage);
  assert.match(out.stderr, /--out goes with signatures build/);
  const dir = await run(['signatures', 'build', SPEC, '--signatures', TMP]);
  assert.equal(dir.code, ExitCode.usage);
  assert.match(dir.stderr, /--signatures goes with signatures <rom>/);
});
