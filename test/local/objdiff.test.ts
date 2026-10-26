// The objdiff family's oracle on real tools (architecture §8.4 "objdiff", D34: "A fixture test misnames one
// pool word and requires the gate to fail"): the self-authored test/fixtures/objdiff sources are assembled
// afresh with the system arm-none-eabi-as, and the pinned objdiff-cli compares them. PoolFunc, whose base
// names gOther in the one pool word where the reference names gTarget, must give a gated difference (D34 as amended:
// one over a ceiling of 0 fails the gate, D102); SameFunc, identical on both sides, is the control and gives none.
//
// It runs in a child process that loads bench/src/objdiff.ts, objdiff-cli.ts and romlift's entry points by
// path (test/local imports only romlift's entry points, D37). Without objdiff-cli at the pinned version or
// without binutils it is `unavailable`, or fails when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';

const CHILD = `
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = process.env.ROMLIFT_OBJDIFF_REPO;
const benchRoot = process.env.ROMLIFT_OBJDIFF_BENCH_ROOT;
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const cli = await load('bench/src/objdiff-cli.ts');
const family = await load('bench/src/objdiff.ts');
const classes = await load('bench/src/objdiff-classes.ts');
const { assembleWithBinutils, findBinutils } = await import('romlift/node');
const { DIALECT } = await import('romlift/isa');
const print = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const tools = findBinutils(process.env);
if ('code' in tools) { print({ unavailable: 'binutils (' + tools.message + ')' }); process.exit(0); }
const mainRepoRoot = await cli.mainRepoRootOf(repo);
const found = await cli.findObjdiff(process.env, benchRoot, { repoRoot: repo, ...(mainRepoRoot === undefined ? {} : { mainRepoRoot }) });
const pinned = await cli.readPinnedObjdiffVersion(repo);
const version = found === undefined ? null : await cli.objdiffVersion(found.bin);
if (found === undefined || version !== pinned) { print({ unavailable: 'objdiff-cli ' + (pinned ?? '(no pin)') + (found === undefined ? ' not found' : ' (found ' + (version ?? 'nothing runnable') + ' at ' + found.bin + ')') }); process.exit(0); }
const dir = mkdtempSync(join(tmpdir(), 'romlift-objdiff-local-'));
try {
  const objects = {};
  for (const side of ['reference', 'base']) {
    const source = readFileSync(join(repo, 'test', 'fixtures', 'objdiff', side + '.s'), 'utf8');
    const assembled = await assembleWithBinutils(source, { tools, files: { 'include/macros.inc': DIALECT.macrosInc } });
    if (!assembled.ok) throw new Error(side + '.s did not assemble: ' + assembled.stderr);
    objects[side] = join(dir, side + '.o');
    writeFileSync(objects[side], assembled.object);
  }
  const diffed = await cli.diffObjects(found.bin, objects.reference, objects.base);
  if (!diffed.ok) throw new Error(diffed.error);
  const verdict = (name) => family.objdiffVerdict([{ name, diff: diffed.value.functions.find((f) => f.name === name) }], classes.nameAddresses([]));
  print({ version, pool: verdict('PoolFunc'), same: verdict('SameFunc') });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
`;

interface Verdict {
  readonly scored: number;
  readonly differences: Readonly<Record<string, number>>;
  readonly examples: readonly { readonly function: string; readonly kind: string; readonly detail: string }[];
  readonly classes: { readonly counts: Readonly<Record<string, number>>; readonly gated: number; readonly uncompared: number; readonly gatedExamples: readonly unknown[] };
}

type ChildLine = { readonly unavailable: string } | { readonly version: string; readonly pool: Verdict; readonly same: Verdict };

function runChild(): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--conditions=source', '--input-type=module', '--eval', CHILD],
      { cwd: REPO, env: { ...process.env, ROMLIFT_OBJDIFF_REPO: REPO, ROMLIFT_OBJDIFF_BENCH_ROOT: BENCH_ROOT }, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr }),
    );
  });
}

test('the pinned objdiff-cli gates a misnamed pool word and finds no difference in an identical function', async (t) => {
  const run = await runChild();
  assert.equal(run.code, 0, run.stderr);
  const line = JSON.parse(run.stdout.trimEnd().split('\n').at(-1) ?? '') as ChildLine;
  if ('unavailable' in line) {
    if (REQUIRE) assert.fail(`unavailable: ${line.unavailable}`);
    t.skip(`unavailable: ${line.unavailable}`);
    return;
  }
  t.diagnostic(`${line.version}: PoolFunc ${JSON.stringify(line.pool.differences)}`);
  assert.deepEqual(line.pool.differences, { relocation: 1 });
  assert.deepEqual(line.pool.examples.map((e) => [e.function, e.kind, e.detail]), [['PoolFunc', 'relocation', '+0x1c R_ARM_ABS32: gTarget | gOther']]);
  assert.equal(line.pool.classes.gated, 1, 'a misnamed pool word is gated under D34 as amended (D102)');
  assert.deepEqual(line.same, { scored: 1, differences: {}, examples: [], classes: { counts: {}, gated: 0, uncompared: 0, gatedExamples: [] } });
});
