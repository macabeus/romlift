// The GNU map of the signature fixtures in bench/tools/fixtures.ts (roadmap 6.A, D28): a build.mk asks for it with
// `MAP := yes`, common/rules.mk passes ld `-Map` only then, the committed map spells the temporary build directory
// `build/`, and `check` compares the input placements (not ld's layout of the text), so a moved or resized object fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { committedMapText, compareFixture, mapDifferences, mapRows, wantsMap } from '../../../bench/tools/fixtures.ts';
import { listSyntheticFixtures, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';

const MAP = (dir: string, size: string): string =>
  [
    'Linker script and memory map',
    '',
    '.text           0x08000000       0x20',
    ` .text          0x08000000        0x8 ${dir}/crt0.o`,
    ` .text          0x08000008       ${size} ${dir}/fix_math.o`,
    '                0x08000008                FixMulShift',
    '',
    `LOAD ${dir}/crt0.o`,
    '',
  ].join('\n');

test('MAP := yes asks for the map; rules.mk passes -Map only then', () => {
  assert.ok(wantsMap('NAME := library\nMAP := yes\ninclude ../common/rules.mk\n'));
  assert.ok(!wantsMap('NAME := far-jump\ninclude ../common/rules.mk\n'));
  assert.ok(!wantsMap('MAP := no\n'));
  const rules = readFileSync(join(SYNTHETIC_ROOT, 'common', 'rules.mk'), 'utf8');
  assert.match(rules, /^LDMAP := \$\(if \$\(filter yes,\$\(MAP\)\),-Map \$\(BUILD\)\/\$\(NAME\)\.map\)$/m);
  assert.match(rules, /^\t\$\(ARM_LD\) -T \$\(COMMON\)\/rom\.ld \$\(LDMAP\) -o \$@ \$\(OBJS\)$/m);
  const withMap = listSyntheticFixtures().filter((f) => wantsMap(readFileSync(f.buildMk, 'utf8'))).map((f) => f.name);
  assert.deepEqual(withMap, ['library', 'library-game', 'library-ref2']);
});

test('the committed map spells the temporary build directory build/, and its rows are the input placements', () => {
  const text = committedMapText(MAP('/tmp/romlift-fixture-x', '0x18'), '/tmp/romlift-fixture-x');
  assert.equal(text, MAP('build', '0x18'));
  assert.deepEqual(mapRows(text), ['.text .text 0x08000000 0x00000008 build/crt0.o', '.text .text 0x08000008 0x00000018 build/fix_math.o']);
});

test('check fails on a placement that moved or changed size, and passes on equal rows', () => {
  const committed = mapRows(MAP('build', '0x18'));
  assert.deepEqual(mapDifferences(committed, committed), []);
  assert.equal(mapDifferences(committed, mapRows(MAP('build', '0x14'))).length, 2);
  const record = { agbccCommit: 'a'.repeat(40), asVersion: 'GNU assembler x' };
  const build = { gba: new Uint8Array([1]), symbols: [] };
  const verdict = compareFixture('library', { ...build, map: committed }, record, { ...build, map: mapRows(MAP('build', '0x14')) }, { agbccCommit: record.agbccCommit, asVersion: record.asVersion });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.every((p) => p.startsWith('map placement only in')));
  assert.ok(compareFixture('far-jump', build, record, build, { agbccCommit: record.agbccCommit, asVersion: record.asVersion }).ok, 'no map on either side: nothing compared');
});

test("every committed map is the fixture's own build: its rows parse and name the build/ objects of its SRCS", () => {
  for (const name of ['library', 'library-ref2', 'library-game']) {
    const rows = mapRows(readFileSync(join(SYNTHETIC_ROOT, name, 'build', `${name}.map`), 'utf8'));
    const srcs = (/^SRCS := (.*)$/m.exec(readFileSync(join(SYNTHETIC_ROOT, name, 'build.mk'), 'utf8'))?.[1] ?? '').split(/\s+/).filter((s) => s !== '');
    for (const source of srcs) assert.ok(rows.some((r) => r.endsWith(` build/${source.replace(/\.s$/, '.o')}`)), `${name}: ${source}`);
    assert.ok(!rows.some((r) => r.includes('/tmp') || r.includes('/var/')), `${name}: a temporary path`);
  }
});
