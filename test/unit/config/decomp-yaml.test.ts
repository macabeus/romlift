// decomp.yaml (architecture §6.5): renderDecompYaml's text meets the decomp_settings spec and reads back through
// readDecompYaml (tools.romlift names romlift.toml; the first version names the ROM, the SHA-1 and the build name);
// the region comes from the game code; the asmlift compiler line uses the build compiler's flags; and
// readDecompYaml refuses, with E_DECOMP_YAML_INVALID, a file that fails the spec, lacks the block, has an unknown
// key in it or points the config outside the project.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDecompYaml } from '@match-kit/decomp-yaml';

import { BUILD_COMPILERS } from '../../../src/core/config/compilers.ts';
import { readDecompYaml, regionOf, renderDecompYaml, ROMLIFT_CONFIG_FILE } from '../../../src/core/config/decomp-yaml.ts';
import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';

const VARS = { name: 'akle', title: 'KLONOA', gameCode: 'AKLE', sha1: '1e10000000000000000000000000000000000000' } as const;

function invalid(text: string): string[] {
  const read = readDecompYaml(text);
  assert.equal(read.ok, false);
  return read.ok ? [] : read.diagnostics.map((d) => `${d.code} ${d.message}`);
}

test('the rendered decomp.yaml meets the spec and reads back', () => {
  const text = renderDecompYaml(VARS);
  const spec = parseDecompYaml(text);
  assert.equal(spec.name, 'KLONOA');
  assert.equal(spec.platform, 'gba');
  assert.deepEqual(spec.versions[0]?.paths, {
    target: 'baserom.gba',
    build_dir: 'build',
    map: 'akle.map',
    compiled_target: 'akle.gba',
    elf: 'akle.elf',
    asm: 'asm',
    nonmatchings: 'asm/nonmatchings',
  });
  assert.deepEqual(spec.tools?.['romlift'], { config: ROMLIFT_CONFIG_FILE });
  const read = readDecompYaml(text);
  assert.deepEqual(read, { ok: true, value: { config: 'romlift.toml', version: 'us', target: 'baserom.gba', sha1: VARS.sha1, buildName: 'akle' } });
  assert.equal(typeof spec.versions[0]?.sha1, 'string', 'a SHA-1 that looks like a number stays a string');
});

test('the asmlift block compiles with the build compiler and its default flags', () => {
  const text = renderDecompYaml({ ...VARS, compiler: 'old_agbcc' });
  const compiler = parseDecompYaml(text).tools?.['asmlift'];
  assert.ok(typeof compiler === 'object' && compiler !== null);
  const script = (compiler as Readonly<Record<string, unknown>>)['compiler'];
  assert.equal(
    script,
    `set -e\ncc -E -x c -nostdinc -undef -I include {{inputPath}} -o {{outputPath}}.i\n./tools/agbcc/bin/old_agbcc {{outputPath}}.i -o {{outputPath}}.s ${BUILD_COMPILERS['old_agbcc']?.flags.join(' ') ?? ''}\narm-none-eabi-as -mcpu=arm7tdmi {{outputPath}}.s -o {{outputPath}}\n`,
  );
  assert.throws(() => renderDecompYaml({ ...VARS, compiler: 'gcc' }), RomliftInvariantError);
});

test('the region and the names follow the header; odd values are quoted', () => {
  assert.deepEqual(regionOf('BPEE'), { name: 'us', fullname: 'USA' });
  assert.deepEqual(regionOf('BPEJ'), { name: 'jp', fullname: 'Japan' });
  assert.deepEqual(regionOf('AXVP'), { name: 'eu', fullname: 'Europe' });
  assert.deepEqual(regionOf('RLFQ'), { name: 'rlfq', fullname: 'RLFQ' });
  assert.deepEqual(regionOf(''), { name: 'rom', fullname: 'ROM' });
  const text = renderDecompYaml({ name: 'my game', title: '', gameCode: '', sha1: 'a'.repeat(40) });
  const spec = parseDecompYaml(text);
  assert.equal(spec.name, 'my game');
  assert.equal(spec.versions[0]?.fullname, 'ROM (no game code)');
  const odd = parseDecompYaml(renderDecompYaml({ ...VARS, title: 'A: "B" #c\u0001' }));
  assert.equal(odd.name, 'A: "B" #c\u0001');
});

test('readDecompYaml refuses what the spec or the block refuses, with E_DECOMP_YAML_INVALID', () => {
  const text = renderDecompYaml(VARS);
  assert.deepEqual(invalid(text.replace('    config: "romlift.toml"\n', '    config: "romlift.toml"\n    version: "us"\n')), [
    'E_DECOMP_YAML_INVALID decomp.yaml: tools.romlift: Unrecognized key: "version"',
  ]);
  assert.deepEqual(invalid(text.replace('  romlift:\n    config: "romlift.toml"\n', '')), [
    'E_DECOMP_YAML_INVALID decomp.yaml: has no tools.romlift block (add one with `config: romlift.toml`)',
  ]);
  assert.deepEqual(invalid(text.replace('config: "romlift.toml"', 'config: "../other/romlift.toml"')), [
    'E_DECOMP_YAML_INVALID decomp.yaml: tools.romlift.config: "../other/romlift.toml" is not a path inside the project',
  ]);
  assert.deepEqual(invalid(text.replace('config: "romlift.toml"', 'config: ""')), ['E_DECOMP_YAML_INVALID decomp.yaml: tools.romlift.config: Too small: expected string to have >=1 characters']);
  assert.deepEqual(invalid('name: x\n'), [
    'E_DECOMP_YAML_INVALID decomp.yaml: platform: Invalid input: expected string, received undefined',
    'E_DECOMP_YAML_INVALID decomp.yaml: versions: Invalid input: expected array, received undefined',
  ]);
  const yaml = invalid('name: [unclosed\n');
  assert.equal(yaml.length, 1);
  assert.match(yaml[0] ?? '', /^E_DECOMP_YAML_INVALID decomp\.yaml: is not valid YAML: /);
  const read = readDecompYaml('name: x\n', 'sub/decomp.yml');
  assert.equal(read.ok ? undefined : read.diagnostics[0]?.path, 'sub/decomp.yml');
});

test('a hand-written decomp.yaml with another config path and no sha1 reads', () => {
  const text = 'name: game\nplatform: gba\nversions:\n  - name: us\n    fullname: USA\n    paths:\n      target: roms/base.gba\n      build_dir: out\n      map: out/game.map\n      compiled_target: out/game.gba\ntools:\n  romlift:\n    config: config/project.toml\n';
  assert.deepEqual(readDecompYaml(text), { ok: true, value: { config: 'config/project.toml', version: 'us', target: 'roms/base.gba', buildName: 'game' } });
});
