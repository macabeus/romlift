// bench/baseline/accepted-diffs.json: only improvements may be listed, each once, with a commit and a
// reason; the committed file holds improvements only, each naming its commit.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ACCEPTED_DIFFS_SCHEMA,
  IMPROVEMENT_KINDS,
  acceptedFor,
  isImprovement,
  parseAcceptedDiffs,
  readAcceptedDiffs,
} from '../../../bench/src/accepted-diffs.ts';
import { REPO_ROOT } from '../../../bench/src/context.ts';
import { withTempDir } from './fixtures.ts';

const ENTRY = {
  rom: 'sa2',
  kind: 'miss-removed',
  addr: '0x08000100',
  commit: 'abc1234',
  reason: 'the gap rule takes it',
};

test('the improvement kinds are exactly the three of architecture §4.5', () => {
  assert.deepEqual(IMPROVEMENT_KINDS, ['miss-removed', 'false-entry-removed', 'extent-agrees']);
  assert.ok(isImprovement('extent-agrees'));
  assert.ok(!isImprovement('miss-added'));
});

test('a well-formed file parses; acceptedFor keeps one ROM, by kind then address', () => {
  const parsed = parseAcceptedDiffs(
    {
      schema: ACCEPTED_DIFFS_SCHEMA,
      improvements: [
        ENTRY,
        { ...ENTRY, kind: 'extent-agrees', addr: '0x08000050' },
        { ...ENTRY, rom: 'sa3' },
        { ...ENTRY, addr: '0x08000040' },
      ],
    },
    'x',
  );
  assert.equal(parsed.improvements.length, 4);
  assert.deepEqual(
    acceptedFor(parsed, 'sa2').map((d) => `${d.kind} ${d.addr}`),
    ['extent-agrees 0x08000050', 'miss-removed 0x08000040', 'miss-removed 0x08000100'],
  );
});

test('a non-improvement, a duplicate, a bad address or a missing reason is refused', () => {
  const parse = (improvements: unknown[]): unknown =>
    parseAcceptedDiffs({ schema: ACCEPTED_DIFFS_SCHEMA, improvements }, 'a.json');
  assert.throws(
    () => parse([{ ...ENTRY, kind: 'miss-added' }]),
    /a\.json: improvements\[0\]: 'miss-added' is not an improvement .*a regression is fixed in the rules, never accepted/,
  );
  assert.throws(() => parse([{ ...ENTRY, kind: 'extent-changed' }]), /not an improvement/);
  assert.throws(() => parse([ENTRY, ENTRY]), /improvements\[1\]: sa2 miss-removed 0x08000100 is listed twice/);
  assert.throws(
    () => parse([{ ...ENTRY, addr: '0x8000100' }]),
    /addr: 0x8000100 is not 0x plus eight upper-case hex digits/,
  );
  assert.throws(() => parse([{ ...ENTRY, reason: ' ' }]), /improvements\[0\]\.reason must be a non-empty string/);
  assert.throws(
    () => parseAcceptedDiffs({ schema: 'other', improvements: [] }, 'a.json'),
    /expected \{"schema": "romlift-bench\/accepted-diffs@1"/,
  );
});

test('the committed file holds improvements only, each with its commit; an absent file accepts nothing', async () => {
  const committed = parseAcceptedDiffs(
    JSON.parse(readFileSync(new URL('../../../bench/baseline/accepted-diffs.json', import.meta.url), 'utf8')),
    'committed',
  );
  assert.equal(committed.schema, ACCEPTED_DIFFS_SCHEMA);
  assert.ok(committed.improvements.every((d) => isImprovement(d.kind) && /^[0-9a-f]{7,40}$/.test(d.commit)));
  assert.deepEqual(
    await readAcceptedDiffs({ repoRoot: REPO_ROOT, benchRoot: REPO_ROOT, pocRoot: REPO_ROOT }),
    committed,
  );
  await withTempDir('romlift-accepted-', async (root) => {
    assert.deepEqual(await readAcceptedDiffs({ repoRoot: root, benchRoot: root, pocRoot: root }), {
      schema: ACCEPTED_DIFFS_SCHEMA,
      improvements: [],
    });
  });
});
