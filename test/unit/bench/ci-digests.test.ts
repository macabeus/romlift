// bench/tools/ci-digests.ts: one job's synthetic-tier analysis digests (every committed fixture, the
// sha256 of encodeAnalysis of its discover analysis), the reader of an uploaded file, and the comparison
// the final CI job makes across Linux, macOS and both Node versions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { analyze, encodeAnalysis, profileById, romFromBytes } from 'romlift';
import { sha1Of, sha256Stream } from 'romlift/node';

import { CI_DIGESTS_SCHEMA, collectCiDigests, compareCiDigests, fixtureDigest, parseCiDigests, type CiDigests, type JobDigests } from '../../../bench/tools/ci-digests.ts';
import { contextFromEnv } from '../../../bench/src/context.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function job(os: string, node: string, digests: Record<string, string>): JobDigests {
  return { source: `${os}-${node}.json`, report: { schema: CI_DIGESTS_SCHEMA, node, os, digests } };
}

test('one job covers every committed fixture with the digest of its encoded discover analysis', async () => {
  const report = await collectCiDigests(contextFromEnv({}), { node: 'v24.0.0', os: 'test-os' });
  const fixtures = listSyntheticFixtures();
  assert.deepEqual(Object.keys(report.digests), fixtures.map((f) => f.name));
  assert.deepEqual([report.schema, report.node, report.os], [CI_DIGESTS_SCHEMA, 'v24.0.0', 'test-os']);
  const first = fixtures[0];
  assert.ok(first !== undefined);
  const bytes = new Uint8Array(readFileSync(first.rom));
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  const expected = sha256Stream(encodeAnalysis(analyze(romFromBytes(bytes, sha1Of(bytes)), profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' })));
  assert.equal(report.digests[first.name], expected);
  assert.equal(fixtureDigest(bytes), expected);
  assert.deepEqual(parseCiDigests(JSON.parse(JSON.stringify(report)) as unknown, 'job.json'), report);
});

test('the reader refuses another schema, a missing field, a digest that is not a sha256 and an empty set', () => {
  const good: CiDigests = { schema: CI_DIGESTS_SCHEMA, node: 'v22.18.0', os: 'linux-x64', digests: { far: A } };
  assert.throws(() => parseCiDigests({ ...good, schema: 'other@1' }, 'f.json'), { message: /^f\.json: schema is "other@1", expected romlift-bench\/ci-digests@1$/ });
  assert.throws(() => parseCiDigests({ ...good, node: '' }, 'f.json'), /f\.json: node is not a non-empty string/);
  assert.throws(() => parseCiDigests({ ...good, digests: { far: 'abc' } }, 'f.json'), /f\.json: digests\.far is not a sha256/);
  assert.throws(() => parseCiDigests({ ...good, digests: {} }, 'f.json'), /f\.json: digests is empty/);
  assert.throws(() => parseCiDigests([], 'f.json'), /f\.json: not a JSON object/);
});

test('four agreeing jobs pass; the expected count is enforced', () => {
  const jobs = [job('linux-x64', 'v22.18.0', { far: A, leaf: B }), job('linux-x64', 'v24.10.0', { far: A, leaf: B }), job('darwin-arm64', 'v22.18.0', { far: A, leaf: B }), job('darwin-arm64', 'v24.10.0', { far: A, leaf: B })];
  assert.deepEqual(compareCiDigests(jobs, 4), []);
  assert.deepEqual(compareCiDigests(jobs.slice(0, 3), 4), ['3 digest file(s), expected 4']);
  assert.deepEqual(compareCiDigests([]), ['no digest file to compare']);
});

test('a differing digest and a fixture one job lacks are each named, with the jobs on each side', () => {
  const jobs = [job('linux-x64', 'v24.10.0', { far: A, leaf: A }), job('darwin-arm64', 'v24.10.0', { far: B })];
  assert.deepEqual(compareCiDigests(jobs), [
    `far: the analysis digests differ: ${A} on linux-x64 Node v24.10.0 (linux-x64-v24.10.0.json); ${B} on darwin-arm64 Node v24.10.0 (darwin-arm64-v24.10.0.json)`,
    'leaf: missing on darwin-arm64 Node v24.10.0 (darwin-arm64-v24.10.0.json)',
  ]);
});
