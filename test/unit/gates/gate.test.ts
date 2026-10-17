// The gate framework's decisions, with fake inputs; and gate() itself, end to end, in a child process.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkInput,
  decideVerdict,
  exec,
  formatRecord,
  inputsFor,
  jsonLines,
  lastJson,
  listFixtures,
  missingExports,
  objectsDigest,
  parseDataset,
  resolveRoots,
  selectedTier,
  splitDatasets,
  testOutcome,
  tierIncludes,
  withLock,
  type DatasetRef,
  type ExecResult,
  type GateIo,
  type InputCheck,
  type InputEnv,
} from '../../gates/gate.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function sha(algorithm: 'sha1' | 'sha256', bytes: string | Uint8Array): string {
  return createHash(algorithm).update(bytes).digest('hex');
}

/** An in-memory file system and process table. */
function fakeIo(files: Readonly<Record<string, string>>, commands: Readonly<Record<string, ExecResult>> = {}): GateIo {
  const dirs = new Set<string>();
  for (const file of Object.keys(files)) {
    for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) dirs.add(dir);
  }
  const bytes = (file: string): Uint8Array => {
    const text = files[file];
    if (text === undefined) throw new Error(`ENOENT ${file}`);
    return new TextEncoder().encode(text);
  };
  return {
    exists: async (file) => file in files || dirs.has(file),
    isDirectory: async (file) => dirs.has(file),
    fileDigest: async (file, algorithm) => sha(algorithm, bytes(file)),
    listFiles: async (dir) =>
      Object.keys(files)
        .filter((file) => file.startsWith(`${dir}/`))
        .map((file) => file.slice(dir.length + 1)),
    readBytes: async (file) => bytes(file),
    readText: async (file) => new TextDecoder().decode(bytes(file)),
    realpath: async (file) => file.replace(/\/$/, ''),
    hash: () => {
      const hasher = createHash('sha256');
      return { update: (chunk) => void hasher.update(chunk), digest: () => hasher.digest('hex') };
    },
    exec: async (command, args) => commands[[command, ...args].join(' ')] ?? { code: 127, stdout: '', stderr: 'not found' },
  };
}

function dataset(overrides: Partial<DatasetRef> & Pick<DatasetRef, 'name'>): DatasetRef {
  return { rom: `${overrides.name}.gba`, elf: `${overrides.name}.elf`, sha1: '', heldout: false, revealed: [], ...overrides };
}

const ok: InputCheck = { available: true, detail: '', digest: 'd' };
const absent: InputCheck = { available: false, detail: 'gone' };

test('the selected tier defaults to ci and refuses unknown values', () => {
  assert.equal(selectedTier({}), 'ci');
  assert.equal(selectedTier({ ROMLIFT_GATE_TIER: 'ci' }), 'ci');
  assert.equal(selectedTier({ ROMLIFT_GATE_TIER: 'real' }), 'real');
  assert.throws(() => selectedTier({ ROMLIFT_GATE_TIER: 'both' }));
  assert.equal(tierIncludes('both', 'ci'), true);
  assert.equal(tierIncludes('both', 'real'), true);
  assert.equal(tierIncludes('ci', 'real'), false);
  assert.equal(tierIncludes('real', 'real'), true);
});

test('roots default to the parent of the repository and its romlift-poc', () => {
  assert.deepEqual(resolveRoots({}, '/w/romlift'), { benchRoot: '/w', pocRoot: '/w/romlift-poc' });
  assert.deepEqual(resolveRoots({ ROMLIFT_BENCH_ROOT: '/b' }, '/w/romlift'), { benchRoot: '/b', pocRoot: '/b/romlift-poc' });
  assert.deepEqual(resolveRoots({ ROMLIFT_BENCH_ROOT: '/b', ROMLIFT_POC: '/p' }, '/w/romlift'), { benchRoot: '/b', pocRoot: '/p' });
});

test('verdict order: historical, then pending, then unavailable, then run', () => {
  const spec = { needs: ['analyze', 'explain'], inputs: ['roms', 'poc'] as const, historicalAfter: 2 as const };
  const none = new Set<string>();
  const all = new Set(['analyze', 'explain']);
  assert.equal(decideVerdict(spec, { landed: 2, exported: none, checks: {} })?.verdict, 'historical');
  assert.deepEqual(decideVerdict(spec, { landed: 1, exported: new Set(['analyze']), checks: {} }), {
    verdict: 'pending',
    detail: 'not exported yet: explain',
    missing: ['explain'],
  });
  assert.deepEqual(decideVerdict(spec, { landed: 1, exported: all, checks: { roms: ok, poc: absent } }), {
    verdict: 'unavailable',
    detail: 'poc: gone',
    missing: ['poc'],
  });
  assert.equal(decideVerdict(spec, { landed: 1, exported: all, checks: { roms: ok } })?.verdict, 'unavailable');
  assert.equal(decideVerdict(spec, { landed: 1, exported: all, checks: { roms: ok, poc: ok } }), undefined);
  assert.equal(decideVerdict({ needs: [] }, { landed: 9, exported: none, checks: {} }), undefined);
  assert.deepEqual(missingExports(['b', 'a', 'c'], new Set(['a'])), ['b', 'c']);
});

test('node:test outcomes: pass and historical pass, pending and unavailable skip, fail fails', () => {
  assert.deepEqual(testOutcome('pass', ''), { kind: 'pass' });
  assert.deepEqual(testOutcome('historical', 'x'), { kind: 'pass' });
  assert.deepEqual(testOutcome('pending', 'not exported yet: a'), { kind: 'skip', message: 'pending: not exported yet: a' });
  assert.deepEqual(testOutcome('unavailable', 'roms: no tuning datasets'), {
    kind: 'skip',
    message: 'unavailable: roms: no tuning datasets',
  });
  assert.deepEqual(testOutcome('fail', 'boom'), { kind: 'fail' });
});

test('a report record is one line with a fixed key order and sorted inputs', () => {
  const line = formatRecord({
    id: 'g1.x',
    phase: 1,
    tier: 'ci',
    verdict: 'pass',
    detail: '',
    inputs: { z: '1', a: '2' },
    missing: [],
    ms: 12.6,
  });
  assert.equal(line, '{"id":"g1.x","phase":1,"tier":"ci","verdict":"pass","detail":"","inputs":{"a":"2","z":"1"},"missing":[],"ms":13}\n');
});

test('lastJson reads the last non-empty line', () => {
  assert.deepEqual(lastJson('noise\n{"a":1}\n{"b":2}\n\n'), { b: 2 });
  assert.throws(() => lastJson('\n  \n'));
});

test('jsonLines reads every non-empty line and names a bad one', () => {
  assert.deepEqual(jsonLines('{"a":1}\n\n{"b":2}\n'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(jsonLines(''), []);
  assert.throws(() => jsonLines('{"a":1}\nnot json\n'), /line 2 is not JSON/);
});

test('realInputs are checked on the real tier only, after inputs, each once', () => {
  const spec = { inputs: ['toolchain', 'roms'] as const, realInputs: ['roms', 'elfs'] as const };
  assert.deepEqual(inputsFor(spec, 'ci'), ['toolchain', 'roms']);
  assert.deepEqual(inputsFor(spec, 'real'), ['toolchain', 'roms', 'elfs']);
  assert.deepEqual(inputsFor({ realInputs: ['roms'] }, 'ci'), []);
  assert.deepEqual(inputsFor({}, 'real'), []);
});

test('fixtures are the bench/dataset/synthetic/<name>/build/<name>.gba files, sorted by name', async () => {
  const root = '/repo/bench/dataset/synthetic';
  const io = fakeIo({
    [`${root}/far-jump/build/far-jump.gba`]: 'r',
    [`${root}/far-jump/expect.json`]: '{}',
    [`${root}/b-stub/build/b-stub.gba`]: 'r',
    [`${root}/b-stub/build/other.gba`]: 'not the fixture rom',
    [`${root}/no-build/expect.json`]: '{}',
  });
  assert.deepEqual(await listFixtures('/repo', io), [
    {
      name: 'b-stub',
      dir: `${root}/b-stub`,
      rom: `${root}/b-stub/build/b-stub.gba`,
      elf: `${root}/b-stub/build/b-stub.elf`,
      expect: `${root}/b-stub/expect.json`,
    },
    {
      name: 'far-jump',
      dir: `${root}/far-jump`,
      rom: `${root}/far-jump/build/far-jump.gba`,
      elf: `${root}/far-jump/build/far-jump.elf`,
      expect: `${root}/far-jump/expect.json`,
    },
  ]);
  assert.deepEqual(await listFixtures('/elsewhere', io), []);
});

test('exec never passes NODE_TEST_CONTEXT on, so a nested node --test really runs', async () => {
  const probe = await exec(process.execPath, ['-e', 'process.stdout.write(String(process.env.NODE_TEST_CONTEXT))']);
  assert.equal(probe.stdout, 'undefined');
  const kept = await exec(process.execPath, ['-e', 'process.stdout.write(String(process.env.NODE_TEST_CONTEXT))'], {
    env: { NODE_TEST_CONTEXT: 'explicit' },
  });
  assert.equal(kept.stdout, 'explicit');
});

test('withLock serialises holders and takes over a lock whose owner has exited', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'romlift-lock-'));
  try {
    let inside = 0;
    let overlap = false;
    const hold = (value: number) =>
      withLock(
        'unit',
        async () => {
          inside++;
          if (inside > 1) overlap = true;
          await new Promise((resolve) => setTimeout(resolve, 20));
          inside--;
          return value;
        },
        { dir, pollMs: 5 },
      );
    assert.deepEqual(await Promise.all([hold(1), hold(2), hold(3)]), [1, 2, 3]);
    assert.equal(overlap, false);

    // A lock left behind by a process that has exited.
    const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    const deadPid = Number(gone.stdout);
    const stale = await withLock('stale', async () => readdirSync(dir)[0] ?? '', { dir });
    assert.notEqual(stale, '');
    mkdirSync(path.join(dir, stale));
    writeFileSync(path.join(dir, stale, 'owner'), `${deadPid}\n`);
    assert.equal(await withLock('stale', async () => 'taken over', { dir, pollMs: 5 }), 'taken over');
    assert.deepEqual(readdirSync(dir), [], 'every lock is released');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('datasets parse, and split into tuning and sealed', () => {
  const parsed = parseDataset(
    { name: 'sa2', rom: 'sa2/sa2.gba', elf: 'sa2/sa2.elf', sha1: 'ab', elfSha256: 'cd', heldout: false, revealed: [], labels: [] },
    'sa2.json',
  );
  assert.deepEqual(parsed, { name: 'sa2', rom: 'sa2/sa2.gba', elf: 'sa2/sa2.elf', sha1: 'ab', elfSha256: 'cd', heldout: false, revealed: [] });
  assert.throws(() => parseDataset({ name: 'x', rom: 'r', elf: 'e', sha1: 's' }, 'x.json'), /heldout/);
  assert.throws(() => parseDataset({ name: '', rom: 'r', elf: 'e', sha1: 's', heldout: false }, 'x.json'), /name/);
  const sealed = dataset({ name: 'h', heldout: true });
  const revealed = dataset({ name: 'r', heldout: true, revealed: [{ at: 'x' }] });
  const tuning = dataset({ name: 't' });
  assert.deepEqual(splitDatasets([sealed, revealed, tuning]), { tuning: [revealed, tuning], sealed: [sealed] });
});

const env = (tuning: readonly DatasetRef[], sealed: readonly DatasetRef[] = []): InputEnv => ({
  repoRoot: '/repo',
  benchRoot: '/bench',
  pocRoot: '/bench/romlift-poc',
  tuning,
  sealed,
});

test('roms and elfs: unavailable with no tuning datasets, a missing file or a digest mismatch', async () => {
  const files = { '/bench/a.gba': 'rom-a', '/bench/a.elf': 'elf-a', '/bench/h.gba': 'rom-h' };
  const io = fakeIo(files);
  assert.deepEqual(await checkInput('roms', env([]), io), { available: false, detail: 'no tuning datasets' });
  assert.deepEqual(await checkInput('elfs', env([]), io), { available: false, detail: 'no tuning datasets' });

  const a = dataset({ name: 'a', sha1: sha('sha1', 'rom-a'), elfSha256: sha('sha256', 'elf-a') });
  const roms = await checkInput('roms', env([a]), io);
  assert.equal(roms.available, true);
  assert.match(roms.digest ?? '', /^[0-9a-f]{64}$/);
  assert.equal((await checkInput('elfs', env([a]), io)).available, true);

  const wrong = dataset({ name: 'a', sha1: '00' });
  assert.match((await checkInput('roms', env([wrong]), io)).detail, /a: a\.gba has sha1 [0-9a-f]+, the dataset records 00/);
  assert.match((await checkInput('elfs', env([wrong]), io)).detail, /a: the dataset records no elfSha256/);
  // Sealed datasets are checked too: their ROM must be present for any gate that declares roms.
  const missing = dataset({ name: 'm', heldout: true, sha1: 'x' });
  assert.deepEqual(await checkInput('roms', env([a], [missing]), io), { available: false, detail: 'm: m.gba is missing' });
});

test('objects: sha256 over sorted relative path, NUL and bytes of every .o', async () => {
  const files = { '/bench/o/b.o': 'B', '/bench/o/sub/a.o': 'A', '/bench/o/notes.txt': 'ignored' };
  const io = fakeIo(files);
  const expected = createHash('sha256').update('b.o').update('\0').update('B').update('sub/a.o').update('\0').update('A').digest('hex');
  assert.equal(await objectsDigest('/bench/o', io), expected);
  const good = dataset({ name: 'a', objectsDir: 'o', objectsDigest: expected });
  assert.equal((await checkInput('objects', env([good]), io)).available, true);
  assert.equal((await checkInput('objects', env([dataset({ name: 'a' })]), io)).detail, 'no dataset records objectsDir');
  assert.match((await checkInput('objects', env([{ ...good, objectsDigest: 'f' }]), io)).detail, /objects digest/);
  assert.match((await checkInput('objects', env([{ ...good, objectsDir: 'gone' }]), io)).detail, /gone is missing/);
});

test('poc: the checkout must match every digest of poc-source.json', async () => {
  const pinned = JSON.stringify({ files: { 'src/a.ts': sha('sha256', 'A') }, digest: 'pocdigest' });
  const good = fakeIo({ '/bench/romlift-poc/src/a.ts': 'A', '/repo/bench/baseline/poc-source.json': pinned });
  assert.deepEqual(await checkInput('poc', env([]), good), { available: true, detail: '', digest: 'pocdigest' });
  const changed = fakeIo({ '/bench/romlift-poc/src/a.ts': 'B', '/repo/bench/baseline/poc-source.json': pinned });
  assert.equal((await checkInput('poc', env([]), changed)).detail, 'src/a.ts differs from the pinned PoC source');
  const unpinned = fakeIo({ '/bench/romlift-poc/src/a.ts': 'A' });
  assert.equal((await checkInput('poc', env([]), unpinned)).detail, 'bench/baseline/poc-source.json is missing');
  assert.equal((await checkInput('poc', env([]), fakeIo({}))).detail, '/bench/romlift-poc is missing');
});

test('toolchain: as, ld and objcopy must run', async () => {
  const version = (name: string): ExecResult => ({ code: 0, stdout: `GNU ${name} 2.43\nCopyright`, stderr: '' });
  const all = {
    'arm-none-eabi-as --version': version('as'),
    'arm-none-eabi-ld --version': version('ld'),
    'arm-none-eabi-objcopy --version': version('objcopy'),
  };
  assert.equal((await checkInput('toolchain', env([]), fakeIo({}, all))).available, true);
  const { 'arm-none-eabi-ld --version': _ld, ...noLd } = all;
  assert.equal((await checkInput('toolchain', env([]), fakeIo({}, noLd))).detail, 'arm-none-eabi-ld --version exited 127');
});

test('klonoa: the checkout must be the top of a git work tree', async () => {
  const dir = '/bench/klonoa-empire-of-dreams';
  const files = { [`${dir}/Makefile`]: '' };
  const checkout = fakeIo(files, {
    [`git -C ${dir} rev-parse --show-toplevel`]: { code: 0, stdout: `${dir}\n`, stderr: '' },
    [`git -C ${dir} rev-parse HEAD`]: { code: 0, stdout: '693ccb7\n', stderr: '' },
  });
  assert.deepEqual(await checkInput('klonoa', env([]), checkout), { available: true, detail: '', digest: '693ccb7' });
  const nested = fakeIo(files, { [`git -C ${dir} rev-parse --show-toplevel`]: { code: 0, stdout: '/bench\n', stderr: '' } });
  assert.match((await checkInput('klonoa', env([]), nested)).detail, /is not a git checkout/);
  assert.match((await checkInput('klonoa', env([]), fakeIo({}))).detail, /is missing/);
});

test('gate() registers one test per gate and appends one NDJSON line per recorded verdict', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'romlift-gate-'));
  try {
    const gateUrl = pathToFileURL(path.join(repoRoot, 'test', 'gates', 'gate.ts')).href;
    const file = path.join(dir, 'gates.test.ts');
    writeFileSync(
      file,
      [
        `import { gate } from ${JSON.stringify(gateUrl)};`,
        `gate({ id: 'g1.passes', phase: 1, tier: 'ci', needs: [], async run(cx) { cx.note('fine'); cx.digest('extra', 'abc'); } });`,
        `gate({ id: 'g1.fails', phase: 1, tier: 'both', needs: [], async run() { throw new Error('broken'); } });`,
        `gate({ id: 'g1.waits', phase: 1, tier: 'ci', needs: ['noSuchExportAnywhere'], async run() {} });`,
        `gate({ id: 'g1.elsewhere', phase: 1, tier: 'real', needs: [], async run() {} });`,
        `gate({ id: 'g1.later', phase: 1, tier: 'both', needs: [], realInputs: ['klonoa'], async run(cx) { cx.note(\`fixtures \${Array.isArray(cx.fixtures)}\`); } });`,
        '',
      ].join('\n'),
    );
    const reportFile = path.join(dir, 'report.ndjson');
    // The outer runner's NODE_TEST_CONTEXT would turn the inner run into a subtest stream.
    const { NODE_TEST_CONTEXT: _context, ...outer } = process.env;
    let output = '';
    try {
      output = execFileSync(process.execPath, ['--conditions=source', '--test', '--test-reporter=tap', file], {
        cwd: repoRoot,
        env: { ...outer, ROMLIFT_GATE_REPORT: reportFile, ROMLIFT_GATE_TIER: 'ci' },
        encoding: 'utf8',
      });
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    const records = readFileSync(reportFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; verdict: string; detail: string; inputs: Record<string, string>; missing: string[] });
    const byId = new Map(records.map((r) => [r.id, r]));
    assert.equal(records.length, 4, 'the real-tier gate records nothing under the ci tier');
    assert.deepEqual([byId.get('g1.later')?.verdict, byId.get('g1.later')?.detail], ['pass', 'fixtures true'], 'realInputs are not checked on ci');
    assert.deepEqual([byId.get('g1.passes')?.verdict, byId.get('g1.passes')?.detail], ['pass', 'fine']);
    assert.deepEqual(byId.get('g1.passes')?.inputs, { extra: 'abc' });
    assert.deepEqual([byId.get('g1.fails')?.verdict, byId.get('g1.fails')?.detail], ['fail', 'broken']);
    assert.deepEqual([byId.get('g1.waits')?.verdict, byId.get('g1.waits')?.missing], ['pending', ['noSuchExportAnywhere']]);
    assert.match(output, /not ok \d+ - g1\.fails/);
    assert.match(output, /ok \d+ - g1\.waits # SKIP pending: not exported yet: noSuchExportAnywhere/);
    assert.match(output, /ok \d+ - g1\.elsewhere # SKIP/);
    assert.match(output, /^ok \d+ - g1\.passes$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
