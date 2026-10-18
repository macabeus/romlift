// Writer goldens (architecture §5, §6.3, §13 g3.golden-writers; roadmap 3.B, 3.C): for every committed fixture
// and each of the eight phase-3 writers, the files that writer yields on the fixture's discover-mode model
// (the seedless discover run under profileById('agbcc'), configFromDiscover, buildModel), with the readable
// printer and an empty DecompState, one test/golden/writers/<writer>/<fixture>.txt each. A module-scoped
// writer runs per generated module in ROM order, a global one once, each module's files sorted by path: the
// stream order of core/emit/tree.ts restricted to one writer. Not gated: the whole tree of the raw printer,
// test/golden/writers/raw-printer/<fixture>.txt, so a change to the bisection baseline shows up as a diff too.
//
// A golden file holds, per file the writer yields, a header line `==> <path> (<ownership>, <writer>) <==` and
// the file's text; a writer that yields nothing on a fixture holds the line `(no files)`. UPDATE_GOLDEN=1
// rewrites the goldens and removes a file no fixture produces; the diff is the review.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { emitTree, emitWith } from '../../../src/core/emit/emit-tree.ts';
import type { EmitContext, FileEntry, Writer, WriterId } from '../../../src/core/emit/tree.ts';
import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const FIXTURES = listSyntheticFixtures();
/** The writers g3.golden-writers requires a golden of, in the order of the writers table of §6.3. */
const GATED: readonly WriterId[] = ['header', 'crt0', 'function', 'orphan', 'module', 'data', 'ldscript', 'symbols'];
const RAW_SET = 'raw-printer';

const READABLE: EmitContext = { decomp: { defined: new Set<string>() } };
const RAW: EmitContext = { decomp: { defined: new Set<string>() }, printer: 'raw' };

/** The golden text of a list of entries. */
function goldenText(entries: Iterable<FileEntry>): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.ownership === 'reconciled') throw new Error(`${e.path}: a reconciled entry in a phase-3 stream`);
    parts.push(`==> ${e.path} (${e.ownership}, ${e.writer}) <==\n${e.text}`);
  }
  return parts.length === 0 ? '(no files)\n' : parts.join('');
}

function writerOf(id: WriterId): Writer {
  const writer = WRITERS.find((w) => w.id === id);
  if (writer === undefined) throw new Error(`no registered writer ${id}`);
  return writer;
}

/** The discover-mode model of one fixture. */
function modelOf(rom: Rom): Model {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  const analysis = discover(rom, { profile });
  return buildModel(rom, analysis, configFromDiscover(rom, analysis));
}

function check(set: string, fixture: string, actual: string): void {
  const dir = join(DIR, set);
  const file = join(dir, `${fixture}.txt`);
  if (UPDATE) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, actual);
  }
  assert.equal(actual, readFileSync(file, 'utf8'), `${set}/${fixture}.txt differs; UPDATE_GOLDEN=1 rewrites it`);
}

test('every committed fixture has writer goldens, and every gated writer is registered', () => {
  assert.ok(FIXTURES.length >= 47, `${FIXTURES.length} fixtures`);
  assert.deepEqual(
    WRITERS.map((w) => w.id),
    GATED,
  );
});

for (const fixture of FIXTURES) {
  test(`writer goldens ${fixture.name}`, () => {
    const rom = readFixtureRom(fixture);
    const model = modelOf(rom);
    for (const id of GATED) check(id, fixture.name, goldenText(emitWith(rom, model, READABLE, [writerOf(id)])));
    check(RAW_SET, fixture.name, goldenText(emitTree(rom, model, RAW)));
  });
}

test('every writer golden belongs to a fixture', () => {
  const names = new Set(FIXTURES.map((f) => `${f.name}.txt`));
  const stale: string[] = [];
  for (const set of [...GATED, RAW_SET]) {
    let files: string[];
    try {
      files = readdirSync(join(DIR, set));
    } catch {
      continue;
    }
    for (const file of files) {
      if (names.has(file)) continue;
      if (UPDATE) rmSync(join(DIR, set, file));
      else stale.push(`${set}/${file}`);
    }
  }
  assert.deepEqual(stale, []);
});
