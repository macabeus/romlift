// Scaffold goldens (architecture §6.3, roadmap 4.B "Gated by: golden scaffold, including each of setup.sh's five
// duties"): the package's templates read by readTemplates and rendered by renderScaffold for one fixed ScaffoldVars.
// test/golden/scaffold/scaffold.txt holds every file, each led by `==> <path> (scaffold, scaffold[, executable]) <==`;
// test/golden/scaffold/setup/<n>-<duty>.sh holds each of setup.sh's five duty functions, from `<duty>() {` to its
// closing `}` with the comment above it. UPDATE_GOLDEN=1 rewrites them; the diff is the review.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderScaffold } from '../../../src/core/scaffold/render.ts';
import type { ScaffoldFileEntry } from '../../../src/core/scaffold/render.ts';
import { scaffoldVars } from '../../../src/core/scaffold/vars.ts';
import { readAgbccPin, readTemplates } from '../../../src/shell/project/templates.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

/** setup.sh's duties in the order of architecture §6.3 (1 to 5), as its functions are named. */
const DUTIES = ['check_toolchain', 'setup_agbcc', 'copy_baserom', 'install_romlift', 'generate_tree'] as const;

function check(relative: string, actual: string): void {
  const file = join(DIR, relative);
  if (UPDATE) {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, actual);
  }
  assert.equal(actual, readFileSync(file, 'utf8'), `${relative} differs; UPDATE_GOLDEN=1 rewrites it`);
}

/** The function `name` of a shell script: its leading comment lines, `name() {` and everything to its `}` line. */
function shellFunction(script: string, name: string): string {
  const lines = script.split('\n');
  const start = lines.indexOf(`${name}() {`);
  assert.ok(start >= 0, `setup.sh defines no ${name}()`);
  const end = lines.indexOf('}', start);
  assert.ok(end > start, `${name}() is not closed by a '}' line`);
  let first = start;
  while (first > 0 && (lines[first - 1] ?? '').startsWith('#')) first--;
  return `${lines.slice(first, end + 1).join('\n')}\n`;
}

async function rendered(): Promise<readonly ScaffoldFileEntry[]> {
  const templates = await readTemplates(PACKAGE_ROOT);
  if (!templates.ok) throw new Error(templates.diagnostic.message);
  const pin = await readAgbccPin(PACKAGE_ROOT);
  if (!pin.ok) throw new Error(pin.diagnostic.message);
  const vars = scaffoldVars({
    name: 'klonoa-eod',
    sha1: 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b',
    romliftVersion: '0.4.0',
    agbcc: pin.value,
    title: 'KLONOA',
  });
  return renderScaffold(vars, templates.value);
}

test('golden scaffold: every file for a fixed ScaffoldVars', async () => {
  const entries = await rendered();
  const text = entries
    .map((e) => `==> ${e.path} (${e.ownership}, ${e.writer}${e.executable ? ', executable' : ''}) <==\n${e.text}`)
    .join('');
  check('scaffold.txt', text);
});

test("golden scaffold: each of setup.sh's five duties", async () => {
  const setup = (await rendered()).find((e) => e.path === 'setup.sh');
  assert.ok(setup !== undefined, 'the scaffold has setup.sh');
  DUTIES.forEach((duty, i) => {
    check(join('setup', `${i + 1}-${duty}.sh`), shellFunction(setup.text, duty));
  });
});
