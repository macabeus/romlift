// The phase-4 fixtures (architecture §8.1, D74): composite, multi-compiler and c-data, read from the repository
// alone. Their expect.json keys have the shapes the g4 gates read (g4.e2e-fixtures: `init.args`,
// `illegalBorder {module, start}`; g4.multi-compiler: `compilers {<module>: {compiler, cflags}}`); the module
// names they give are the C proposals inferModules makes under `init.args` from the seedless discover run, as
// `init` will (configFromDiscover); the composite has at least three C modules with legal borders inside them
// (g4.toml-mutations) and an illegal border that no legal border equals, between its module's neighbours, so
// `generate` must refuse it with E_MODULE_BORDER; each overlay/src/<module>.c defines, under the names `init`
// gives, exactly the functions of its module (multi-compiler: of every C module; c-data: with a const array).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { BUILD_COMPILERS, codeLayout, configFromDiscover, DEFAULT_BUILD_COMPILER, discover, inferModules, isLegalStart, legalStartsBetween, profileById, type AnalysisResult, type Rom } from 'romlift';

import { listSyntheticFixtures, readExpect, readFixtureRom, type SyntheticFixture } from '../../helpers/fixtures.ts';

const FIXTURES = listSyntheticFixtures();

interface ModuleProposal {
  readonly name: string;
  readonly start: number;
  readonly kind: string;
  readonly end: number;
}

interface Phase4 {
  readonly fixture: SyntheticFixture;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly rom: Rom;
  readonly analysis: AnalysisResult;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const hex = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function load(name: string): Phase4 {
  const fixture = FIXTURES.find((f) => f.name === name);
  assert.ok(fixture !== undefined, `no fixture ${name}`);
  const raw: unknown = JSON.parse(readFileSync(fixture.expect, 'utf8'));
  assert.ok(isRecord(raw), `${name}/expect.json is not an object`);
  readExpect(fixture);
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  const rom = readFixtureRom(fixture);
  return { fixture, raw, rom, analysis: discover(rom, { profile }) };
}

/** `init.args` of an expect.json (empty when absent), checked to be a string array. */
function initArgs(p: Phase4): readonly string[] {
  const init = p.raw['init'];
  if (init === undefined) return [];
  assert.ok(isRecord(init), `${p.fixture.name}: init is not an object`);
  assert.deepEqual(Object.keys(init), ['args'], `${p.fixture.name}: init holds only args`);
  const args = init['args'];
  assert.ok(isStringArray(args), `${p.fixture.name}: init.args is not a string array`);
  return args;
}

/** The module size `--module-size` of init.args gives, or undefined (inferModules' default). */
function moduleSizeOf(args: readonly string[]): number | undefined {
  const at = args.indexOf('--module-size');
  if (at < 0) return undefined;
  const value = args[at + 1];
  assert.ok(value !== undefined && /^(0x[0-9A-Fa-f]+|[0-9]+)$/.test(value), `--module-size ${String(value)}`);
  return Number(value);
}

/** inferModules' module proposals under init.args, each with its end (the next start, or the ROM end). */
function modulesOf(p: Phase4): readonly ModuleProposal[] {
  const size = moduleSizeOf(initArgs(p));
  const proposals = inferModules(p.rom, p.analysis, size === undefined ? {} : { moduleSize: size }).flatMap((m) => (m.kind === 'module' ? [{ name: m.name, start: m.start, kind: m.moduleKind }] : []));
  return proposals.map((m, i) => ({ ...m, end: proposals[i + 1]?.start ?? p.rom.end }));
}

/** The names of the top-level function definitions of a C text: `<type> name(...)` at the start of a line, then `{`. */
function definedFunctions(text: string): readonly string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\(.*\)$/.exec(lines[i] ?? '');
    if (m?.[1] !== undefined && lines[i + 1] === '{') out.push(m[1]);
  }
  return out.sort(byCodeUnit);
}

/** The default names `init` gives the functions whose entries lie in [start, end). */
function functionsIn(p: Phase4, module: ModuleProposal): readonly string[] {
  const size = moduleSizeOf(initArgs(p));
  const config = configFromDiscover(p.rom, p.analysis, size === undefined ? {} : { moduleSize: size });
  return [...config.functions.entries()].filter(([addr]) => addr >= module.start && addr < module.end).map(([, f]) => f.name).sort(byCodeUnit);
}

function overlayModules(p: Phase4): readonly string[] {
  const dir = join(p.fixture.dir, 'overlay', 'src');
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.c')).map((n) => n.slice(0, -2)).sort(byCodeUnit) : [];
}

function overlayText(p: Phase4, module: string): string {
  return readFileSync(join(p.fixture.dir, 'overlay', 'src', `${module}.c`), 'utf8');
}

test('the three phase-4 fixtures are committed', () => {
  for (const name of ['composite', 'multi-compiler', 'c-data']) assert.ok(FIXTURES.some((f) => f.name === name), name);
});

test('composite: init.args is --module-size 0x200, which gives at least three C modules with legal borders inside them', () => {
  const p = load('composite');
  assert.deepEqual(initArgs(p), ['--module-size', '0x200']);
  // core/layout's one legal-start rule (architecture-r1-3).
  const layout = codeLayout(p.rom, p.analysis);
  const modules = modulesOf(p);
  for (const m of modules) assert.ok(isLegalStart(layout, m.start), `${m.name} starts at ${hex(m.start)}, no legal border`);
  const c = modules.filter((m) => m.kind === 'c');
  assert.ok(c.length >= 3, `${c.length} C modules`);
  const split = c.filter((m) => legalStartsBetween(layout, m.start, m.end).length > 0);
  assert.ok(split.length >= 3, `C modules with a legal border inside: ${split.map((m) => m.name).join(', ')}`);
  assert.ok(modules.some((m) => m.kind === 'asm' && m.name.startsWith('asm_')), 'an assembly-only module');
  assert.ok(modules.some((m) => m.kind === 'data'), 'a data module');
  assert.deepEqual(overlayModules(p), []);
});

test("composite: illegalBorder names a C module and a start between its neighbours that is no legal border", () => {
  const p = load('composite');
  const border = p.raw['illegalBorder'];
  assert.ok(isRecord(border), 'illegalBorder is an object');
  assert.deepEqual(Object.keys(border).sort(byCodeUnit), ['module', 'start']);
  const module = border['module'];
  const start = border['start'];
  assert.ok(typeof module === 'string');
  assert.ok(typeof start === 'string' && /^0x[0-9A-F]{8}$/.test(start), `start ${String(start)} is "0x" and eight upper-case digits`);
  const modules = modulesOf(p);
  const at = modules.findIndex((m) => m.name === module);
  const target = modules[at];
  assert.ok(target !== undefined && at > 0, `${module} is a module after the first`);
  assert.equal(target.kind, 'c');
  const addr = Number(start);
  const previous = modules[at - 1];
  assert.ok(previous !== undefined && addr > previous.start && addr < target.end, `${start} lies between ${previous?.name ?? '?'} and the module after ${module}`);
  assert.notEqual(addr, target.start);
  assert.ok(!isLegalStart(codeLayout(p.rom, p.analysis), addr), `${start} is a legal border`);
});

test('multi-compiler: the named modules are C proposals under init.args, built with old_agbcc and flags; another C module stays on agbcc', () => {
  const p = load('multi-compiler');
  const modules = modulesOf(p);
  const c = modules.filter((m) => m.kind === 'c').map((m) => m.name);
  const compilers = p.raw['compilers'];
  assert.ok(isRecord(compilers), 'compilers is an object');
  const named = Object.keys(compilers).sort(byCodeUnit);
  assert.ok(named.length > 0);
  for (const name of named) {
    assert.ok(c.includes(name), `${name} is no C proposal of inferModules (${c.join(', ')})`);
    const spec = compilers[name];
    assert.ok(isRecord(spec), `${name}: not an object`);
    assert.ok(Object.keys(spec).every((k) => k === 'compiler' || k === 'cflags'), `${name}: keys ${Object.keys(spec).join(', ')}`);
    const compiler = spec['compiler'];
    assert.ok(typeof compiler === 'string' && Object.hasOwn(BUILD_COMPILERS, compiler), `${name}: compiler ${String(compiler)} is not registered`);
    assert.notEqual(compiler, DEFAULT_BUILD_COMPILER);
    assert.ok(spec['cflags'] === undefined || isStringArray(spec['cflags']), `${name}: cflags is not a string array`);
  }
  assert.deepEqual(named, ['main_2']);
  assert.deepEqual(compilers['main_2'], { compiler: 'old_agbcc', cflags: ['-mno-thumb-interwork'] });
  assert.ok(c.some((m) => !named.includes(m)), 'a C module stays on agbcc');
});

test('multi-compiler: each source is its own C module, and overlay/src holds every C module defining exactly its functions', () => {
  const p = load('multi-compiler');
  const modules = modulesOf(p);
  assert.deepEqual(modules.map((m) => `${m.name}:${m.kind}@${hex(m.start)}`), ['rom_header:asm@0x08000000', 'crt0:asm@0x080000C0', 'main:c@0x080000F4', 'main_2:c@0x08000174']);
  const c = modules.filter((m) => m.kind === 'c');
  assert.deepEqual(overlayModules(p), c.map((m) => m.name).sort(byCodeUnit));
  for (const m of c) assert.deepEqual(definedFunctions(overlayText(p, m.name)), functionsIn(p, m), m.name);
  const mk = readFileSync(p.fixture.buildMk, 'utf8');
  assert.match(mk, /^SRCS := main\.c old\.c$/m);
  assert.match(mk, /^OLD_AGBCC_SRCS := old\.c$/m);
  assert.match(mk, /^CFLAGS_old := -mno-thumb-interwork$/m);
});

test('c-data: one C module, whose overlay defines its functions and a const array, with a stub right after the array', () => {
  const p = load('c-data');
  assert.equal(p.raw['init'], undefined);
  const modules = modulesOf(p);
  const c = modules.filter((m) => m.kind === 'c');
  assert.deepEqual(c.map((m) => m.name), ['main']);
  assert.ok(modules.some((m) => m.kind === 'data'), 'the table is a data tail');
  assert.deepEqual(overlayModules(p), ['main']);
  const text = overlayText(p, 'main');
  assert.match(text, /^const unsigned short \w+\[\d+\] = \{[^}]+\};$/m);
  const main = c[0];
  assert.ok(main !== undefined);
  // Its first function stays an INCLUDE_ASM right after the const array, where agbcc is still in .rodata (D112).
  const stub = /^INCLUDE_ASM\("asm\/nonmatchings\/main", (\w+)\);$/m.exec(text)?.[1];
  assert.equal(stub, functionsIn(p, main)[0]);
  assert.deepEqual([stub, ...definedFunctions(text)], functionsIn(p, main));
});
