// The in-memory config schema (architecture §3.4, §6.5, D62): the illustrative file of §6.5, built in
// memory, validates; a bad compiler id, a bad name, an unknown member or a phase-5 key does not, and every
// issue comes back at once with its path.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateConfig } from '../../../src/core/config/schema.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';

/** §6.5's example, in memory. */
const EXAMPLE: RomliftConfig = {
  schema: 1,
  rom: { path: 'baserom.gba', sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b' },
  build: { name: 'klonoa-eod', compiler: 'agbcc' },
  signatures: { enabled: true },
  modules: [
    { name: 'crt0', start: 0x0800_00c0, kind: 'asm', generated: true },
    { name: 'main', start: 0x0800_043c, kind: 'c', generated: true },
    { name: 'eeprom', start: 0x0804_e800, kind: 'c', generated: true, compiler: 'old_agbcc', cflags: ['-O1'] },
    { name: 'm4a', start: 0x0804_f000, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'm4a_ram', start: 0x0804_f318, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'm4a_2', start: 0x0804_f718, kind: 'asm', generated: true, library: 'm4a', version: '2001' },
    { name: 'data', start: 0x0805_1bd4, kind: 'data', generated: true },
  ],
  functions: new Map([
    [0x0800_0470, { name: 'AgbMain', mode: 'thumb', aliases: [] }],
    [0x0800_00fc, { name: 'IntrMain', mode: 'arm', aliases: [] }],
    [0x0804_f318, { name: 'SoundMainRAM', mode: 'thumb', size: 0x3a4, aliases: [], from: 'sig:m4a@2001' }],
  ]),
  entryPoints: new Map([[0x0804_f73e, { name: '_0804F73E', mode: 'thumb', aliases: [] }]]),
  symbols: new Map([
    [0x0300_5220, { name: 'gUnk_03005220', aliases: [] }],
    [0x0300_2920, { name: 'gEntityInfo', aliases: ['gUnk_03002920'] }],
    [0x0818_9e84, { name: 'gSpriteDataTable', size: 0x40, type: 'pointers', aliases: [] }],
  ]),
  overrides: [{ start: 0x0804_f318, size: 0x400, kind: 'code', runsAt: 0x0300_0388, from: 'evidence:trace' }],
};

test("§6.5's example validates and comes back equal", () => {
  const result = validateConfig(EXAMPLE);
  assert.ok(result.ok, result.ok ? '' : JSON.stringify(result.issues));
  assert.deepEqual(result.config, EXAMPLE);
});

test('an unknown build compiler is rejected, at the build and at a module', () => {
  const result = validateConfig({
    ...EXAMPLE,
    build: { name: 'x', compiler: 'gcc' },
    modules: [{ name: 'main', start: 0x0800_043c, kind: 'c', generated: true, compiler: 'clang' }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path);
  assert.ok(paths.includes('build.compiler'), paths.join(', '));
  assert.ok(paths.includes('modules[0].compiler'), paths.join(', '));
  assert.ok(result.issues.every((i) => /registered build compiler/.test(i.message)));
});

test('an unknown compiler carries its code from the refinement, not from the message; a compiler of the wrong type does not', () => {
  const unknown = validateConfig({ ...EXAMPLE, build: { name: 'x', compiler: 'gcc' } });
  assert.ok(!unknown.ok);
  if (unknown.ok) return;
  assert.deepEqual(
    unknown.issues.map((i) => [i.path, i.code]),
    [['build.compiler', 'E_UNKNOWN_COMPILER']],
  );
  const wrongType = validateConfig({ ...EXAMPLE, build: { name: 'x', compiler: 7 } });
  assert.ok(!wrongType.ok);
  if (wrongType.ok) return;
  assert.deepEqual(
    wrongType.issues.map((i) => [i.path, i.code]),
    [['build.compiler', undefined]],
  );
});

test('shapes the schema refuses, all reported at once', () => {
  const result = validateConfig({
    ...EXAMPLE,
    schema: 2,
    rom: { path: 'baserom.gba', sha1: 'NOT-A-SHA' },
    modules: [
      { name: 'bad/name', start: 0x0800_0000, kind: 'asm', generated: true },
      { name: 'main', start: 0x0800_043c, kind: 'c', generated: true, dataEnd: 0x0800_8000 },
    ],
    functions: new Map([[0x0800_0470, { name: '1bad', mode: 'thumb', aliases: [] }]]),
    overrides: [{ start: 0x0800_0000, size: 0, kind: 'code' }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path).sort();
  for (const expected of ['schema', 'rom.sha1', 'modules[0].name', 'modules[1]', 'overrides[0].size'])
    assert.ok(paths.includes(expected), `${expected} in ${paths.join(', ')}`);
  assert.ok(
    paths.some((p) => p.startsWith('functions')),
    paths.join(', '),
  );
});

test('not an object at all is an issue, never a throw', () => {
  for (const value of [null, 1, 'x', [], {}]) assert.equal(validateConfig(value).ok, false);
});

test('a name GNU as reads as a mapping symbol, a section or a local label is refused; register and macro names pass (correctness-5)', () => {
  const named = (name: string): boolean =>
    validateConfig({ ...EXAMPLE, functions: new Map([[0x0800_0470, { name, mode: 'thumb', aliases: [] }]]) }).ok;
  for (const bad of ['$d', '$t', '$a', '.text', '.data', '.Lfoo', '1bad', 'a-b', ''])
    assert.equal(named(bad), false, bad);
  for (const good of ['r0', 'pc', 'sp', 'lr', 'ip', 'fp', 'a1', 'mov', 'thumb_func_start', '_08000100', 'a$d', 'a.b'])
    assert.equal(named(good), true, good);
  const symbol = validateConfig({ ...EXAMPLE, symbols: new Map([[0x0300_0000, { name: 'gOk', aliases: ['$d'] }]]) });
  assert.equal(symbol.ok, false);
});

test('a symbol or module name longer than 200 characters is refused, so no file name passes the checks and fails the write (correctness-r1-2)', () => {
  const named = (name: string): boolean =>
    validateConfig({ ...EXAMPLE, functions: new Map([[0x0800_0470, { name, mode: 'thumb', aliases: [] }]]) }).ok;
  assert.equal(named(`F${'x'.repeat(199)}`), true);
  assert.equal(named(`F${'x'.repeat(200)}`), false);
  const modules = EXAMPLE.modules.map((m, i) => (i === 0 ? { ...m, name: `m${'x'.repeat(200)}` } : m));
  assert.equal(validateConfig({ ...EXAMPLE, modules }).ok, false);
});
