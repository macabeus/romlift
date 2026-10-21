// Decompiled C through `generate` and `make` on klonoa (fix round 3, D78 a, b; correctness-a1-1, a1-4): the two edits
// of decompiled code the review of fix round 2 broke, built with agbcc to the ROM's SHA-1, in one project that holds
// only klonoa's ROM: `init`, `./setup.sh`, `make` (the control), then
//   1. sub_08028104 (a `bx lr`, which `void sub_08028104(void) {}` matches) in the NONMATCHING pattern, renamed `Nop`
//      in romlift.toml: with the C renamed alone, `generate` refuses with E_C_CONDITIONAL_STUB and writes nothing;
//      with its `#else` INCLUDE_ASM renamed too, `generate` exits 0 and `make` ends at the SHA-1;
//   2. the block replaced by the plain C and a `c` module split right after it (start 0x08028108): the zero pad that
//      now ends main_3 after a decompiled function stays its own orphan (gas would end the C object with a nop), and
//      `make` ends at the SHA-1;
//   3. (fix round 5, correctness-b0-1) the `#ifndef NONMATCHING do { … } while (0);` idiom inside Nop: `generate`
//      exits 0 with no diagnostic and `make` ends at the SHA-1, then again from the state of a fresh clone (no
//      generated file), through `./setup.sh`'s duty 5;
//   4. (correctness-b0-2) main_3 renamed `boot` with src/main_3.c moved to src/boot.c: `generate` exits 0, no stub of
//      the old directory is left, and `make` ends at the SHA-1.
// Inputs: klonoa's ROM from its dataset; agbcc from ROMLIFT_AGBCC, else bench/.local/agbcc, else
// $ROMLIFT_BENCH_ROOT/pokeemerald/tools/agbcc, else setup.sh builds it at the pin (network); binutils. A missing ROM
// makes the test `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1. test/local imports only the entry points and
// node (architecture §2), so the loop is spelled here: the source CLI as ROMLIFT_CLI, setup.sh, make and its SHA-1.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as { readonly rom: string; readonly sha1: string };
const ROM = path.join(BENCH_ROOT, dataset.rom);
const unavailable = existsSync(ROM) ? undefined : `unavailable: rom ${ROM}`;

/** The ROM `make` builds: the file `<name>.sha1` names, `<name>` being romlift.toml's [build] name (the first `name`). */
function builtRom(dir: string): string {
  const name = /^name = "([^"]+)"$/m.exec(readFileSync(path.join(dir, 'romlift.toml'), 'utf8'))?.[1];
  const named = name === undefined ? undefined : /^[0-9a-f]{40}\s+\*?(\S+)\s*$/m.exec(readFileSync(path.join(dir, `${name}.sha1`), 'utf8'))?.[1];
  if (named === undefined) throw new Error('<name>.sha1 names no ROM');
  return named;
}

/** The first agbcc build found (a directory holding bin/agbcc), or undefined: setup.sh then builds it. */
function prebuiltAgbcc(): string | undefined {
  const env = process.env['ROMLIFT_AGBCC'];
  const candidates = [...(env ? [path.resolve(REPO, env)] : []), path.join(REPO, 'bench', '.local', 'agbcc'), path.join(BENCH_ROOT, 'pokeemerald', 'tools', 'agbcc')];
  return candidates.find((dir) => existsSync(path.join(dir, 'bin', 'agbcc')));
}

const TMP = await mkdtemp(path.join(tmpdir(), 'romlift-decompiled-c-'));
after(() => rm(TMP, { recursive: true, force: true }));

const stub = (module: string, name: string): string => `INCLUDE_ASM("asm/nonmatchings/${module}", ${name});`;

interface Ran {
  readonly code: number;
  readonly out: string;
}

/** `command args` in `cwd` with `env` added; its exit code and its stdout and stderr together. */
function run(command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(command, [...args], { cwd, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

/** The last lines of a run's output, for a message. */
function tail(ran: Ran, lines = 25): string {
  return ran.out.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The codes of a `--json` run's diagnostic lines. */
function codesOf(ran: Ran): readonly string[] {
  return ran.out
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as { readonly type?: string; readonly code?: string })
    .filter((l) => l.type === 'diagnostic')
    .map((l) => l.code ?? '?');
}

test('klonoa: a renamed NONMATCHING block, a module split behind a decompiled function, the do/while idiom in a clone and a moved module build to the SHA-1', { skip: REQUIRE ? false : (unavailable ?? false), timeout: 60 * 60_000 }, async () => {
  assert.equal(unavailable, undefined, unavailable);
  const bytes = readFileSync(ROM);
  assert.deepEqual([...bytes.subarray(0x28104, 0x28108)], [0x70, 0x47, 0, 0], 'sub_08028104 is `bx lr` and a zero pad');
  const cli = path.join(TMP, 'romlift');
  await writeFile(cli, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${path.join(REPO, 'src', 'cli', 'main.ts')}' "$@"\n`);
  await chmod(cli, 0o755);
  const dir = path.join(TMP, 'klonoa');
  await mkdir(dir, { recursive: true });
  await copyFile(ROM, path.join(dir, 'baserom.gba'));
  const prebuilt = prebuiltAgbcc();
  const env = { ROMLIFT_CLI: cli };
  const file = (p: string): string => path.join(dir, ...p.split('/'));
  const init = await run(cli, ['init', 'baserom.gba', '--json'], dir);
  assert.equal(init.code, 0, tail(init));
  for (const part of ['bin', 'include', 'lib']) if (prebuilt !== undefined && existsSync(path.join(prebuilt, part))) await cp(path.join(prebuilt, part), path.join(dir, 'tools', 'agbcc', part), { recursive: true });
  const setup = await run('./setup.sh', [], dir, env);
  assert.equal(setup.code, 0, tail(setup));
  const make = async (): Promise<void> => {
    const built = await run('make', [], dir, env);
    assert.equal(built.code, 0, tail(built));
    const rom = builtRom(dir);
    assert.equal(createHash('sha1').update(readFileSync(path.join(dir, rom))).digest('hex'), dataset.sha1, `${rom} is not klonoa's ROM`);
  };
  const generate = async (): Promise<{ readonly code: number; readonly codes: readonly string[]; readonly tail: string }> => {
    const ran = await run(cli, ['generate', '--json'], dir, env);
    return { code: ran.code, codes: codesOf(ran), tail: tail(ran) };
  };
  await make();
  const toml = await readFile(file('romlift.toml'), 'utf8');
  const main3 = await readFile(file('src/main_3.c'), 'utf8');
  assert.ok(toml.includes('0x08028104 = "sub_08028104"') && main3.includes(stub('main_3', 'sub_08028104')), 'klonoa as this test knows it');

  // 1. The NONMATCHING pattern, renamed in the TOML.
  const block = (def: string, inner: string): string => `#ifdef NONMATCHING\nvoid ${def}(void) {\n}\n#else\n${stub('main_3', inner)}\n#endif`;
  await writeFile(file('src/main_3.c'), main3.replace(stub('main_3', 'sub_08028104'), block('sub_08028104', 'sub_08028104')));
  await make();
  await writeFile(file('romlift.toml'), toml.replace('0x08028104 = "sub_08028104"', '0x08028104 = "Nop"'));
  await writeFile(file('src/main_3.c'), main3.replace(stub('main_3', 'sub_08028104'), block('Nop', 'sub_08028104')));
  const half = await generate();
  assert.equal(half.code, 1, half.tail);
  assert.ok(half.codes.includes('E_C_CONDITIONAL_STUB'), half.tail);
  await writeFile(file('src/main_3.c'), main3.replace(stub('main_3', 'sub_08028104'), block('Nop', 'Nop')));
  const renamed = await generate();
  assert.equal(renamed.code, 0, renamed.tail);
  await make();

  // 2. The plain C, and a c module split right after it.
  await writeFile(file('src/main_3.c'), main3.replace(stub('main_3', 'sub_08028104'), 'void Nop(void) {\n}'));
  const split = toml.replace('0x08028104 = "sub_08028104"', '0x08028104 = "Nop"').replace('[[modules]]\nname = "main_4"', '[[modules]]\nname = "m3b"\nstart = 0x08028108\nkind = "c"\n\n[[modules]]\nname = "main_4"');
  assert.notEqual(split, toml.replace('0x08028104 = "sub_08028104"', '0x08028104 = "Nop"'), 'main_4 follows main_3');
  await writeFile(file('romlift.toml'), split);
  const moved = await generate();
  assert.equal(moved.code, 0, moved.tail);
  const reconciled = await readFile(file('src/main_3.c'), 'utf8');
  assert.ok(reconciled.includes(`void Nop(void) {\n}\n${stub('main_3', 'unk_08028106')}`), 'the pad is its own orphan after the decompiled function');
  await make();

  // 3. The matching idiom of correctness-b0-1: `do {` and `} while (0);` each behind #ifndef NONMATCHING, which the
  //    scanner reads as the compiler does; then the project as a fresh clone has it (no generated file, R4), whose
  //    ./setup.sh runs `romlift generate` (duty 5) before make.
  const idiom = 'void Nop(void) {\n#ifndef NONMATCHING\n    do {\n#endif\n#ifndef NONMATCHING\n    } while (0);\n#endif\n}';
  await writeFile(file('src/main_3.c'), reconciled.replace('void Nop(void) {\n}', idiom));
  const kept = await generate();
  assert.equal(kept.code, 0, kept.tail);
  assert.deepEqual(kept.codes, [], kept.tail);
  await make();
  for (const generated of ['asm', 'data', 'ldscript.txt', 'symbols.ld', 'modules.mk', '.romlift', 'build']) await rm(file(generated), { recursive: true, force: true });
  const cloned = await run('./setup.sh', [], dir, env);
  assert.equal(cloned.code, 0, tail(cloned));
  assert.ok(existsSync(file('modules.mk')), 'setup.sh generated the tree');
  await make();

  // 4. A c module renamed with its source moved by hand (correctness-b0-2): the old directory's stubs go, the C stays.
  const before = await readFile(file('src/main_3.c'), 'utf8');
  await writeFile(file('romlift.toml'), split.replace('name = "main_3"', 'name = "boot"'));
  await writeFile(file('src/boot.c'), before);
  await rm(file('src/main_3.c'));
  const renamedModule = await generate();
  assert.equal(renamedModule.code, 0, renamedModule.tail);
  const boot = await readFile(file('src/boot.c'), 'utf8');
  assert.ok(!boot.includes('asm/nonmatchings/main_3'), 'no stub of the old directory is left');
  assert.ok(boot.includes(idiom) && boot.includes(stub('boot', 'unk_08028106')), 'the C kept, the stubs in the new directory');
  await make();
});
