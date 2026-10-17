// The committed synthetic fixtures (architecture §8.1, D28), read from the repository alone: no
// toolchain. Every fixture directory has its sources, a build.mk with both toolchain records, an
// expect.json and both build files; every expected entry is a FUNC symbol of the fixture's own ELF
// with that mode and, when given, that extent; the entries are exactly the ELF's functions in the ROM,
// the two startup functions first, and every expect.json is exhaustive (negative: true), so a false
// entry fails any fixture; every .gba passes checkRom.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkRom, elfFunctions, parseElf, ROM_BASE, type ElfFile, type ElfFunction } from 'romlift';

import { parseToolchainRecord } from '../../../bench/tools/fixtures.ts';
import { listSyntheticFixtures, parseExpect, readExpect, SYNTHETIC_ROOT, type SyntheticFixture } from '../../helpers/fixtures.ts';

const FIXTURES = listSyntheticFixtures();

/**
 * The fixtures of architecture §8.1: the thirteen positive ones of the plan, the rule-specific ones that
 * make a rule load-bearing that no other fixture does (seven from the phase-2 brief, four added for
 * g2.rule-coverage), and seven negative ones (six from the brief, one added for g2.rule-coverage).
 */
const POSITIVE = [
  'arm-pools-in-front', 'bx-lr-stub-chain', 'bx-pc-veneer', 'code-copied-to-ram', 'data-table-between-functions',
  'far-jump', 'handwritten-2mod4', 'leaf-handler-pointer-table', 'noreturn-call-then-next', 'shared-tail',
  'swi-reset', 'table-jump-hoisted', 'unreferenced-leaf', 'ram-code-entries', 'data-named-between-data',
];
const RULE_SPECIFIC = [
  'adr-handler-block', 'dead-code-in-extent', 'local-subroutine', 'mixer-tiled-hole', 'mov-lr-pc-bx',
  'pops-unpushed-frame', 'prologueless-thumb-over-arm', 'computed-jump-callback', 'large-data-referenced',
  'inline-arm-switch', 'recursive-far-call', 'gap-resume-2mod4', 'veneer-array', 'push-lr-2mod4', 'pointer-word-in-gap',
  'entry-stub-table', 'ram-copy-memcpy', 'ram-copy-bios', 'ram-copy-setup-bound', 'ram-copy-call-via', 'ram-copy-entry-boundaries',
];
const NEGATIVE = [
  'code-end-data-decodes', 'data-thumb-push-pop', 'false-stub-2byte', 'pointer-table-before-leaf', 'pool-padded-46c0',
  'pool-word-push-lr', 'thumb-pointer-run', 'adr-label-and-data',
];

/** The startup region of common/crt0.s: these FUNC symbols, both ARM, which every expect.json lists first. */
const STARTUP = ['_start', 'start_vector'];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function elfOf(fixture: SyntheticFixture): ElfFile {
  const parsed = parseElf(new Uint8Array(readFileSync(fixture.elf)));
  assert.ok(parsed.ok, `${fixture.name}: ${parsed.ok ? '' : parsed.error}`);
  return parsed.value;
}

function romSize(fixture: SyntheticFixture): number {
  return statSync(fixture.rom).size;
}

/** The ELF functions inside the ROM. */
function functionsOf(fixture: SyntheticFixture): readonly ElfFunction[] {
  return elfFunctions(elfOf(fixture), { start: ROM_BASE, end: ROM_BASE + romSize(fixture) });
}

/** The end of the startup region: the end of start_vector, word-aligned (the PoC's startup getter on crt0). */
function startupEnd(fixture: SyntheticFixture): number {
  const vector = elfOf(fixture).symbols.find((s) => s.name === 'start_vector' && s.type === 'func');
  assert.ok(vector !== undefined, `${fixture.name}: no start_vector`);
  return (vector.addr + vector.size + 3) & ~3;
}

function buildMkValue(text: string, key: string): string | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${key} := `));
  return line?.slice(key.length + 4).trim();
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const hex = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;

test('the 44 fixtures are committed, and common/ is not one', () => {
  const names = FIXTURES.map((f) => f.name);
  assert.deepEqual(names, [...POSITIVE, ...RULE_SPECIFIC, ...NEGATIVE].sort(byCodeUnit));
  assert.ok(!names.includes('common'));
  for (const name of names) assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${name} is not kebab-case`);
  const dirs = readdirSync(SYNTHETIC_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.deepEqual(dirs.filter((d) => !names.includes(d)), ['common'], 'every other directory is a committed fixture');
});

test('the shared files are in common/: crt0.s, the linker script, the make rules and the macros', () => {
  for (const file of ['crt0.s', 'rom.ld', 'rules.mk', 'macros.inc']) assert.ok(isFile(join(SYNTHETIC_ROOT, 'common', file)), file);
  assert.ok(!isFile(join(SYNTHETIC_ROOT, 'common', 'build', 'common.gba')));
});

test('every fixture has its sources, a build.mk with both toolchain records, an expect.json and both build files', () => {
  for (const f of FIXTURES) {
    assert.ok(isFile(f.buildMk), `${f.name}: build.mk`);
    const mk = readFileSync(f.buildMk, 'utf8');
    assert.equal(buildMkValue(mk, 'NAME'), f.name, `${f.name}: NAME`);
    const sources = (buildMkValue(mk, 'SRCS') ?? '').split(/\s+/).filter((s) => s !== '');
    assert.ok(sources.length > 0, `${f.name}: SRCS`);
    for (const source of sources) {
      assert.match(source, /^[a-z0-9_-]+\.(s|c)$/, `${f.name}: source ${source}`);
      assert.ok(isFile(join(f.dir, source)), `${f.name}: ${source} is missing`);
    }
    assert.match(mk, /^include \.\.\/common\/rules\.mk$/m, `${f.name}: includes the shared rules`);
    const record = parseToolchainRecord(mk);
    assert.ok(!('missing' in record), `${f.name}: toolchain record ${'missing' in record ? record.missing.join(', ') : ''}`);
    assert.match(record.agbccCommit, /^[0-9a-f]{40}$/, `${f.name}: AGBCC_COMMIT`);
    assert.match(record.asVersion, /^GNU assembler /, `${f.name}: AS_VERSION`);
    assert.ok(isFile(f.expect), `${f.name}: expect.json`);
    assert.ok(isFile(f.rom) && isFile(f.elf), `${f.name}: build files`);
    const built = readdirSync(join(f.dir, 'build')).sort(byCodeUnit);
    assert.deepEqual(built, [`${f.name}.elf`, `${f.name}.gba`], `${f.name}: build/ holds only the two build files`);
  }
});

test('every fixture records the agbcc commit fixtures.yml builds', () => {
  const workflow = readFileSync(join(SYNTHETIC_ROOT, '..', '..', '..', '.github', 'workflows', 'fixtures.yml'), 'utf8');
  const pinned = /^\s*AGBCC_COMMIT: ([0-9a-f]{40})$/m.exec(workflow)?.[1];
  assert.ok(pinned !== undefined, 'fixtures.yml pins AGBCC_COMMIT');
  for (const f of FIXTURES) {
    const record = parseToolchainRecord(readFileSync(f.buildMk, 'utf8'));
    assert.ok(!('missing' in record) && record.agbccCommit === pinned, `${f.name} records another agbcc commit`);
  }
});

test('C sources hold no comment and no directive, since agbcc reads them without a preprocessor', () => {
  for (const f of FIXTURES) {
    for (const file of readdirSync(f.dir).filter((n) => n.endsWith('.c'))) {
      const text = readFileSync(join(f.dir, file), 'utf8');
      assert.ok(!/\/\*|\/\/|^\s*#/m.test(text), `${f.name}/${file}`);
    }
  }
});

test('every committed .gba is a cartridge that checkRom accepts, starting with an ARM b', () => {
  for (const f of FIXTURES) {
    const bytes = new Uint8Array(readFileSync(f.rom));
    assert.deepEqual(checkRom(bytes), [], f.name);
    assert.equal(bytes[3], 0xea, `${f.name}: the word at 0x08000000 is an ARM b`);
    assert.ok(bytes.length <= 16 * 1024, `${f.name}: ${bytes.length} bytes is more than a few KiB`);
    assert.equal(elfOf(f).entry, ROM_BASE, `${f.name}: the ELF entry is the cartridge start`);
  }
});

test('every fixture starts with the startup region of common/crt0.s, which its expect.json lists first, without extents', () => {
  for (const f of FIXTURES) {
    const startup = functionsOf(f).filter((fn) => fn.addr < startupEnd(f));
    assert.deepEqual(startup.map((fn) => fn.name), STARTUP, f.name);
    const listed = readExpect(f).entries.filter((entry) => entry.addr < startupEnd(f));
    assert.deepEqual(listed, startup.map((fn) => ({ addr: fn.addr, mode: 'arm' })), `${f.name}: the startup entries of expect.json`);
  }
});

test('every expect.json entry is a FUNC symbol of the fixture with its mode and, when given, its ELF size', () => {
  for (const f of FIXTURES) {
    const byAddr = new Map(functionsOf(f).map((fn) => [fn.addr, fn] as const));
    for (const entry of readExpect(f).entries) {
      const fn = byAddr.get(entry.addr);
      assert.ok(fn !== undefined, `${f.name}: ${hex(entry.addr)} is no FUNC symbol`);
      assert.equal(entry.mode, fn.thumb ? 'thumb' : 'arm', `${f.name}: ${fn.name} mode`);
      if (entry.extent === undefined) continue;
      const extent = entry.extent.end - entry.extent.start;
      const padded = extent + ((4 - (extent & 3)) & 3);
      assert.ok(fn.size === extent || fn.size === padded, `${f.name}: ${fn.name} extent ${extent}, ELF size ${fn.size}`);
    }
  }
});

test('the entries are exactly the ELF functions in the ROM', () => {
  for (const f of FIXTURES) {
    const expected = readExpect(f).entries.map((e) => hex(e.addr));
    const elf = functionsOf(f).map((fn) => hex(fn.addr));
    assert.deepEqual(expected, elf, f.name);
  }
});

test('every expect.json is exhaustive: negative, so no entry beyond its real functions is allowed, the seven negative fixtures included', () => {
  const exhaustive = FIXTURES.filter((f) => readExpect(f).negative).map((f) => f.name);
  assert.deepEqual(exhaustive, FIXTURES.map((f) => f.name));
  for (const name of NEGATIVE) assert.ok(exhaustive.includes(name), name);
});

test('a code end, where given, is the end of the last ELF function in the ROM', () => {
  let withCodeEnd = 0;
  for (const f of FIXTURES) {
    const expect = readExpect(f);
    if (expect.codeEnd === undefined) continue;
    withCodeEnd++;
    const last = Math.max(...functionsOf(f).map((fn) => fn.addr + fn.size));
    assert.equal(hex(expect.codeEnd), hex(last), f.name);
    assert.ok(expect.codeEnd < ROM_BASE + romSize(f), `${f.name}: data follows the code end`);
  }
  assert.ok(withCodeEnd >= 2);
});

test('code copied to RAM has its FUNC symbol outside the ROM', () => {
  const f = FIXTURES.find((x) => x.name === 'code-copied-to-ram');
  assert.ok(f !== undefined);
  const ram = elfOf(f).symbols.find((s) => s.name === 'IwramDouble');
  assert.ok(ram !== undefined && ram.type === 'func' && ram.addr === 0x0300_0000);
});

test('the handwritten-2mod4 fixture has its entry at 2 mod 4', () => {
  const f = FIXTURES.find((x) => x.name === 'handwritten-2mod4');
  assert.ok(f !== undefined);
  const jump = functionsOf(f).find((fn) => fn.name === 'JumpAdd');
  assert.ok(jump !== undefined && (jump.addr & 3) === 2 && jump.thumb);
});

test('parseExpect accepts the frozen shape and rejects what the gate could not read', () => {
  const ok = parseExpect('{"negative": true, "entries": [{"addr": "0x080000F4", "mode": "thumb", "extent": {"start": "0x080000F4", "end": "0x08000100"}}], "codeEnd": "0x08000100"}', 'x');
  assert.deepEqual(ok, { negative: true, entries: [{ addr: 0x080000f4, mode: 'thumb', extent: { start: 0x080000f4, end: 0x08000100 } }], codeEnd: 0x08000100 });
  assert.deepEqual(parseExpect('{"entries": [{"addr": 134217972, "mode": "arm"}]}', 'x'), { negative: false, entries: [{ addr: 0x080000f4, mode: 'arm' }] });
  const bad = [
    '[]',
    '{"entries": []}',
    '{"entries": [{"addr": "08000000", "mode": "thumb"}]}',
    '{"entries": [{"addr": "0x08000000", "mode": "Thumb"}]}',
    '{"entries": [{"addr": "0x08000004", "mode": "thumb"}, {"addr": "0x08000000", "mode": "thumb"}]}',
    '{"entries": [{"addr": "0x08000000", "mode": "thumb", "extent": {"start": "0x08000002", "end": "0x08000004"}}]}',
    '{"entries": [{"addr": "0x08000000", "mode": "thumb"}], "negative": "yes"}',
    '{"entries": [{"addr": "0x08000000", "mode": "thumb"}], "about": "x"}',
  ];
  for (const text of bad) assert.throws(() => parseExpect(text, 'x'), /x/, text);
});
