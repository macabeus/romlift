// Repository invariants that hold from the first commit and need no ROM: the Node floor and the
// TypeScript settings the architecture requires (§2, D2), and the rule that nothing derived from a
// ROM is ever tracked (docs/benchmark-roms.md).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'));
}

test('package.json declares the Node floor, ESM and the romlift bin', () => {
  const pkg = readJson('package.json') as {
    name: string;
    type: string;
    engines: { node: string };
    bin: Record<string, string>;
  };
  assert.equal(pkg.name, 'romlift');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=22.18');
  assert.ok(pkg.bin['romlift']);
});

test('tsconfig.json enables every compiler option the architecture requires', () => {
  const { compilerOptions } = readJson('tsconfig.json') as { compilerOptions: Record<string, unknown> };
  const required = [
    'strict',
    'erasableSyntaxOnly',
    'verbatimModuleSyntax',
    'rewriteRelativeImportExtensions',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noEmit',
  ];
  for (const option of required) {
    assert.equal(compilerOptions[option], true, option);
  }
});

test('no ROM, ELF, map or object file is tracked outside the self-authored fixtures', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  }).split('\0');
  const selfAuthored = /^(bench\/dataset\/synthetic\/[^/]+\/build\/|test\/fixtures\/)/;
  const offending = tracked.filter((path) => /\.(gba|elf|map|o|sav)$/i.test(path) && !selfAuthored.test(path));
  assert.deepEqual(offending, []);
});
