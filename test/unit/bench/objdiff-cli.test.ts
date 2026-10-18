// bench/src/objdiff-cli.ts: the parser on the committed output of objdiff-cli's one-shot diff of two
// self-authored objects (test/fixtures/objdiff, build.sh), so no binary is needed; the lookup order and the
// version reader on stub executables; and, when the pinned objdiff-cli is installed, that a fresh run on the
// fixture objects still parses to what the committed output parses to.
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseElf } from 'romlift';

import {
  diffObjects,
  findObjdiff,
  functionOutcome,
  mainRepoRootOf,
  OBJDIFF_CHECKOUT_BUILD,
  OBJDIFF_LOCAL_BUILD,
  objdiffDiffArgs,
  objdiffVersion,
  parseObjdiffDiff,
  readPinnedObjdiffVersion,
  type FunctionDiff,
  type ReferenceObject,
} from '../../../bench/src/objdiff-cli.ts';
import { objectRelocations } from '../../../bench/src/objects.ts';
import { withTempDir } from './fixtures.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES = join(REPO_ROOT, 'test', 'fixtures', 'objdiff');

async function reference(): Promise<ReferenceObject> {
  const bytes = new Uint8Array(await readFile(join(FIXTURES, 'reference.o')));
  const elf = parseElf(bytes);
  const relocations = objectRelocations(bytes);
  assert.ok(elf.ok && relocations.ok);
  return { symbols: elf.value.symbols, relocations: relocations.value };
}

async function committed(): Promise<readonly FunctionDiff[]> {
  const parsed = parseObjdiffDiff(JSON.parse(await readFile(join(FIXTURES, 'diff.json'), 'utf8')) as unknown, await reference());
  assert.ok(parsed.ok);
  return parsed.value.functions;
}

test('the committed diff parses to one row per reference function, each with its differences', async () => {
  const functions = await committed();
  assert.deepEqual(
    functions.map((f) => [f.name, f.offset, f.size, f.paired, f.matchPercent, functionOutcome(f)]),
    [
      ['InsnFunc', 0x0c, 6, true, 80, 'differs'],
      ['PoolFunc', 0x14, 12, true, 99, 'differs'],
      ['SameFunc', 0x00, 12, true, 100, 'match'],
      ['SectFunc', 0x20, 12, true, 99, 'unnamed-target'],
    ],
  );
  const [insn, pool, same, sect] = functions;
  assert.deepEqual(insn?.instructionDifferences, [{ offset: 0x0e, kind: 'replace', reference: 'add r0, r1', base: 'sub r0, r1' }]);
  assert.deepEqual(insn?.relocationDifferences, []);
  assert.deepEqual(pool?.instructionDifferences, []);
  assert.deepEqual(pool?.relocationDifferences, [{ offset: 0x1c, kind: 'arg-mismatch', type: 'R_ARM_ABS32', reference: { name: 'gTarget', symbol: 'named' }, base: 'gOther' }]);
  assert.deepEqual([same?.instructionDifferences, same?.relocationDifferences], [[], []]);
  assert.deepEqual(sect?.relocationDifferences, [{ offset: 0x28, kind: 'arg-mismatch', type: 'R_ARM_ABS32', reference: { name: '.rodata', symbol: 'section' }, base: 'sectData' }]);
});

test('functionOutcome: unpaired, and a relocation difference with no reference side differs', () => {
  const base: FunctionDiff = { name: 'f', offset: 0, size: 4, paired: true, matchPercent: 100, instructionDifferences: [], relocationDifferences: [] };
  assert.equal(functionOutcome(base), 'match');
  assert.equal(functionOutcome({ ...base, paired: false, matchPercent: null }), 'unpaired');
  assert.equal(functionOutcome({ ...base, matchPercent: 99.5 }), 'differs');
  assert.equal(functionOutcome({ ...base, matchPercent: 99, relocationDifferences: [{ offset: 0, kind: 'arg-mismatch', type: 'R_ARM_ABS32', reference: null, base: 'x' }] }), 'differs');
  assert.equal(
    functionOutcome({
      ...base,
      matchPercent: 99,
      relocationDifferences: [{ offset: 0, kind: 'arg-mismatch', type: 'R_ARM_ABS32', reference: { name: '.data', symbol: 'section' }, base: 'x' }],
      instructionDifferences: [{ offset: 2, kind: 'replace', reference: 'a', base: 'b' }],
    }),
    'differs',
  );
});

test('parseObjdiffDiff refuses a value without a reference side and reads an unpaired function', async () => {
  const ref = await reference();
  assert.equal(parseObjdiffDiff([], ref).ok, false);
  assert.equal(parseObjdiffDiff({ right: {} }, ref).ok, false);
  const parsed = parseObjdiffDiff({ left: { symbols: [{ name: 'Lonely', address: '16', size: '8', kind: 'SYMBOL_FUNCTION' }, { name: 'gData', kind: 'SYMBOL_OBJECT' }] } }, ref);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.functions, [{ name: 'Lonely', offset: 16, size: 8, paired: false, matchPercent: null, instructionDifferences: [], relocationDifferences: [] }]);
});

test('objdiffDiffArgs is the one-shot JSON diff of the reference (-1) against the base (-2) with the pinned options', () => {
  assert.deepEqual(objdiffDiffArgs('ref.o', 'base.o'), [
    '--no-color',
    'diff',
    '-1',
    'ref.o',
    '-2',
    'base.o',
    '-o',
    '-',
    '--format',
    'json',
    '-c',
    'functionRelocDiffs=name_address',
    '-c',
    'arm.archVersion=v4t',
  ]);
});

async function stub(file: string, version: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho '${version}'\necho 'second line'\n`);
  await chmod(file, 0o755);
}

test('findObjdiff: ROMLIFT_OBJDIFF, the repository build, the main checkout build, the PATH, then the bench root', async () => {
  await withTempDir('romlift-objdiff-', async (root) => {
    const repo = join(root, 'wt');
    const main = join(root, 'main');
    const bench = join(root, 'bench');
    const bin = join(root, 'bin');
    await mkdir(bin, { recursive: true });
    const env = { PATH: bin };
    assert.equal(await findObjdiff(env, bench, { repoRoot: repo, mainRepoRoot: main }), undefined);
    await stub(join(bench, OBJDIFF_CHECKOUT_BUILD), 'objdiff-cli 0.0.1');
    assert.deepEqual(await findObjdiff(env, bench, { repoRoot: repo }), { bin: join(bench, OBJDIFF_CHECKOUT_BUILD), source: 'bench-root' });
    await stub(join(bin, 'objdiff-cli'), 'objdiff-cli 0.0.2');
    assert.deepEqual(await findObjdiff(env, bench, { repoRoot: repo }), { bin: join(bin, 'objdiff-cli'), source: 'path' });
    await stub(join(main, OBJDIFF_LOCAL_BUILD), 'objdiff-cli 0.0.3');
    assert.deepEqual(await findObjdiff(env, bench, { repoRoot: repo, mainRepoRoot: main }), { bin: join(main, OBJDIFF_LOCAL_BUILD), source: 'main-repo-build' });
    await stub(join(repo, OBJDIFF_LOCAL_BUILD), 'objdiff-cli 0.0.4');
    assert.deepEqual(await findObjdiff(env, bench, { repoRoot: repo, mainRepoRoot: main }), { bin: join(repo, OBJDIFF_LOCAL_BUILD), source: 'repo-build' });
    const named = join(root, 'nowhere', 'objdiff-cli');
    assert.deepEqual(await findObjdiff({ ...env, ROMLIFT_OBJDIFF: named }, bench, { repoRoot: repo }), { bin: named, source: 'env' });
    assert.equal(await objdiffVersion(join(repo, OBJDIFF_LOCAL_BUILD)), 'objdiff-cli 0.0.4');
    assert.equal(await objdiffVersion(named), null);
  });
});

test('bench/tools/objdiff.version pins the objdiff-cli that produced the committed fixture output', async () => {
  const pinned = await readPinnedObjdiffVersion(REPO_ROOT);
  assert.match(pinned ?? '', /^objdiff-cli \d+\.\d+\.\d+/);
  const info = await readFile(join(FIXTURES, 'build-info.txt'), 'utf8');
  assert.ok(info.includes(`# objdiff-cli: ${pinned ?? ''}\n`), `build-info.txt records another objdiff-cli than ${pinned ?? ''}`);
  await withTempDir('romlift-objdiff-pin-', async (root) => {
    assert.equal(await readPinnedObjdiffVersion(root), null);
  });
});

test('a fresh run of the pinned objdiff-cli on the fixture objects parses as the committed output does', async (t) => {
  const mainRepoRoot = await mainRepoRootOf(REPO_ROOT);
  const found = await findObjdiff(process.env, dirname(REPO_ROOT), { repoRoot: REPO_ROOT, ...(mainRepoRoot === undefined ? {} : { mainRepoRoot }) });
  const pinned = await readPinnedObjdiffVersion(REPO_ROOT);
  if (found === undefined || (await objdiffVersion(found.bin)) !== pinned) {
    t.skip(`the pinned ${pinned ?? 'objdiff-cli'} is not installed`);
    return;
  }
  const fresh = await diffObjects(found.bin, join(FIXTURES, 'reference.o'), join(FIXTURES, 'base.o'));
  assert.ok(fresh.ok);
  assert.deepEqual(fresh.value.functions, await committed());
});
