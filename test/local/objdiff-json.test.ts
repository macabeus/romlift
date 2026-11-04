// objdiff.json and expected/ on real tools (architecture §6.8, roadmap 6.F, D92, D101 a): on a project as a user builds
// it (`init`, `./setup.sh`, `make`, `make expected`), the pinned objdiff-cli loads the objdiff writer's objdiff.json
// (`report generate`): each C module's base object, which agbcc built from its INCLUDE_ASM stubs, against the expected
// writer's target, the same assembly assembled as it is (phase-6.md Q12, the owner's option (b)).
//   - c-data (a fixture): every unit at 100%; objdiff.json lists every C module and no other, every listed path exists.
//   - sa1 ($ROMLIFT_BENCH_ROOT/sa1.gba, the ROM the review measured Q12 on) and klonoa (a tuning ROM): every function
//     of every unit at 100%, none below; the counts are printed.
//
// objdiff-cli is found as the bench finds it (ROMLIFT_OBJDIFF, the repository's bench/.local/objdiff-target build, the
// main checkout's, PATH, then $ROMLIFT_BENCH_ROOT/objdiff), through a child process that loads bench/src/objdiff-cli.ts
// by path (test/local imports only romlift's entry points and node, D37), at the version bench/tools/objdiff.version
// pins. agbcc comes from ROMLIFT_AGBCC, else bench/.local/agbcc, else $ROMLIFT_BENCH_ROOT/pokeemerald/tools/agbcc, else
// setup.sh builds it at the pin (network). Without objdiff-cli or binutils the test is `unavailable`, or fails when
// ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const FIXTURE = path.join(REPO, 'bench', 'dataset', 'synthetic', 'c-data');

/** Finds objdiff-cli as the bench does; prints {bin} or {unavailable}. */
const FIND = `
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.env.ROMLIFT_OBJDIFF_REPO;
const benchRoot = process.env.ROMLIFT_OBJDIFF_BENCH_ROOT;
const cli = await import(pathToFileURL(join(repo, 'bench/src/objdiff-cli.ts')).href);
const mainRepoRoot = await cli.mainRepoRootOf(repo);
const found = await cli.findObjdiff(process.env, benchRoot, { repoRoot: repo, ...(mainRepoRoot === undefined ? {} : { mainRepoRoot }) });
const pinned = await cli.readPinnedObjdiffVersion(repo);
const version = found === undefined ? null : await cli.objdiffVersion(found.bin);
process.stdout.write(JSON.stringify(found === undefined || version !== pinned ? { unavailable: 'objdiff-cli ' + (pinned ?? '(no pin)') + (found === undefined ? ' not found' : ' (found ' + (version ?? 'nothing runnable') + ' at ' + found.bin + ')') } : { bin: found.bin }) + '\\n');
`;

interface Ran {
  readonly code: number;
  readonly out: string;
  readonly stdout: string;
}

/** The project's model in `dir` as romlift/model-json@1 NDJSON, in process (readProject, confirmProject, encodeModel; D108). */
async function projectModel(dir: string): Promise<string> {
  const { confirmProject, encodeModel } = await import('romlift');
  const { readProject } = await import('romlift/node');
  const read = await readProject(dir, { withoutC: true });
  assert.ok(read.ok, `readProject ${dir}: ${read.ok ? '' : read.diagnostics.map((d) => d.message).join('; ')}`);
  const confirmed = confirmProject(read.value.inputs);
  assert.ok(confirmed.ok, `confirmProject ${dir}: ${confirmed.ok ? '' : confirmed.diagnostics.map((d) => d.message).join('; ')}`);
  return [...encodeModel(confirmed.model, read.value.inputs.rom)].join('');
}

function run(command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(command, [...args], { cwd, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, out: `${stdout}${stderr}`, stdout });
    });
  });
}

function tail(ran: Ran, lines = 25): string {
  return ran.out.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The first agbcc build found (a directory holding bin/agbcc), or undefined: setup.sh then builds it. */
function prebuiltAgbcc(): string | undefined {
  const env = process.env['ROMLIFT_AGBCC'];
  const candidates = [...(env ? [path.resolve(REPO, env)] : []), path.join(REPO, 'bench', '.local', 'agbcc'), path.join(BENCH_ROOT, 'romlift', 'bench', '.local', 'agbcc'), path.join(BENCH_ROOT, 'pokeemerald', 'tools', 'agbcc')];
  return candidates.find((dir) => existsSync(path.join(dir, 'bin', 'agbcc')));
}

async function objdiffCli(): Promise<{ readonly bin: string } | { readonly unavailable: string }> {
  const found = await run(process.execPath, ['--conditions=source', '--input-type=module', '-e', FIND], REPO, { ROMLIFT_OBJDIFF_REPO: REPO, ROMLIFT_OBJDIFF_BENCH_ROOT: BENCH_ROOT });
  if (found.code !== 0) return { unavailable: `the objdiff-cli lookup exited ${found.code}: ${tail(found, 5)}` };
  return JSON.parse(found.stdout.trim().split('\n').pop() ?? '{}') as { readonly bin: string } | { readonly unavailable: string };
}

interface ObjdiffJson {
  readonly units: readonly { readonly name: string; readonly target_path: string; readonly base_path: string; readonly metadata: { readonly source_path: string } }[];
}

interface Measures {
  readonly fuzzy_match_percent?: number;
  readonly total_code?: string;
  readonly matched_code_percent?: number;
}

interface Report {
  readonly units: readonly { readonly name: string; readonly measures?: Measures }[];
}

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-objdiff-json-'));
after(() => rm(TMP, { recursive: true, force: true }));

const tools = await objdiffCli();
const binutils = await run('arm-none-eabi-as', ['--version'], REPO);
const unavailable = 'unavailable' in tools ? `unavailable: ${tools.unavailable}` : binutils.code !== 0 ? 'unavailable: arm-none-eabi-as' : undefined;

test('c-data: init, ./setup.sh, make and make expected, then objdiff-cli reports every unit of objdiff.json at 100%', { skip: REQUIRE ? false : (unavailable ?? false), timeout: 30 * 60_000 }, async () => {
  assert.equal(unavailable, undefined, unavailable);
  if ('unavailable' in tools) return;
  const cli = path.join(TMP, 'romlift');
  await writeFile(cli, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${path.join(REPO, 'src', 'cli', 'main.ts')}' "$@"\n`);
  await chmod(cli, 0o755);
  const dir = path.join(TMP, 'c-data');
  await mkdir(dir, { recursive: true });
  await copyFile(path.join(FIXTURE, 'build', 'c-data.gba'), path.join(dir, 'baserom.gba'));
  const env = { ROMLIFT_CLI: cli };
  const init = await run(cli, ['init', 'baserom.gba', '--json'], dir);
  assert.equal(init.code, 0, tail(init));
  const prebuilt = prebuiltAgbcc();
  for (const part of ['bin', 'include', 'lib']) if (prebuilt !== undefined && existsSync(path.join(prebuilt, part))) await cp(path.join(prebuilt, part), path.join(dir, 'tools', 'agbcc', part), { recursive: true });
  for (const [command, args] of [['./setup.sh', []], ['make', []], ['make', ['expected']]] as const) {
    const ran = await run(command, args, dir, env);
    assert.equal(ran.code, 0, `${command} ${args.join(' ')}:\n${tail(ran)}`);
  }

  const config = JSON.parse(await readFile(path.join(dir, 'objdiff.json'), 'utf8')) as ObjdiffJson;
  const header = JSON.parse((await projectModel(dir)).split('\n')[0] ?? '{}') as { readonly modules: readonly { readonly name: string; readonly kind: string }[] };
  assert.deepEqual(
    config.units.map((u) => u.name),
    header.modules.filter((m) => m.kind === 'c').map((m) => m.name),
    'one unit per C module, in ROM order',
  );
  assert.ok(config.units.length > 0, 'the fixture has a C module');
  for (const unit of config.units) for (const p of [unit.target_path, unit.base_path, unit.metadata.source_path]) assert.ok(existsSync(path.join(dir, p)), `${unit.name}: ${p} exists`);

  const out = path.join(TMP, 'report.json');
  const report = await run(tools.bin, ['report', 'generate', '-p', dir, '-o', out, '-f', 'json'], dir);
  assert.equal(report.code, 0, tail(report));
  const read = JSON.parse(await readFile(out, 'utf8')) as Report;
  assert.deepEqual(read.units.map((u) => u.name).sort(), config.units.map((u) => u.name).sort(), 'objdiff-cli reports every unit of objdiff.json');
  for (const unit of read.units) {
    assert.equal(unit.measures?.fuzzy_match_percent, 100, `${unit.name}: ${JSON.stringify(unit.measures)}`);
    if (Number(unit.measures?.total_code ?? 0) > 0) assert.equal(unit.measures?.matched_code_percent, 100, `${unit.name}: ${JSON.stringify(unit.measures)}`);
  }
});

const KLONOA = JSON.parse(await readFile(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as { readonly rom: string };
const UNTOUCHED: readonly { readonly name: string; readonly rom: string }[] = [
  { name: 'sa1', rom: path.join(BENCH_ROOT, 'sa1.gba') },
  { name: 'klonoa', rom: path.join(BENCH_ROOT, KLONOA.rom) },
];

for (const project of UNTOUCHED) {
  test(`${project.name}: an untouched project scores every function at 100% (Q12)`, { skip: REQUIRE ? false : (unavailable ?? (existsSync(project.rom) ? false : `unavailable: rom ${project.rom}`)), timeout: 60 * 60_000 }, async (t) => {
    assert.equal(unavailable, undefined, unavailable);
    assert.ok(existsSync(project.rom), `no ${project.rom}`);
    if ('unavailable' in tools) return;
    const cli = path.join(TMP, `romlift-${project.name}`);
    await writeFile(cli, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${path.join(REPO, 'src', 'cli', 'main.ts')}' "$@"\n`);
    await chmod(cli, 0o755);
    const dir = path.join(TMP, project.name);
    await mkdir(dir, { recursive: true });
    await copyFile(project.rom, path.join(dir, 'baserom.gba'));
    const init = await run(cli, ['init', 'baserom.gba', '--json'], dir);
    assert.equal(init.code, 0, tail(init));
    const prebuilt = prebuiltAgbcc();
    for (const part of ['bin', 'include', 'lib']) if (prebuilt !== undefined && existsSync(path.join(prebuilt, part))) await cp(path.join(prebuilt, part), path.join(dir, 'tools', 'agbcc', part), { recursive: true });
    for (const [command, args] of [['./setup.sh', []], ['make', []], ['make', ['expected']]] as const) {
      const ran = await run(command, args, dir, { ROMLIFT_CLI: cli });
      assert.equal(ran.code, 0, `${command} ${args.join(' ')}:\n${tail(ran)}`);
    }
    const out = path.join(TMP, `${project.name}-report.json`);
    const report = await run(tools.bin, ['report', 'generate', '-p', dir, '-o', out, '-f', 'json'], dir);
    assert.equal(report.code, 0, tail(report));
    const read = JSON.parse(await readFile(out, 'utf8')) as { readonly units: readonly { readonly name: string; readonly functions?: readonly { readonly name: string; readonly fuzzy_match_percent?: number }[] }[] };
    const functions = read.units.flatMap((u) => (u.functions ?? []).map((f) => ({ name: `${u.name}/${f.name}`, percent: f.fuzzy_match_percent ?? 0 })));
    const below = functions.filter((f) => f.percent < 100);
    t.diagnostic(`${project.name}: ${below.length} of ${functions.length} functions in ${read.units.length} units below 100%`);
    assert.ok(functions.length > 0, 'objdiff-cli reports functions');
    assert.deepEqual(below.map((f) => `${f.name} ${f.percent}%`).slice(0, 20), [], `${below.length} functions below 100%`);
  });
}
