// The stub assembly against the real compilers (architecture §6.4, §6.6, D74 f; roadmap 4.C, p4-c-modules): the
// proof the text-layout check and the assemble and link checks rely on when they lay out and assemble a C unit without
// a compiler. For two committed fixtures (mixer-tiled-hole, three C modules; pops-unpushed-frame, two) and klonoa, the
// tree of the discover-mode model (configFromDiscover's config, so every agbcc-shaped module is a C unit) is written
// with include/include_asm.h and include/macros.inc; then every emitted src/<m>.c goes through the frozen pipeline,
// `cc -E -x c -nostdinc -undef -I include` then tools/agbcc/bin/<compiler> with the module's flags, with both agbcc and
// old_agbcc, and
//   - the compiler's assembly must equal stubUnitAssembly(model, module) with the module's compiler set to that
//     compiler (the banner is the module's build compiler's, architecture-r1-4), byte for byte, and
//   - its object (`arm-none-eabi-as -mcpu=arm7tdmi`) must have the .text bytes and the .text alignment of the object
//     built from the stub assembly (what link-check.ts assembles), which is as long as the module's ROM range (that
//     those bytes link to the ROM is g3.link's and emission-real.test.ts's proof).
//
// Inputs: the checkout's agbcc, tools/agbcc with bin/agbcc and bin/old_agbcc (built by `npm run agbcc`, D120); the host C compiler `cc` (HOSTCC overrides it); binutils; klonoa's ROM
// from its dataset. A missing input makes a test `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1. test/local
// imports romlift only through its entry points (architecture §2).
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  INCLUDE_ASM_HEADER,
  INCLUDE_ASM_HEADER_PATH,
  type Model,
  type Rom,
  analyze,
  buildModel,
  buildUnits,
  cAssemblyPath,
  configFromDiscover,
  emitTree,
  isCSource,
  profileById,
  romFromBytes,
  stubUnitAssembly,
} from 'romlift';
import { DIALECT } from 'romlift';
import { findBinutils, sha1Of } from 'romlift/node';

const run = promisify(execFile);

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const AGBCC = path.join(REPO, 'tools', 'agbcc');
const HOSTCC = process.env['HOSTCC'] ?? 'cc';
const COMPILERS = ['agbcc', 'old_agbcc'] as const;
const FIXTURES = ['mixer-tiled-hole', 'pops-unpushed-frame'] as const;

function agbccProfile(): NonNullable<ReturnType<typeof profileById>> {
  const found = profileById('agbcc');
  if (found === undefined) throw new Error('the agbcc profile is not registered');
  return found;
}

const profile = agbccProfile();
const tools = findBinutils(process.env);
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

/** Why the compilers or binutils cannot run here, or undefined. */
function missingTools(): string | undefined {
  for (const id of COMPILERS)
    if (!existsSync(path.join(AGBCC, 'bin', id))) return `unavailable: ${path.join(AGBCC, 'bin', id)} (npm run agbcc)`;
  return 'code' in tools ? `unavailable: ${tools.message}` : undefined;
}

/** Writes the generated tree of `model` (every entry with a text) and the two headers the C units include. */
async function writeTree(name: string, rom: Rom, model: Model): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `romlift-c-stub-${name}-`));
  roots.push(dir);
  const files = new Map<string, string>([
    [INCLUDE_ASM_HEADER_PATH, INCLUDE_ASM_HEADER],
    [DIALECT.macrosPath, DIALECT.macrosInc],
  ]);
  for (const e of emitTree(rom, model, { decomp: { defined: [] } })) if ('text' in e) files.set(e.path, e.text);
  for (const [file, text] of files) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), text);
  }
  await writeFile(path.join(dir, 'baserom.gba'), rom.bytes);
  return dir;
}

/** The .text bytes and the .text alignment (sh_addralign) of an object, from objcopy and readelf's section table. */
async function textOf(dir: string, object: string): Promise<{ readonly bytes: Uint8Array; readonly align: number }> {
  if ('code' in tools) throw new Error(tools.message);
  const bin = `${object}.text.bin`;
  await run(tools.objcopy, ['-O', 'binary', '-j', '.text', object, bin], { cwd: dir });
  const bytes = new Uint8Array(await readFile(path.join(dir, bin)));
  // sh_addralign of .text from the ELF section headers (32-bit little-endian ELF).
  const elf = new Uint8Array(await readFile(path.join(dir, object)));
  const view = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const shoff = view.getUint32(0x20, true);
  const shentsize = view.getUint16(0x2e, true);
  const shnum = view.getUint16(0x30, true);
  const shstrndx = view.getUint16(0x32, true);
  const strtab = view.getUint32(shoff + shstrndx * shentsize + 0x10, true);
  for (let i = 0; i < shnum; i++) {
    const base = shoff + i * shentsize;
    const nameAt = strtab + view.getUint32(base, true);
    let name = '';
    for (let k = nameAt; elf[k] !== 0 && k < elf.length; k++) name += String.fromCharCode(elf[k] ?? 0);
    if (name === '.text') return { bytes, align: view.getUint32(base + 0x20, true) };
  }
  throw new Error(`${object} has no .text`);
}

/** Assembles `source` to `object` in `dir` as link-check.ts does. */
async function assemble(dir: string, source: string, object: string): Promise<void> {
  if ('code' in tools) throw new Error(tools.message);
  await mkdir(path.dirname(path.join(dir, object)), { recursive: true });
  await run(tools.as, [...DIALECT.asArgs, '-I', dir, '-o', object, source], { cwd: dir });
}

interface UnitProof {
  readonly module: string;
  readonly compiler: string;
  readonly bytes: number;
}

/** Every C unit of `model` through the real pipeline with each compiler, compared with the stub assembly. */
async function proveUnits(name: string, rom: Rom, model: Model): Promise<readonly UnitProof[]> {
  const dir = await writeTree(name, rom, model);
  const units = buildUnits(model);
  const proofs: UnitProof[] = [];
  for (const [i, unit] of units.entries()) {
    const module = model.modules[i];
    if (module === undefined || !isCSource(unit.source)) continue;
    const expected = stubUnitAssembly(model, module);
    // The stub assembly as link-check.ts assembles it.
    const stubSource = `build/stub/${module.name}.s`;
    await mkdir(path.join(dir, 'build/stub'), { recursive: true });
    await writeFile(path.join(dir, stubSource), expected);
    await assemble(dir, stubSource, `build/stub/${module.name}.o`);
    const stub = await textOf(dir, `build/stub/${module.name}.o`);
    const range = rom.bytes.subarray(module.span.start - rom.base, module.span.end - rom.base);
    assert.equal(
      stub.bytes.length,
      range.length,
      `${name} ${module.name}: the stub object's .text is the module's length`,
    );

    const { stdout: preprocessed } = await run(
      HOSTCC,
      ['-E', '-x', 'c', '-nostdinc', '-undef', '-I', 'include', unit.source],
      { cwd: dir, maxBuffer: 1 << 26 },
    );
    const input = `build/src/${module.name}.i`;
    await mkdir(path.join(dir, 'build/src'), { recursive: true });
    await writeFile(path.join(dir, input), preprocessed);
    for (const compiler of COMPILERS) {
      const output: string =
        compiler === module.compiler ? cAssemblyPath(module.name) : `build/src/${module.name}.${compiler}.s`;
      await run(path.join(AGBCC, 'bin', compiler), [...module.cflags, input, '-o', output], { cwd: dir });
      const compiled: string = await readFile(path.join(dir, output), 'utf8');
      const encoded: string =
        compiler === module.compiler ? expected : stubUnitAssembly(model, { ...module, compiler });
      assert.equal(
        compiled,
        encoded,
        `${name} ${module.name}: ${compiler}'s assembly is the stub assembly of a module built with ${compiler}`,
      );
      const object = `${output.slice(0, -2)}.o`;
      await assemble(dir, output, object);
      const text = await textOf(dir, object);
      assert.deepEqual(
        text,
        stub,
        `${name} ${module.name}: ${compiler}'s object has the stub object's .text and alignment`,
      );
      proofs.push({ module: module.name, compiler, bytes: text.bytes.length });
    }
  }
  return proofs;
}

/** The discover-mode model of a ROM: the config configFromDiscover builds, every agbcc-shaped module a C unit. */
function modelOf(rom: Rom): Model {
  const analysis = analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
  return buildModel(rom, analysis, configFromDiscover(rom, analysis));
}

const unavailableTools = missingTools();

for (const fixture of FIXTURES) {
  test(
    `c stubs of fixture ${fixture} compile to the stub assembly with agbcc and old_agbcc`,
    { skip: REQUIRE ? false : (unavailableTools ?? false) },
    async (t) => {
      assert.equal(unavailableTools, undefined, unavailableTools);
      const bytes = new Uint8Array(
        readFileSync(path.join(REPO, 'bench', 'dataset', 'synthetic', fixture, 'build', `${fixture}.gba`)),
      );
      const rom = romFromBytes(bytes, sha1Of(bytes));
      const proofs = await proveUnits(fixture, rom, modelOf(rom));
      assert.ok(proofs.length >= 4, `${fixture}: ${proofs.length} compiled units`);
      t.diagnostic(
        `${fixture}: ${proofs.length / COMPILERS.length} C units, each compiled by ${COMPILERS.join(' and ')} to the stub assembly (${proofs.filter((p) => p.compiler === 'agbcc').reduce((n, p) => n + p.bytes, 0)} bytes of .text)`,
      );
    },
  );
}

{
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as {
    readonly rom: string;
    readonly sha1: string;
  };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = unavailableTools ?? (existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`);
  test(
    'c stubs of klonoa compile to the stub assembly with agbcc and old_agbcc',
    { skip: REQUIRE ? false : (unavailable ?? false) },
    async (t) => {
      assert.equal(unavailable, undefined, unavailable);
      const bytes = new Uint8Array(readFileSync(romPath));
      const sha1 = sha1Of(bytes);
      assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
      const rom = romFromBytes(bytes, sha1);
      const proofs = await proveUnits('klonoa', rom, modelOf(rom));
      assert.ok(proofs.length > 0, 'klonoa has C units');
      t.diagnostic(
        `klonoa: ${proofs.length / COMPILERS.length} C units, each compiled by ${COMPILERS.join(' and ')} to the stub assembly (${proofs.filter((p) => p.compiler === 'agbcc').reduce((n, p) => n + p.bytes, 0)} bytes of .text)`,
      );
    },
  );
}
