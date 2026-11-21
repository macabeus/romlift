// The shape every rule file of a family keeps (architecture §4.1, D7), checked by the walk, bl and claim
// family tests (not a test file): the family record holds exactly the profile slot's ids, each under its
// meta.id, with complete metadata; each id has its own file named after it, of 20 to 80 lines, that
// default-exports the registered rule; the family directory holds nothing else but index.ts.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { RegisteredRule } from '../../../../../src/core/analysis/types.ts';
import type { RuleId } from '../../../../../src/core/provenance/rule-id.ts';

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const RULES_DIR = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'src', 'core', 'analysis', 'rules');

export async function checkFamily(
  family: string,
  rules: Readonly<Record<string, RegisteredRule>>,
  slot: readonly RuleId[],
): Promise<void> {
  const ids = Object.keys(rules).sort(byCodeUnit);
  assert.deepEqual(ids, [...slot].sort(byCodeUnit), `${family}: the record holds exactly the slot's ids`);
  const dir = path.join(RULES_DIR, family);
  const files = (await readdir(dir)).filter((f) => f !== 'index.ts').sort(byCodeUnit);
  assert.deepEqual(
    files,
    ids.map((id) => `${id.slice(family.length + 1)}.ts`).sort(byCodeUnit),
    `${family}: one file per rule`,
  );
  for (const id of ids) {
    const rule = rules[id];
    assert.ok(rule !== undefined);
    const m = rule.meta;
    assert.equal(m.id, id);
    for (const text of [m.summary, m.restsOn, m.recovers]) assert.ok(text.trim().length > 0, `${id}: empty metadata`);
    assert.ok(m.reads.length > 0 && m.adds.length > 0, `${id}: reads and adds`);
    assert.equal(m.origin, undefined, `${id}: only seed and gap rules carry an origin`);
    const file = path.join(dir, `${id.slice(family.length + 1)}.ts`);
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n').length;
    assert.ok(lines >= 20 && lines <= 80, `${id}: ${lines} lines, not 20 to 80`);
    const mod = (await import(file)) as { readonly default: RegisteredRule };
    assert.equal(mod.default, rule, `${id}: the default export is the registered rule`);
  }
}
