// Every gate file under test/gates matches architecture §13: its file name is its id, and its phase, tier
// and historicalAfter are the ones the gate index gives. A phase with any gate file has all of its gates.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const gatesDir = path.join(repoRoot, 'test', 'gates');

interface IndexRow {
  readonly id: string;
  readonly phase: number;
  readonly tier: 'ci' | 'real' | 'both';
  readonly historicalAfter?: number;
}

/** The rows of the "Gate index" table of docs/architecture.md §13. */
function gateIndex(): readonly IndexRow[] {
  const doc = readFileSync(path.join(repoRoot, 'docs', 'architecture.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## 13. Gate index'));
  const rows: IndexRow[] = [];
  for (const match of section.matchAll(/^\| `(g(\d)\.[a-z0-9-]+)` \| ([^|]+) \|/gm)) {
    const [, id = '', phase = '', tierText = ''] = match;
    const tier = tierText.startsWith('ci and real') ? 'both' : tierText.startsWith('real') ? 'real' : 'ci';
    const historical = /historical after phase (\d)/.exec(tierText)?.[1];
    rows.push(
      historical === undefined
        ? { id, phase: Number(phase), tier }
        : { id, phase: Number(phase), tier, historicalAfter: Number(historical) },
    );
  }
  return rows;
}

/** id, phase, tier and historicalAfter as written in a gate file's gate({...}) call. */
function declared(file: string): Partial<IndexRow> {
  const text = file.slice(Math.max(0, file.search(/^gate\(\{$/m)));
  const id = /^\s*id: '([^']+)',$/m.exec(text)?.[1];
  const phase = /^\s*phase: (\d),$/m.exec(text)?.[1];
  const tier = /^\s*tier: '(ci|real|both)',$/m.exec(text)?.[1] as IndexRow['tier'] | undefined;
  const historical = /^\s*historicalAfter: (\d),$/m.exec(text)?.[1];
  return {
    ...(id === undefined ? {} : { id }),
    ...(phase === undefined ? {} : { phase: Number(phase) }),
    ...(tier === undefined ? {} : { tier }),
    ...(historical === undefined ? {} : { historicalAfter: Number(historical) }),
  };
}

test('the gate index of architecture §13 parses', () => {
  const index = gateIndex();
  assert.ok(index.length >= 60, `only ${index.length} gates parsed from §13`);
  assert.equal(new Set(index.map((row) => row.id)).size, index.length, 'gate ids are unique');
});

test('every gate file is named by its id and declares the phase, tier and historicalAfter of §13', () => {
  const index = new Map(gateIndex().map((row) => [row.id, row]));
  const files = readdirSync(gatesDir).filter((name) => /^g\d\..+\.test\.ts$/.test(name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const id = file.slice(0, -'.test.ts'.length);
    const row = index.get(id);
    assert.ok(row, `${file}: ${id} is not in the §13 gate index`);
    const text = readFileSync(path.join(gatesDir, file), 'utf8');
    assert.equal((text.match(/^gate\(\{$/gm) ?? []).length, 1, `${file}: exactly one gate() call`);
    assert.deepEqual(declared(text), row, `${file}: declaration differs from §13`);
  }
});

test('a phase with any gate file has a file for every one of its gates', () => {
  const present = new Set(readdirSync(gatesDir).map((name) => name.replace(/\.test\.ts$/, '')));
  const index = gateIndex();
  for (const phase of new Set(index.map((row) => row.phase))) {
    const ids = index.filter((row) => row.phase === phase).map((row) => row.id);
    if (!ids.some((id) => present.has(id))) continue;
    assert.deepEqual(
      ids.filter((id) => !present.has(id)),
      [],
      `phase ${phase} gates without a file`,
    );
  }
});
