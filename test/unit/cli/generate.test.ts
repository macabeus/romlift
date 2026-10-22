// `romlift generate [--rom] [--dry-run] [--json] [--out]` (architecture §2.1, §6.4) in temporary projects made by
// `init`: right after init the dry run is keep only and the run changes no file or modification time; a deleted asm/
// is written again; --out writes elsewhere and leaves the project alone; romlift.toml is never written; the refusals
// (an illegal border, a misspelt key, another ROM, no project, a held lock) exit 1 and change nothing; --rom reads
// another copy of the right ROM; generate works from a subdirectory; a TOML rename and a deleted function are
// carried into the INCLUDE_ASM lines of src/<module>.c (D75 b).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ExitCode } from '../../../src/cli/exit-codes.ts';
import { main } from '../../../src/cli/main.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';
import { capturingIo } from './fake.ts';

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-cli-generate-'));
after(() => rm(TMP, { recursive: true, force: true }));
const FIXTURES = listSyntheticFixtures();
const COMPOSITE = FIXTURES.find((f) => f.name === 'composite') ?? assert.fail('composite');
const FAR_JUMP = FIXTURES.find((f) => f.name === 'far-jump') ?? assert.fail('far-jump');
let fresh = 0;

async function run(cwd: string, argv: readonly string[]): Promise<{ readonly code: ExitCode; readonly stdout: string; readonly stderr: string }> {
  const io = { ...capturingIo(), cwd };
  const code = await main(argv, io);
  return { code, stdout: io.out.join(''), stderr: io.err.join('') };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split('\n')
    .map((text) => JSON.parse(text) as Record<string, unknown>);
}

async function initProject(rom: string = COMPOSITE.rom, args: readonly string[] = ['--module-size', '0x200']): Promise<string> {
  const dir = path.join(TMP, `p${fresh++}`);
  await mkdir(dir, { recursive: true });
  await copyFile(rom, path.join(dir, 'baserom.gba'));
  const out = await run(dir, ['init', 'baserom.gba', ...args]);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  return dir;
}

async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) for (const [k, v] of await snapshot(dir, relative)) out.set(k, v);
    else out.set(relative, `${(await readFile(path.join(dir, relative))).toString('base64')} ${(await stat(path.join(dir, relative))).mtimeMs}`);
  }
  return out;
}

test('right after init: the dry run is keep only, and generate changes no file, manifest included, nor its modification time', async () => {
  const dir = await initProject();
  const before = await snapshot(dir);
  const dry = await run(dir, ['generate', '--dry-run', '--json']);
  assert.equal(dry.code, ExitCode.ok, dry.stdout);
  const parsed = lines(dry.stdout);
  const ops = parsed.filter((l) => l['type'] === 'op');
  assert.ok(ops.length > 0);
  assert.deepEqual([...new Set(ops.map((l) => l['op']))], ['keep']);
  assert.deepEqual(Object.keys(ops[0] ?? {}).sort(), ['op', 'path', 'type']);
  assert.equal(parsed.at(-1)?.['type'], 'summary');
  const real = await run(dir, ['generate', '--json']);
  assert.equal(real.code, ExitCode.ok, real.stdout);
  assert.deepEqual(lines(real.stdout).map((l) => l['type']), ['summary']);
  assert.deepEqual(await snapshot(dir), before);
});

test('modules.mk records the SHA-1 of romlift.toml\'s bytes, from init on; a TOML edit changes it with the next generate (fix round 6, correctness-b1-1)', async () => {
  const dir = await initProject();
  const recorded = async (): Promise<string | undefined> => /^ROMLIFT_TOML_SHA1 := ([0-9a-f]{40})$/m.exec(await readFile(path.join(dir, 'modules.mk'), 'utf8'))?.[1];
  const sha1 = async (): Promise<string> => createHash('sha1').update(await readFile(path.join(dir, 'romlift.toml'))).digest('hex');
  assert.equal(await recorded(), await sha1(), 'init');
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  await writeFile(path.join(dir, 'romlift.toml'), `# a comment changes the bytes\n${toml}`);
  assert.notEqual(await recorded(), await sha1());
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  assert.equal(await recorded(), await sha1(), 'generate');
});

test('a deleted asm/ is written again, the TOML untouched; from a subdirectory too; text mode lists the writes', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const toml = await stat(path.join(dir, 'romlift.toml'));
  const asm = await snapshot(dir, 'asm');
  await rm(path.join(dir, 'asm'), { recursive: true });
  await mkdir(path.join(dir, 'src', 'deeper'), { recursive: true });
  const out = await run(path.join(dir, 'src', 'deeper'), ['generate']);
  assert.equal(out.code, ExitCode.ok, out.stderr);
  assert.match(out.stdout, /^write  asm\//m);
  assert.match(out.stdout, /^generate: ok \(exit 0\): /m);
  const again = await snapshot(dir, 'asm');
  assert.deepEqual([...again.keys()], [...asm.keys()]);
  for (const [k, v] of asm) assert.equal(again.get(k)?.split(' ')[0], v.split(' ')[0], k);
  const after = await stat(path.join(dir, 'romlift.toml'));
  assert.deepEqual([after.ino, after.mtimeMs], [toml.ino, toml.mtimeMs]);
});

test('--out writes the tree into another directory and leaves the project alone', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const before = await snapshot(dir);
  const out = path.join(TMP, `out-${fresh++}`);
  const run1 = await run(dir, ['generate', '--out', out, '--json']);
  assert.equal(run1.code, ExitCode.ok, run1.stdout);
  assert.deepEqual(await snapshot(dir), before);
  assert.ok((await stat(path.join(out, 'ldscript.txt'))).isFile());
  assert.ok((await stat(path.join(out, 'src', 'main.c'))).isFile());
  assert.ok((await stat(path.join(out, '.romlift', 'manifest.json'))).isFile());
});

test('a renamed and a deleted function reach src/<module>.c: its INCLUDE_ASM lines follow the TOML', async () => {
  const dir = await initProject();
  const toml = path.join(dir, 'romlift.toml');
  const text = await readFile(toml, 'utf8');
  const main = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  const stubs = [...main.matchAll(/^INCLUDE_ASM\("asm\/nonmatchings\/main", (sub_[0-9A-F]{8})\);$/gm)].map((m) => m[1] ?? '');
  const [renamed, deleted] = [stubs[1], stubs[2]];
  assert.ok(renamed !== undefined && deleted !== undefined, main);
  const edited = text.replace(`= { name = "${renamed}"`, '= { name = "Renamed"').replace(`"${renamed}"`, '"Renamed"').split('\n').filter((l) => !l.startsWith(`0x${deleted.slice(4)} = `)).join('\n');
  assert.notEqual(edited, text);
  await writeFile(toml, edited);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.equal(lines(out.stdout).at(-1)?.['counts'] !== undefined && (lines(out.stdout).at(-1)?.['counts'] as Record<string, number>)['edit'], 1);
  const after = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  assert.match(after, /INCLUDE_ASM\("asm\/nonmatchings\/main", Renamed\);/);
  assert.doesNotMatch(after, new RegExp(`, (${renamed}|${deleted})\\);`));
});

test("the composite's illegal border is E_MODULE_BORDER (exit 1), and no file changes", async () => {
  const dir = await initProject();
  const expect = JSON.parse(await readFile(COMPOSITE.expect, 'utf8')) as { readonly illegalBorder: { readonly module: string; readonly start: string } };
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const blocks = text.split('[[modules]]');
  const at = blocks.findIndex((b) => b.includes(`name = "${expect.illegalBorder.module}"`));
  assert.ok(at > 0);
  blocks[at] = (blocks[at] ?? '').replace(/start = 0x[0-9A-F]{8}/, `start = ${expect.illegalBorder.start}`);
  await writeFile(file, blocks.join('[[modules]]'));
  const before = await snapshot(dir);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors);
  const parsed = lines(out.stdout);
  assert.ok(parsed.some((l) => l['code'] === 'E_MODULE_BORDER'));
  assert.deepEqual(parsed.at(-1), { type: 'summary', ok: false, exitCode: 1 });
  assert.deepEqual(await snapshot(dir), before);
});

test('a misspelt key and a repeated entry are refused with their codes (exit 1), and no file changes', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const line = text.split('\n').find((l) => /^0x0[0-9A-F]{7} = /.test(l)) ?? assert.fail('no entry');
  for (const [edited, code] of [
    [text.replace(line, line.replace(/^0x0/, '0x')), 'E_TOML_KEY_SPELLING'],
    [text.replace(line, `${line}\n${line}`), 'E_DUPLICATE_ADDRESS'],
  ] as const) {
    await writeFile(file, edited);
    const before = await snapshot(dir);
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.errors, code);
    assert.ok(lines(out.stdout).some((l) => l['code'] === code), code);
    assert.deepEqual(await snapshot(dir), before, code);
  }
});

test('another ROM is E_ROM_SHA1_MISMATCH; --rom reads another copy of the right one; no project is E_PROJECT_NOT_FOUND', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  await copyFile(COMPOSITE.rom, path.join(dir, 'baserom.gba'));
  const other = await run(dir, ['generate', '--json']);
  assert.equal(other.code, ExitCode.errors);
  assert.equal(lines(other.stdout)[0]?.['code'], 'E_ROM_SHA1_MISMATCH');
  const right = await run(dir, ['generate', '--rom', FAR_JUMP.rom, '--dry-run', '--json']);
  assert.equal(right.code, ExitCode.ok, right.stdout);
  const nowhere = path.join(TMP, `none-${fresh++}`);
  await mkdir(nowhere);
  const none = await run(nowhere, ['generate', '--json']);
  assert.equal(none.code, ExitCode.errors);
  assert.equal(lines(none.stdout)[0]?.['code'], 'E_PROJECT_NOT_FOUND');
});

test('a project another live run holds is E_PROJECT_LOCKED (exit 1); the dry run plans regardless', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  await writeFile(path.join(dir, '.romlift', 'lock'), `${JSON.stringify({ host: hostname(), pid: process.pid })}\n`);
  await rm(path.join(dir, 'ldscript.txt'));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors);
  assert.ok(lines(out.stdout).some((l) => l['code'] === 'E_PROJECT_LOCKED'));
  await assert.rejects(stat(path.join(dir, 'ldscript.txt')));
  const dry = await run(dir, ['generate', '--dry-run', '--json']);
  assert.equal(dry.code, ExitCode.ok);
  assert.ok(lines(dry.stdout).some((l) => l['type'] === 'op' && l['op'] === 'write' && l['path'] === 'ldscript.txt'));
});

test('generate takes no positional and no stdin; --help prints its usage', async () => {
  assert.equal((await run(TMP, ['generate', 'extra'])).code, ExitCode.usage);
  const help = await run(TMP, ['generate', '--help']);
  assert.equal(help.code, ExitCode.ok);
  assert.match(help.stdout, /^Usage: romlift generate \[--rom <rom>\] \[--dry-run\] \[--json\] \[--out <dir>\]/);
});

/** The first two default-named stubs of src/main.c, and the TOML text and the C text. */
async function firstStubs(dir: string): Promise<{ readonly names: readonly string[]; readonly toml: string; readonly main: string }> {
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  const names = [...main.matchAll(/^INCLUDE_ASM\("asm\/nonmatchings\/main", (sub_[0-9A-F]{8})\);$/gm)].map((m) => m[1] ?? '');
  return { names, toml, main };
}

/** romlift.toml with function `from` renamed `to`. */
function renamed(toml: string, from: string, to: string): string {
  return toml.replace(`= { name = "${from}"`, `= { name = "${to}"`).replace(`"${from}"`, `"${to}"`);
}

test('renaming a decompiled function in the TOML alone is E_C_STALE_DEFINITION (exit 1): nothing is written, src/main.c keeps one definition', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const fn = names[1] ?? assert.fail(main);
  const decompiled = main.replace(`INCLUDE_ASM("asm/nonmatchings/main", ${fn});`, `int ${fn}(int x) {\n  return x;\n}`);
  await writeFile(path.join(dir, 'src', 'main.c'), decompiled);
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, fn, 'Checksum'));
  const before = await snapshot(dir);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic' && l['severity'] === 'error').map((l) => l['code']), ['E_C_STALE_DEFINITION']);
  assert.deepEqual(await snapshot(dir), before, 'nothing written');
  // The C renamed too: generate goes through, and the file holds Checksum once.
  await writeFile(path.join(dir, 'src', 'main.c'), decompiled.replace(`int ${fn}(`, 'int Checksum('));
  const again = await run(dir, ['generate', '--json']);
  assert.equal(again.code, ExitCode.ok, again.stdout);
  const after = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  assert.equal(after.split('Checksum').length - 1, 1, after);
});

test('a rename next to a NONMATCHING block puts the new stub after its #endif, never inside it', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const [held, next] = [names[0] ?? assert.fail(main), names[1] ?? assert.fail(main)];
  const stubOf = (n: string): string => `INCLUDE_ASM("asm/nonmatchings/main", ${n});`;
  const wrapped = main.replace(stubOf(held), `#ifdef NONMATCHING\nint ${held}(void) {\n  return 0;\n}\n#else\n${stubOf(held)}\n#endif`);
  await writeFile(path.join(dir, 'src', 'main.c'), wrapped);
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, next, 'AgbMain'));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  const after = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  assert.ok(after.includes(`#endif\n${stubOf('AgbMain')}\n`), after);
  assert.ok(!after.includes(stubOf(next)), after);
});

test('a src/*.c of no module warns W_C_FILE_UNUSED; generate still writes', async () => {
  const dir = await initProject();
  await writeFile(path.join(dir, 'src', 'old.c'), 'int Kept(void) { return 1; }\n');
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => [l['code'], l['path']]), [['W_C_FILE_UNUSED', 'src/old.c']]);
});

test('--out twice into one directory: the second run rewrites src/main.c with the TOML change, as it rewrites asm/', async () => {
  const dir = await initProject();
  const out = path.join(TMP, `out-${fresh++}`);
  assert.equal((await run(dir, ['generate', '--out', out, '--json'])).code, ExitCode.ok);
  const { names, toml } = await firstStubs(dir);
  const fn = names[0] ?? assert.fail('a stub');
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, fn, 'Poly'));
  const again = await run(dir, ['generate', '--out', out, '--json']);
  assert.equal(again.code, ExitCode.ok, again.stdout);
  const main = await readFile(path.join(out, 'src', 'main.c'), 'utf8');
  assert.match(main, /INCLUDE_ASM\("asm\/nonmatchings\/main", Poly\);/);
  assert.doesNotMatch(main, new RegExp(`, ${fn}\\);`));
});

// Fix round 3 (D78 a): the NONMATCHING pattern after a rename, a rename or deletion with a border move, a helper next
// to a renamed asm-only function, a move of decompiled C, and a case-folded pair.

const stubIn = (module: string, n: string): string => `INCLUDE_ASM("asm/nonmatchings/${module}", ${n});`;

test('a NONMATCHING block after a rename: renaming only its C is E_C_CONDITIONAL_STUB; renaming its #else stub too keeps the default build whole', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const fn = names[1] ?? assert.fail(main);
  const block = (def: string, inner: string): string => `#ifdef NONMATCHING\nvoid ${def}(void) {\n}\n#else\n${stubIn('main', inner)}\n#endif`;
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), block(fn, fn)));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'the pattern as written builds');
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, fn, 'Nop'));
  const errorsOf = (stdout: string): unknown[] => lines(stdout).filter((l) => l['severity'] === 'error').map((l) => l['code']);
  assert.deepEqual(errorsOf((await run(dir, ['generate', '--json'])).stdout), ['E_C_CONDITIONAL_STUB', 'E_C_STALE_DEFINITION']);
  // E_C_STALE_DEFINITION's advice followed for the C alone: the #else stub still names the old chunk, and nothing is written.
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), block('Nop', fn)));
  const before = await snapshot(dir);
  const half = await run(dir, ['generate', '--json']);
  assert.equal(half.code, ExitCode.errors, half.stdout);
  assert.deepEqual(errorsOf(half.stdout), ['E_C_CONDITIONAL_STUB']);
  assert.deepEqual(await snapshot(dir), before, 'nothing written: the #else branch keeps its INCLUDE_ASM');
  // Both renamed: generate goes through and the default build includes Nop's chunk exactly once, from the #else branch.
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), block('Nop', 'Nop')));
  const done = await run(dir, ['generate', '--json']);
  assert.equal(done.code, ExitCode.ok, done.stdout);
  const after = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  assert.equal(after.split(stubIn('main', 'Nop')).length - 1, 1, after);
  assert.ok(after.includes(`#else\n${stubIn('main', 'Nop')}\n#endif`), after);
  assert.ok((await stat(path.join(dir, 'asm', 'nonmatchings', 'main', 'Nop.s'))).isFile(), 'the chunk the #else branch includes is written');
});

/** romlift.toml with main_3 starting at main_2's last function (0x08000488, a legal border of the composite). */
function movedBorder(toml: string): string {
  return toml.replace('start = 0x080004DC', 'start = 0x08000488');
}

test('decompiled C and a border move: moved is E_C_DEFINITION_MOVED; renamed or deleted too is E_C_STALE_DEFINITION; each exits 1 and writes nothing', async () => {
  const dir = await initProject();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  assert.ok(toml.includes('start = 0x080004DC') && main2.includes(stubIn('main_2', 'sub_08000488')), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(stubIn('main_2', 'sub_08000488'), 'int sub_08000488(void) {\n  return 0;\n}'));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  for (const [edited, code] of [
    [movedBorder(toml), 'E_C_DEFINITION_MOVED'],
    [movedBorder(renamed(toml, 'sub_08000488', 'Nop')), 'E_C_STALE_DEFINITION'],
    [movedBorder(toml).split('\n').filter((l) => !l.startsWith('0x08000488 = ')).join('\n'), 'E_C_STALE_DEFINITION'],
  ] as const) {
    await writeFile(path.join(dir, 'romlift.toml'), edited);
    const before = await snapshot(dir);
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.errors, out.stdout);
    assert.deepEqual(lines(out.stdout).filter((l) => l['severity'] === 'error').map((l) => l['code']), [code], out.stdout);
    assert.deepEqual(await snapshot(dir), before, code);
  }
});

test('renaming an asm-only function next to a static helper adds its stub and raises nothing', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const fn = names[1] ?? assert.fail(main);
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), `static inline int Helper(int a) {\n    return a + 1;\n}\n${stubIn('main', fn)}`));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, fn, 'DmaThing'));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), []);
  const after = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  assert.ok(after.includes(`${stubIn('main', names[0] ?? '')}\n${stubIn('main', 'DmaThing')}\nstatic inline int Helper(`), after);
});

test('a case-folded pair (Foo and foo in one module): decompiling Foo needs no edit, generate exits 0 and keeps the C', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const [a, b] = [names[1] ?? assert.fail(main), names[2] ?? assert.fail(main)];
  await writeFile(path.join(dir, 'romlift.toml'), renamed(renamed(toml, a, 'Foo'), b, 'foo'));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  const stubs = await readFile(path.join(dir, 'src', 'main.c'), 'utf8');
  // Each member's file is `<Name>_<ADDR>.s`, ADDR its chunk's start (paths.ts chunkPaths).
  const foo = /, (Foo_[0-9A-F]{8})\);/.exec(stubs)?.[1] ?? assert.fail(stubs);
  assert.match(stubs, /, foo_[0-9A-F]{8}\);/);
  const decompiled = stubs.replace(stubIn('main', foo), 'void Foo(void) {\n}');
  await writeFile(path.join(dir, 'src', 'main.c'), decompiled);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), []);
  assert.equal(await readFile(path.join(dir, 'src', 'main.c'), 'utf8'), decompiled);
});

// Fix round 4 (D80 a): a decompiled function renamed in C only, a conditional that opens braces differently per branch,
// and a merged c module whose file held decompiled C.

const errorCodes = (stdout: string): unknown[] => lines(stdout).filter((l) => l['severity'] === 'error').map((l) => l['code']);

test('renaming a decompiled function in C only is E_C_STALE_DEFINITION (exit 1): its INCLUDE_ASM is not inserted again, nothing is written', async () => {
  const dir = await initProject();
  const { names, main } = await firstStubs(dir);
  const fn = names[1] ?? assert.fail(main);
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), `void ${fn}(void) {\n}`));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'the decompiled function, under its name');
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), 'void Nop(void) {\n}'));
  const before = await snapshot(dir);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors, out.stdout);
  assert.deepEqual(errorCodes(out.stdout), ['E_C_STALE_DEFINITION']);
  assert.match(out.stdout, new RegExp(`defines Nop \\(line \\d+\\) where the INCLUDE_ASM of ${fn} was`));
  assert.deepEqual(await snapshot(dir), before, 'nothing written: src/main.c gets no second copy of the bytes');
  // A fresh clone's first generate (no asm/ on disk, R4) refuses it by the fallback rule.
  await rm(path.join(dir, 'asm'), { recursive: true });
  const fresh = await run(dir, ['generate', '--dry-run', '--json']);
  assert.equal(fresh.code, ExitCode.errors, fresh.stdout);
  assert.deepEqual(errorCodes(fresh.stdout), ['E_C_STALE_DEFINITION']);
});

/** The project as a fresh clone or worktree has it: none of the gitignored generated files, no .romlift state (D79 b). */
async function asCloned(dir: string): Promise<void> {
  for (const generated of ['asm', 'data', 'ldscript.txt', 'symbols.ld', 'modules.mk', '.romlift']) await rm(path.join(dir, generated), { recursive: true, force: true });
}

test('branches inside a body that open braces differently scan: generate exits 0, in a fresh clone too (fix round 5, correctness-b0-1)', async () => {
  const dir = await initProject();
  const { names, main } = await firstStubs(dir);
  const [first, second] = [names[0] ?? assert.fail(main), names[1] ?? assert.fail(main)];
  const perVersion = `void ${first}(void) {\n    volatile int x = 0;\n#ifdef NONMATCHING\n    if (x) {\n#else\n    if (!x) {\n#endif\n    }\n}`;
  const doWhile = `void ${second}(char *d, const char *s) {\n#ifndef NONMATCHING\n    do {\n#endif\n    while ((*d++ = *s++)) ;\n#ifndef NONMATCHING\n    } while (0);\n#endif\n}`;
  const text = main.replace(stubIn('main', first), perVersion).replace(stubIn('main', second), doWhile);
  await writeFile(path.join(dir, 'src', 'main.c'), text);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), []);
  assert.equal(await readFile(path.join(dir, 'src', 'main.c'), 'utf8'), text, 'nothing to edit');
  // The clone's first generate (setup.sh's duty 5) writes the tree.
  await asCloned(dir);
  const cloned = await run(dir, ['generate', '--json']);
  assert.equal(cloned.code, ExitCode.ok, cloned.stdout);
  assert.ok((await stat(path.join(dir, 'modules.mk'))).isFile());
  assert.equal(await readFile(path.join(dir, 'src', 'main.c'), 'utf8'), text);
  // A TOML rename of a third function still reaches the file.
  const third = names[2] ?? assert.fail(main);
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, third, 'Renamed'));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  assert.ok((await readFile(path.join(dir, 'src', 'main.c'), 'utf8')).includes(stubIn('main', 'Renamed')));
});

test('a file the scanner cannot split: W_C_UNSCANNABLE (exit 0) while it needs no edit, in a fresh clone too; E_C_UNSCANNABLE (exit 1) once it needs one', async () => {
  const dir = await initProject();
  const { names, toml, main } = await firstStubs(dir);
  const fn = names[1] ?? assert.fail(main);
  // A file-scope #ifdef whose branches end differently: an ASM_FUNC-style macro with no `;` against a definition.
  const ambiguous = `#ifdef VC\nASM_FUNC("asm/vc.s", void ${fn}(void))\n#else\nvoid ${fn}(void) {\n}\n#endif\n`;
  await writeFile(path.join(dir, 'src', 'main.c'), main.replace(stubIn('main', fn), `${ambiguous}${stubIn('main', fn)}`));
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => [l['code'], l['path']]), [['W_C_UNSCANNABLE', 'src/main.c']]);
  await asCloned(dir);
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'setup.sh duty 5 in a clone');
  const other = names[3] ?? assert.fail(main);
  await writeFile(path.join(dir, 'romlift.toml'), renamed(toml, other, 'Renamed'));
  const before = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  assert.deepEqual(errorCodes(refused.stdout), ['E_C_UNSCANNABLE']);
  assert.deepEqual(await snapshot(dir), before);
});

test('a c module renamed and its source moved by hand: the old directory\'s stubs go, with and without decompiled C (fix round 5, correctness-b0-2)', async () => {
  const dir = await initProject();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
  assert.ok(toml.includes('name = "main_3"') && main3.includes(stubIn('main_3', 'sub_08000508')), 'the composite as this test knows it');
  const decompiled = main3.replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
  for (const text of [main3, decompiled]) {
    await writeFile(path.join(dir, 'romlift.toml'), toml);
    await rm(path.join(dir, 'src', 'boot.c'), { force: true });
    await writeFile(path.join(dir, 'src', 'main_3.c'), text);
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
    // `git mv src/main_3.c src/boot.c` and the TOML rename.
    await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
    await writeFile(path.join(dir, 'src', 'boot.c'), text);
    await rm(path.join(dir, 'src', 'main_3.c'));
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.ok, out.stdout);
    const boot = await readFile(path.join(dir, 'src', 'boot.c'), 'utf8');
    assert.ok(!boot.includes('asm/nonmatchings/main_3'), boot);
    for (const [, stubDir, name] of boot.matchAll(/^INCLUDE_ASM\("([^"]+)", (\w+)\);$/gm)) assert.ok((await stat(path.join(dir, `${stubDir ?? ''}/${name ?? ''}.s`))).isFile(), `${stubDir}/${name}.s`);
    assert.equal(boot.includes('void sub_08000508(void) {'), text === decompiled);
    assert.equal(boot.includes(stubIn('boot', 'sub_08000508')), text !== decompiled);
  }
});

test('a c module merged into the one before it: its file\'s decompiled C is E_C_DEFINITION_MOVED (exit 1), never replaced by a stub', async () => {
  const dir = await initProject();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
  const block = '[[modules]]\nname = "main_3"\nstart = 0x080004DC\nkind = "c"\n\n';
  assert.ok(toml.includes(block) && main3.includes(stubIn('main_3', 'sub_08000508')), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'main_3.c'), main3.replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}'));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  await writeFile(path.join(dir, 'romlift.toml'), toml.replace(block, ''));
  const before = await snapshot(dir);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.errors, out.stdout);
  const diagnostics = lines(out.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => [l['code'], l['path']]);
  assert.deepEqual(diagnostics, [['W_C_FILE_UNUSED', 'src/main_3.c'], ['E_C_DEFINITION_MOVED', 'src/main_3.c']]);
  assert.deepEqual(await snapshot(dir), before);
});

// Fix round 6 (D82): the C a split moves goes to a file that may not exist yet; decompiled C in an #included fragment.

test('a split behind decompiled C: E_C_DEFINITION_MOVED names the new source; the C pasted there alone gains the header and its stubs (correctness-b1-2)', async () => {
  const dir = await initProject();
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  const c = 'int sub_08000488(void) {\n  return 0;\n}\n';
  assert.ok(toml.includes('[[modules]]\nname = "main_3"') && main2.includes(stubIn('main_2', 'sub_08000488')), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(`${stubIn('main_2', 'sub_08000488')}\n`, c));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
  await writeFile(path.join(dir, 'romlift.toml'), toml.replace('[[modules]]\nname = "main_3"', '[[modules]]\nname = "math"\nstart = 0x08000444\nkind = "c"\n\n[[modules]]\nname = "main_3"'));
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  const moved = lines(refused.stdout).filter((l) => l['type'] === 'diagnostic');
  assert.deepEqual(moved.map((l) => l['code']), ['E_C_DEFINITION_MOVED'], refused.stdout);
  assert.match(String(moved[0]?.['message']), /move its C to src\/math\.c \(create the file if it does not exist/);
  // As the message says: the C cut from main_2.c and pasted alone into src/math.c.
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(`${stubIn('main_2', 'sub_08000488')}\n`, ''));
  await writeFile(path.join(dir, 'src', 'math.c'), c);
  const out = await run(dir, ['generate', '--json']);
  assert.equal(out.code, ExitCode.ok, out.stdout);
  assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), [], out.stdout);
  const math = await readFile(path.join(dir, 'src', 'math.c'), 'utf8');
  assert.equal(math, `#include "include_asm.h"\n\n${stubIn('math', 'sub_08000444')}\n${stubIn('math', 'sub_0800045C')}\n${c}`);
  for (const [, stubDir, name] of math.matchAll(/^INCLUDE_ASM\("([^"]+)", (\w+)\);$/gm)) assert.ok((await stat(path.join(dir, `${stubDir ?? ''}/${name ?? ''}.s`))).isFile(), `${stubDir}/${name}.s`);
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
  assert.equal(await readFile(path.join(dir, 'src', 'math.c'), 'utf8'), math);
});

test('decompiled C in a src/*.c fragment the module\'s file #includes: generate keeps it (exit 0, no warning); in a fragment romlift does not read, an insertion is refused (correctness-b1-3)', async () => {
  const dir = await initProject();
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  assert.ok(main2.includes(stubIn('main_2', 'sub_08000488')), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'poly.inc.c'), 'int sub_08000488(void) {\n  return 0;\n}\n');
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(stubIn('main_2', 'sub_08000488'), '#include "poly.inc.c"'));
  const before = await snapshot(dir);
  const kept = await run(dir, ['generate', '--json']);
  assert.equal(kept.code, ExitCode.ok, kept.stdout);
  assert.deepEqual(lines(kept.stdout).filter((l) => l['type'] === 'diagnostic'), [], kept.stdout);
  assert.deepEqual(await snapshot(dir), before, 'nothing to write');
  // The same fragment under a name romlift does not read: the stub it would insert might define the function twice.
  await rm(path.join(dir, 'src', 'poly.inc.c'));
  await writeFile(path.join(dir, 'src', 'poly.inc'), 'int sub_08000488(void) {\n  return 0;\n}\n');
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(stubIn('main_2', 'sub_08000488'), '#include "poly.inc"'));
  const unread = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  assert.deepEqual(lines(refused.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => l['code']), ['E_C_STUB_UNPLACED'], refused.stdout);
  assert.deepEqual(await snapshot(dir), unread);
});

test('INCLUDE_ASM lines moved into an #included src/*.c fragment hold their chunks; a TOML rename of one is refused naming the fragment, and nothing is written (fix round 7, correctness-b2-1)', async () => {
  const dir = await initProject();
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  assert.ok(main2.includes(stubIn('main_2', 'sub_08000488')) && toml.includes('0x08000488 = "sub_08000488"'), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'part.c'), `${stubIn('main_2', 'sub_08000488')}\n`);
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(stubIn('main_2', 'sub_08000488'), '#include "part.c"'));
  const before = await snapshot(dir);
  // The reviewer's F0: with no TOML change, the stub was inserted a second time into main_2.c.
  const kept = await run(dir, ['generate', '--json']);
  assert.equal(kept.code, ExitCode.ok, kept.stdout);
  assert.deepEqual(lines(kept.stdout).filter((l) => l['type'] === 'diagnostic'), [], kept.stdout);
  assert.deepEqual(await snapshot(dir), before, 'nothing to write');
  // F1: a TOML rename of the function whose stub the fragment holds left that stub naming a file no longer written.
  await writeFile(path.join(dir, 'romlift.toml'), toml.replace('0x08000488 = "sub_08000488"', '0x08000488 = "FragFn"'));
  const renamed = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  const diagnostics = lines(refused.stdout).filter((l) => l['type'] === 'diagnostic');
  assert.deepEqual(diagnostics.map((l) => [l['code'], l['path']]), [['E_C_FRAGMENT_STUB', 'src/part.c']], refused.stdout);
  assert.deepEqual(await snapshot(dir), renamed, 'the refusal wrote nothing');
  // As the message says: the stub renamed in the fragment by hand; generate then writes the renamed tree and edits no C.
  await writeFile(path.join(dir, 'src', 'part.c'), `${stubIn('main_2', 'FragFn')}\n`);
  const fixed = await run(dir, ['generate', '--json']);
  assert.equal(fixed.code, ExitCode.ok, fixed.stdout);
  assert.deepEqual(lines(fixed.stdout).filter((l) => l['type'] === 'diagnostic'), [], fixed.stdout);
  assert.equal(await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8'), main2.replace(stubIn('main_2', 'sub_08000488'), '#include "part.c"'));
  assert.ok((await stat(path.join(dir, 'asm', 'nonmatchings', 'main_2', 'FragFn.s'))).isFile());
});

// Fix round 8 (D84): a fragment made a module of its own; a fragment under a subdirectory of src/.

test('a split that makes an #included fragment a module: E_C_MODULE_INCLUDED naming the including file, nothing written; the #include removed, the new module\'s file gains the header and its stubs (fix round 8, correctness-c0-1)', async () => {
  const dir = await initProject();
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
  const tail = `${stubIn('main_2', 'sub_0800045C')}\n${stubIn('main_2', 'sub_08000488')}\n`;
  assert.ok(main2.endsWith(tail) && toml.includes('[[modules]]\nname = "main_3"'), 'the composite as this test knows it');
  await writeFile(path.join(dir, 'src', 'tail.c'), tail);
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(tail, '#include "tail.c"\n'));
  const kept = await run(dir, ['generate', '--json']);
  assert.equal(kept.code, ExitCode.ok, kept.stdout);
  assert.deepEqual(lines(kept.stdout).filter((l) => l['type'] === 'diagnostic'), [], kept.stdout);
  // The review's split: a module named after the fragment, at its first function.
  await writeFile(path.join(dir, 'romlift.toml'), toml.replace('[[modules]]\nname = "main_3"', '[[modules]]\nname = "tail"\nstart = 0x0800045C\nkind = "c"\n\n[[modules]]\nname = "main_3"'));
  const before = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  const diagnostics = lines(refused.stdout).filter((l) => l['type'] === 'diagnostic');
  assert.deepEqual(diagnostics.map((l) => [l['code'], l['path']]), [['E_C_MODULE_INCLUDED', 'src/main_2.c']], refused.stdout);
  assert.match(String(diagnostics[0]?.['message']), /src\/main_2\.c #includes "tail\.c" \(line \d+\), the source of module tail, which make compiles on its own/);
  assert.deepEqual(await snapshot(dir), before, 'the refusal wrote nothing');
  // As the message says: the #include removed. tail.c held its stubs under main_2's header, so it gains its own.
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(tail, ''));
  const fixed = await run(dir, ['generate', '--json']);
  assert.equal(fixed.code, ExitCode.ok, fixed.stdout);
  assert.deepEqual(lines(fixed.stdout).filter((l) => l['type'] === 'diagnostic'), [], fixed.stdout);
  assert.equal(await readFile(path.join(dir, 'src', 'tail.c'), 'utf8'), `#include "include_asm.h"\n\n${stubIn('tail', 'sub_0800045C')}\n${stubIn('tail', 'sub_08000488')}\n`);
  // main_2 now ends with the zero pad before tail's first function, an orphan of its own (Q8).
  assert.equal(await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8'), main2.replace(tail, `${stubIn('main_2', 'unk_0800045A')}\n`));
  assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
});

test('the fragment made a module has an #include of its own (a global.h for its types): it gains the header all the same (fix round 9, correctness-c1-1, architecture-c1-1)', async () => {
  for (const prelude of ['#include "global.h"\n', '#define UNUSED 1\n']) {
    const dir = await initProject();
    const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
    const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
    const tail = `${stubIn('main_2', 'sub_0800045C')}\n${stubIn('main_2', 'sub_08000488')}\n`;
    assert.ok(main2.endsWith(tail), 'the composite as this test knows it');
    await writeFile(path.join(dir, 'include', 'global.h'), '#ifndef GUARD_GLOBAL_H\n#define GUARD_GLOBAL_H\ntypedef unsigned char u8;\n#endif\n');
    await writeFile(path.join(dir, 'src', 'tail.c'), `${prelude}${tail}`);
    await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(tail, '#include "tail.c"\n'));
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok);
    await writeFile(path.join(dir, 'romlift.toml'), toml.replace('[[modules]]\nname = "main_3"', '[[modules]]\nname = "tail"\nstart = 0x0800045C\nkind = "c"\n\n[[modules]]\nname = "main_3"'));
    const refused = await run(dir, ['generate', '--json']);
    assert.deepEqual(lines(refused.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => l['code']), ['E_C_MODULE_INCLUDED'], refused.stdout);
    await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(tail, ''));
    const fixed = await run(dir, ['generate', '--json']);
    assert.equal(fixed.code, ExitCode.ok, fixed.stdout);
    assert.deepEqual(lines(fixed.stdout).filter((l) => l['type'] === 'diagnostic'), [], fixed.stdout);
    // Fix round 8 left this file without the header, so INCLUDE_ASM did not compile (the review's make: a syntax error).
    assert.equal(await readFile(path.join(dir, 'src', 'tail.c'), 'utf8'), `#include "include_asm.h"\n\n${prelude}${stubIn('tail', 'sub_0800045C')}\n${stubIn('tail', 'sub_08000488')}\n`, prelude);
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
  }
});

test('a c module renamed with git mv whose INCLUDE_ASM comes from its own global.h: no second header, so macros.inc is included once; a global.h of types alone brings it (fix round 10, correctness-c2-1)', async () => {
  for (const defines of [true, false]) {
    const dir = await initProject();
    const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
    const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
    const header = await readFile(path.join(dir, 'include', 'include_asm.h'), 'utf8');
    assert.ok(main3.startsWith('#include "include_asm.h"\n') && main3.includes(stubIn('main_3', 'sub_08000508')) && header.includes('macros.inc'), 'the composite as this test knows it');
    // The reviewer's klonoa layout: global.h defines INCLUDE_ASM and includes macros.inc under its own guard (through a
    // nested header here), and the module's file includes global.h instead of include_asm.h; one function decompiled.
    const own = header.replace(/GUARD_INCLUDE_ASM_H/g, 'GUARD_MACRO_H');
    await mkdir(path.join(dir, 'include', 'gba'));
    await writeFile(path.join(dir, 'include', 'gba', 'macro.h'), defines ? own : 'typedef unsigned char u8;\n');
    await writeFile(path.join(dir, 'include', 'global.h'), '#ifndef GUARD_GLOBAL_H\n#define GUARD_GLOBAL_H\n#include "gba/macro.h"\n#endif\n');
    const text = main3.replace('#include "include_asm.h"\n', '#include "global.h"\n').replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
    await writeFile(path.join(dir, 'src', 'main_3.c'), text);
    const first = await run(dir, ['generate', '--json']);
    assert.equal(first.code, ExitCode.ok, first.stdout);
    const kept = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
    assert.equal(kept, text, 'a file that needs no stub inserted gains no header');
    // `git mv src/main_3.c src/boot.c` and the TOML rename: every stub of the file is replaced.
    await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
    await writeFile(path.join(dir, 'src', 'boot.c'), kept);
    await rm(path.join(dir, 'src', 'main_3.c'));
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.ok, out.stdout);
    assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), [], out.stdout);
    const boot = await readFile(path.join(dir, 'src', 'boot.c'), 'utf8');
    assert.ok(!boot.includes('asm/nonmatchings/main_3') && boot.includes('void sub_08000508(void) {'), boot);
    // Fix round 9 added the header here too, and global.h's macros.inc then came twice: the assembler refused.
    const renamedText = kept.replaceAll('asm/nonmatchings/main_3', 'asm/nonmatchings/boot');
    assert.equal(boot, defines ? renamedText : `#include "include_asm.h"\n\n${renamedText}`, `global.h ${defines ? 'defines' : 'does not define'} INCLUDE_ASM`);
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
  }
});

test('a c module renamed with git mv whose INCLUDE_ASM comes through a fragment it includes, an angle include or a src/*.h: no second header (fix round 11, correctness-d0-1, d0-2, architecture-d0-1, d0-2)', async () => {
  const layouts = [
    { name: 'fragment', include: '#include "part.c"\n', files: { 'src/part.c': '#include "global.h"\n', 'include/global.h': 'DEFINING' } },
    { name: 'angle', include: '#include <global.h>\n', files: { 'include/global.h': 'DEFINING' } },
    { name: 'src header', include: '#include "local.h"\n', files: { 'src/local.h': 'DEFINING' } },
  ] as const;
  for (const layout of layouts) {
    const dir = await initProject();
    const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
    const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
    const header = await readFile(path.join(dir, 'include', 'include_asm.h'), 'utf8');
    assert.ok(main3.startsWith('#include "include_asm.h"\n') && main3.includes(stubIn('main_3', 'sub_08000508')) && header.includes('macros.inc'), 'the composite as this test knows it');
    // The reviewers' klonoa layouts: a header that defines INCLUDE_ASM and includes macros.inc under its own guard.
    const own = header.replace(/GUARD_INCLUDE_ASM_H/g, 'GUARD_GLOBAL_H');
    for (const [file, text] of Object.entries(layout.files)) await writeFile(path.join(dir, ...file.split('/')), text === 'DEFINING' ? own : text);
    const text = main3.replace('#include "include_asm.h"\n', layout.include).replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
    await writeFile(path.join(dir, 'src', 'main_3.c'), text);
    const first = await run(dir, ['generate', '--json']);
    assert.equal(first.code, ExitCode.ok, first.stdout);
    assert.deepEqual(lines(first.stdout).filter((l) => l['type'] === 'diagnostic'), [], first.stdout);
    assert.equal(await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8'), text, layout.name);
    // `git mv src/main_3.c src/boot.c` and the TOML rename: every stub of the file is replaced.
    await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
    await writeFile(path.join(dir, 'src', 'boot.c'), text);
    await rm(path.join(dir, 'src', 'main_3.c'));
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.ok, out.stdout);
    assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), [], out.stdout);
    // Fix round 10 added the header here, and the user's macros.inc then came twice: the assembler refused.
    assert.equal(await readFile(path.join(dir, 'src', 'boot.c'), 'utf8'), text.replaceAll('asm/nonmatchings/main_3', 'asm/nonmatchings/boot'), layout.name);
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
  }
});

test('a c module renamed with git mv whose INCLUDE_ASM comes from a header behind a symbolic link to a directory: no second header (fix round 12, correctness-d1-1, architecture-d1-1, gate-honesty-d1-1)', async () => {
  // cpp -I include follows a linked include/ and a linked subdirectory of it; fix round 11 read nothing behind either.
  const layouts = ['include/ a link', 'include/gba a link'] as const;
  for (const layout of layouts) {
    const dir = await initProject();
    const toml = await readFile(path.join(dir, 'romlift.toml'), 'utf8');
    const main3 = await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8');
    const header = await readFile(path.join(dir, 'include', 'include_asm.h'), 'utf8');
    assert.ok(main3.startsWith('#include "include_asm.h"\n') && main3.includes(stubIn('main_3', 'sub_08000508')) && header.includes('macros.inc'), 'the composite as this test knows it');
    const own = header.replace(/GUARD_INCLUDE_ASM_H/g, 'GUARD_GLOBAL_H');
    const shared = `${dir}-shared`;
    await mkdir(shared, { recursive: true });
    if (layout === 'include/ a link') {
      await writeFile(path.join(dir, 'include', 'global.h'), own);
      await rename(path.join(dir, 'include'), path.join(shared, 'include'));
      await symlink(path.join(shared, 'include'), path.join(dir, 'include'));
    } else {
      await mkdir(path.join(shared, 'gba'), { recursive: true });
      await writeFile(path.join(shared, 'gba', 'macro.h'), own);
      await symlink(path.join(shared, 'gba'), path.join(dir, 'include', 'gba'));
      await writeFile(path.join(dir, 'include', 'global.h'), '#include "gba/macro.h"\n');
    }
    const text = main3.replace('#include "include_asm.h"\n', '#include "global.h"\n').replace(stubIn('main_3', 'sub_08000508'), 'void sub_08000508(void) {\n}');
    await writeFile(path.join(dir, 'src', 'main_3.c'), text);
    const first = await run(dir, ['generate', '--json']);
    assert.equal(first.code, ExitCode.ok, first.stdout);
    assert.deepEqual(lines(first.stdout).filter((l) => l['type'] === 'diagnostic'), [], first.stdout);
    assert.equal(await readFile(path.join(dir, 'src', 'main_3.c'), 'utf8'), text, layout);
    await writeFile(path.join(dir, 'romlift.toml'), toml.replace('name = "main_3"', 'name = "boot"'));
    await writeFile(path.join(dir, 'src', 'boot.c'), text);
    await rm(path.join(dir, 'src', 'main_3.c'));
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.ok, out.stdout);
    assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic'), [], out.stdout);
    // Fix round 11 added the header here, and the user's macros.inc then came twice: the assembler refused.
    assert.equal(await readFile(path.join(dir, 'src', 'boot.c'), 'utf8'), text.replaceAll('asm/nonmatchings/main_3', 'asm/nonmatchings/boot'), layout);
    assert.equal((await run(dir, ['generate', '--json'])).code, ExitCode.ok, 'idempotent');
  }
});

test('a fragment in a subdirectory of src/ is not read: an insertion it might duplicate is E_C_STUB_UNPLACED, which says so (fix round 8, architecture-c0-2)', async () => {
  const dir = await initProject();
  const main2 = await readFile(path.join(dir, 'src', 'main_2.c'), 'utf8');
  assert.ok(main2.includes(stubIn('main_2', 'sub_08000488')), 'the composite as this test knows it');
  await mkdir(path.join(dir, 'src', 'inner'));
  await writeFile(path.join(dir, 'src', 'inner', 'deep.c'), `${stubIn('main_2', 'sub_08000488')}\n`);
  await writeFile(path.join(dir, 'src', 'frag.c'), '#include "inner/deep.c"\n');
  await writeFile(path.join(dir, 'src', 'main_2.c'), main2.replace(stubIn('main_2', 'sub_08000488'), '#include "frag.c"'));
  const before = await snapshot(dir);
  const refused = await run(dir, ['generate', '--json']);
  assert.equal(refused.code, ExitCode.errors, refused.stdout);
  const diagnostics = lines(refused.stdout).filter((l) => l['type'] === 'diagnostic');
  assert.deepEqual(diagnostics.map((l) => [l['code'], l['path']]), [['E_C_STUB_UNPLACED', 'src/main_2.c']], refused.stdout);
  assert.match(String(diagnostics[0]?.['message']), /#includes "inner\/deep\.c" \(line 1 of src\/frag\.c\), which romlift does not read as part of it \(it reads a src\/\*\.c directly under src\/ that is no module's source/);
  assert.deepEqual(await snapshot(dir), before, 'nothing written');
  // Moved directly under src/, as the message says: held, nothing to write.
  await writeFile(path.join(dir, 'src', 'deep.c'), `${stubIn('main_2', 'sub_08000488')}\n`);
  await writeFile(path.join(dir, 'src', 'frag.c'), '#include "deep.c"\n');
  await rm(path.join(dir, 'src', 'inner'), { recursive: true });
  const kept = await run(dir, ['generate', '--json']);
  assert.equal(kept.code, ExitCode.ok, kept.stdout);
  assert.deepEqual(lines(kept.stdout).filter((l) => l['type'] === 'diagnostic'), [], kept.stdout);
});

test('decomp.yaml naming a config other than romlift.toml is refused, nothing written: the Makefile and setup.sh hash romlift.toml (fix round 7, architecture-b2-1)', async () => {
  const dir = await initProject();
  const yaml = await readFile(path.join(dir, 'decomp.yaml'), 'utf8');
  assert.ok(yaml.includes('config: "romlift.toml"'), 'the decomp.yaml init writes');
  // The reviewer's case: the config moved to cfg/ and decomp.yaml pointed at it.
  await mkdir(path.join(dir, 'cfg'));
  await copyFile(path.join(dir, 'romlift.toml'), path.join(dir, 'cfg', 'romlift.toml'));
  await writeFile(path.join(dir, 'decomp.yaml'), yaml.replace('config: "romlift.toml"', 'config: "cfg/romlift.toml"'));
  const before = await snapshot(dir);
  for (const command of [['generate', '--json'], ['analyze', '--update', '--json'], ['model', '--json']]) {
    const out = await run(dir, command);
    assert.equal(out.code, ExitCode.errors, `${command.join(' ')}: ${out.stdout}`);
    const diagnostics = lines(out.stdout).filter((l) => l['type'] === 'diagnostic');
    assert.deepEqual(diagnostics.map((l) => [l['code'], l['path']]), [['E_DECOMP_YAML_INVALID', 'decomp.yaml']], out.stdout);
    assert.match(String(diagnostics[0]?.['message']), /tools\.romlift\.config: "cfg\/romlift\.toml" is not "romlift\.toml"/);
  }
  assert.deepEqual(await snapshot(dir), before, 'nothing written');
});

// Fix round 5 (D81 c): an odd [functions] key is refused naming it; an override that changes nothing warns.

test('a misaligned [functions] key, with or without `from`, is E_FUNCTION_MISALIGNED alone, naming the key, in generate and analyze --update (exit 1), and no file changes', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const line = text.split('\n').find((l) => /^0x0[0-9A-F]{7} = /.test(l)) ?? assert.fail('no entry');
  const addr = Number.parseInt(line.slice(2, 10), 16);
  const key = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;
  const odd = key(addr + 0x11);
  // An ARM key on a halfword that is no word, listed nowhere else.
  const half = [0x12, 0x16, 0x1a, 0x1e].map((d) => addr + d).find((a) => a % 4 === 2 && !text.includes(key(a))) ?? assert.fail('no free halfword');
  const entries = [`${odd} = "Odd"`, `${odd} = { name = "Odd", from = "legacy" }`, `${key(half)} = { name = "Odd", mode = "arm", from = "legacy" }`];
  for (const entry of entries) {
    await writeFile(file, text.replace(line, `${line}\n${entry}`));
    const before = await snapshot(dir);
    for (const command of [['generate', '--json'], ['analyze', '--update', '--json']]) {
      const out = await run(dir, command);
      assert.equal(out.code, ExitCode.errors, out.stdout);
      // The config refuses it before any analysis: no W_LISTED_INVALID beside it (architecture-b1-1).
      const diagnostics = lines(out.stdout).filter((l) => l['type'] === 'diagnostic');
      assert.deepEqual(diagnostics.map((l) => l['code']), ['E_FUNCTION_MISALIGNED'], `${command.join(' ')}: ${out.stdout}`);
      assert.match(String(diagnostics[0]?.['message']), new RegExp(`the \\[functions\\] key ${entry.slice(0, 10)} \\(Odd\\)`));
      assert.deepEqual(await snapshot(dir), before);
    }
  }
});

test('an [[overrides]] entry without runs_at that changes nothing is W_OVERRIDE_IGNORED (exit 0)', async () => {
  const dir = await initProject(FAR_JUMP.rom, []);
  const file = path.join(dir, 'romlift.toml');
  const text = await readFile(file, 'utf8');
  const line = text.split('\n').find((l) => /^0x0[0-9A-F]{7} = /.test(l)) ?? assert.fail('no entry');
  const start = line.slice(0, 10);
  for (const kind of ['data', 'code']) {
    await writeFile(file, `${text.trimEnd()}\n\n[[overrides]]\nstart = ${start}\nsize = 0x4\nkind = "${kind}"\n`);
    const out = await run(dir, ['generate', '--json']);
    assert.equal(out.code, ExitCode.ok, out.stdout);
    assert.deepEqual(lines(out.stdout).filter((l) => l['type'] === 'diagnostic').map((l) => l['code']), ['W_OVERRIDE_IGNORED'], kind);
  }
});
