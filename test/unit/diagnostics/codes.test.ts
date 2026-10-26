// The repository-wide codes check of architecture §9.1 (D45): every code a codes.ts defines is raised
// in its module's directory, every raised code is defined, and core/diagnostic-codes.ts unions every
// core codes module (plus foundation/rom's).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALL_CODES } from '../../../src/core/diagnostic-codes.ts';
import { AnalysisCodes } from '../../../src/core/analysis/codes.ts';
import { RomCodes } from '../../../src/foundation/rom/codes.ts';
import { ShellCodes } from '../../../src/shell/codes.ts';

const src = fileURLToPath(new URL('../../../src/', import.meta.url));
const UNION = 'core/diagnostic-codes.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) out.push(relative(src, path).split(sep).join('/'));
  }
  return out;
}

const files = sourceFiles(src);
const text = new Map(files.map((f) => [f, readFileSync(join(src, f), 'utf8')]));
const codesFiles = files.filter((f) => f === 'codes.ts' || f.endsWith('/codes.ts'));

/** The codes a codes.ts declares inside its defineCodes({...}) call. */
function definedIn(source: string): string[] {
  const start = source.indexOf('defineCodes(');
  if (start < 0) return [];
  return [...source.slice(start).matchAll(/^\s+([EW]_[A-Z0-9_]+)\s*:/gm)].map((m) => m[1] ?? '');
}

/** The codes a source file raises: quoted literals and <X>Codes.<CODE> member uses. */
function raisedIn(source: string): string[] {
  const literal = [...source.matchAll(/['"`]([EW]_[A-Z0-9_]+)['"`]/g)].map((m) => m[1] ?? '');
  const member = [...source.matchAll(/\b[A-Z][A-Za-z]*Codes\.([EW]_[A-Z0-9_]+)\b/g)].map((m) => m[1] ?? '');
  return [...literal, ...member];
}

const defined = new Map<string, string>(); // code -> codes.ts
for (const file of codesFiles) {
  for (const code of definedIn(text.get(file) ?? '')) {
    assert.ok(!defined.has(code), `${code} is defined twice`);
    defined.set(code, file);
  }
}

test('the scan finds the codes modules of this phase', () => {
  assert.ok(codesFiles.includes('foundation/rom/codes.ts'));
  assert.ok(codesFiles.includes('shell/codes.ts'));
  assert.ok(codesFiles.includes('core/analysis/codes.ts'));
  for (const code of Object.keys(AnalysisCodes)) assert.equal(defined.get(code), 'core/analysis/codes.ts');
  for (const code of Object.keys(RomCodes)) assert.equal(defined.get(code), 'foundation/rom/codes.ts');
  for (const code of Object.keys(ShellCodes)) assert.equal(defined.get(code), 'shell/codes.ts');
});

test('every defined code is raised in its module directory', () => {
  const unused: string[] = [];
  for (const [code, file] of defined) {
    const dir = dirname(file);
    const prefix = dir === '.' ? '' : `${dir}/`;
    const raised = files.some((f) => f.startsWith(prefix) && !codesFiles.includes(f) && raisedIn(text.get(f) ?? '').includes(code));
    if (!raised) unused.push(`${code} (${file})`);
  }
  assert.deepEqual(unused, []);
});

test('every raised code is defined in a codes.ts', () => {
  const undefinedCodes: string[] = [];
  for (const file of files) {
    if (codesFiles.includes(file) || file === UNION) continue;
    for (const code of raisedIn(text.get(file) ?? '')) {
      if (!defined.has(code)) undefinedCodes.push(`${code} in ${file}`);
    }
  }
  assert.deepEqual(undefinedCodes, []);
});

test('core/diagnostic-codes.ts unions every core codes module and foundation/rom', () => {
  const union = text.get(UNION) ?? '';
  const expected = codesFiles.filter((f) => f.startsWith('core/') || f === 'foundation/rom/codes.ts');
  for (const file of expected) {
    const specifier = file.startsWith('core/') ? `./${file.slice('core/'.length)}` : `../${file}`;
    assert.ok(union.includes(`from '${specifier}'`), `${UNION} does not import ${file}`);
  }
  assert.ok(!union.includes('shell/'), `${UNION} must not import the shell's codes`);
  const unionCodes = new Set(Object.keys(ALL_CODES));
  for (const [code, file] of defined) {
    assert.equal(unionCodes.has(code), expected.includes(file), `${code} (${file}) in ALL_CODES`);
  }
});

test('architecture §9.1 lists exactly the codes the codes.ts files define (final-review architecture-2)', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../../docs/architecture.md', import.meta.url)), 'utf8');
  const start = doc.indexOf('### 9.1 ');
  const end = doc.indexOf('### 9.2 ', start);
  assert.ok(start >= 0 && end > start, 'architecture.md has §9.1 and §9.2');
  const rows = doc.slice(start, end).split('\n').filter((line) => line.startsWith('| `'));
  const listed = rows.flatMap((line) => [...(line.split(' | ')[0] ?? '').matchAll(/`([EW]_[A-Z0-9_]+)`/g)].map((m) => m[1] ?? ''));
  const sorted = (codes: Iterable<string>): string[] => [...codes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(sorted(new Set(listed)), sorted(defined.keys()));
  assert.equal(listed.length, new Set(listed).size, 'no code is listed twice');
});
