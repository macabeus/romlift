// The write plan of a tree into a directory (core/write-plan/project-plan.ts, architecture §6.4 steps 3 and 4): the
// planWrites inputs of a project (projectPlanInputs) and of an empty directory (freshTreePlanInputs), and whether a
// plan changes nothing (planChangesNothing). Moved here from the workflow and shell tests (architecture-r1-7).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { retainedPrefixes } from '../../../src/core/model/paths.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { generate, generatedEntries } from '../../../src/core/workflow/generate.ts';
import type { Journal } from '../../../src/core/write-plan/journal.ts';
import { freshTreePlanInputs, planChangesNothing, projectPlanInputs } from '../../../src/core/write-plan/project-plan.ts';
import type { ProjectWriteState } from '../../../src/core/write-plan/project-plan.ts';
import type { DiskFileState, Manifest, WritePlan } from '../../../src/core/write-plan/types.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const MANIFEST: Manifest = { schema: 1, romlift: '1.0.0', files: { 'asm/a.s': { sha1: 'sha-a', writer: 'module' } } };
const ENTRY: FileEntry = { ownership: 'generated', path: 'asm/a.s', text: 'A', writer: 'module' };

function state(over: Partial<ProjectWriteState> = {}): ProjectWriteState {
  return {
    manifest: MANIFEST,
    journal: null,
    disk: new Map<string, DiskFileState>([['asm/a.s', { kind: 'present', sha1: 'sha-a' }]]),
    reconciledTexts: new Map([['src/main.c', 'int x;\n']]),
    ...over,
  };
}

test('freshTreePlanInputs: no manifest, every path absent, no reconciled text, the non-generated modules retained', () => {
  const fixture = listSyntheticFixtures().find((f) => f.name === 'far-jump');
  assert.ok(fixture !== undefined);
  const rom = readFixtureRom(fixture);
  const result = generate({ rom, config: configFromDiscover(rom, discover(rom)), decomp: { defined: [] }, printer: 'readable' });
  const kept = { ...result.model, modules: result.model.modules.map((m, i) => (i === 1 ? { ...m, generated: false } : m)) };
  const inputs = freshTreePlanInputs(generatedEntries(rom, result), result.paths, (t) => String(t.length), retainedPrefixes(kept));
  assert.equal(inputs.manifest, null);
  assert.deepEqual([...inputs.disk.values()].every((v) => v.kind === 'absent'), true);
  assert.deepEqual([...inputs.disk.keys()], result.paths);
  assert.equal(inputs.reconciledTexts.size, 0);
  assert.ok(inputs.retained.length > 0);
  assert.equal(inputs.hash('abc'), '3');
});

test('projectPlanInputs: the state read of the directory, the hash, the version and the retained prefixes, as planWrites reads them', () => {
  const hash = (t: string): string => `h${t.length}`;
  const read = state();
  const inputs = projectPlanInputs([ENTRY], read, hash, '2.0.0', ['asm/m4a.s']);
  assert.equal(inputs.manifest, read.manifest);
  assert.equal(inputs.journal, null);
  assert.equal(inputs.disk, read.disk);
  assert.equal(inputs.reconciledTexts, read.reconciledTexts);
  assert.equal(inputs.hash, hash);
  assert.equal(inputs.romlift, '2.0.0');
  assert.deepEqual(inputs.retained, ['asm/m4a.s']);
  assert.ok(!('executables' in inputs), 'no executables read, none passed');
  const executables = new Set(['setup.sh']);
  assert.equal(projectPlanInputs([ENTRY], state({ executables }), hash, '2.0.0', []).executables, executables);
});

test('planChangesNothing: only keeps, no journal left, and the manifest already on disk', () => {
  const keep: WritePlan['ops'][number] = { op: 'keep', path: 'asm/a.s', sha1: 'sha-a' };
  const plan = { ops: [keep], manifest: MANIFEST };
  assert.equal(planChangesNothing(plan, state()), true);
  assert.equal(planChangesNothing({ ...plan, ops: [...plan.ops, { op: 'delete', path: 'asm/b.s' }] }, state()), false, 'an op that is no keep');
  const journal: Journal = { schema: 1, ops: [] };
  assert.equal(planChangesNothing(plan, state({ journal })), false, "an interrupted run's journal is left");
  assert.equal(planChangesNothing(plan, state({ manifest: null })), false, 'no manifest on disk yet');
  assert.equal(planChangesNothing({ ...plan, manifest: { ...MANIFEST, romlift: '2.0.0' } }, state()), false, 'another manifest');
});
