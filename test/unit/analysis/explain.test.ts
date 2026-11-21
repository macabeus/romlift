// explainAnalysis on a hand-built result and trail (architecture §9.2, D35): the claim at the address,
// the innermost owner with every provenance record, the events as given, and the metadata of the rules
// they name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPLAIN_BUCKET, explainAnalysis, explainBucket, explainFilter } from 'romlift/internal';

import type { AnalysisResult, FunctionFact } from '../../../src/core/analysis/types.ts';
import type { RuleId, RuleMeta } from '../../../src/core/provenance/rule-id.ts';
import type { TrailEvent } from '../../../src/core/provenance/trail.ts';

function fact(entry: number, end: number, overrides: Partial<FunctionFact> = {}): FunctionFact {
  return {
    entry,
    mode: 'thumb',
    extent: { start: entry, end },
    codeEnd: end,
    code: [{ start: entry, end }],
    dead: [],
    pools: [],
    farPools: [],
    tables: [],
    calls: [],
    blVerdicts: [],
    exits: [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: [],
    origin: 'call',
    accepted: { rule: 'seed.call', round: 1, cites: [0x0800_0100], note: 'accept.prologue-and-loaded' },
    also: [],
    ...overrides,
  };
}

const OUTER = fact(0x0800_0200, 0x0800_0400, {
  origin: 'pool-pointer',
  accepted: { rule: 'seed.pool-pointer', round: 2, cites: [] },
  also: [{ rule: 'seed.call', round: 3, cites: [0x0800_0500] }],
});
const INNER = fact(0x0800_0300, 0x0800_0320, {
  origin: 'gap-scan',
  accepted: { rule: 'gap.forward-chain', round: 4, cites: [0x0800_0300] },
});

const RESULT: AnalysisResult = {
  schema: 'romlift/analysis@1',
  mode: 'discover',
  rom: { sha1: '0'.repeat(40), end: 0x0800_1000 },
  profile: 'agbcc',
  options: { mode: 'discover', seeds: [], overrides: [], trail: 'full' },
  functions: [OUTER, INNER],
  claims: [
    { span: { start: 0x0800_0200, end: 0x0800_0300 }, kind: 1, owner: 0x0800_0200 },
    { span: { start: 0x0800_0300, end: 0x0800_0310 }, kind: 1, owner: 0x0800_0300 },
    { span: { start: 0x0800_0310, end: 0x0800_0320 }, kind: 2, owner: 0x0800_0300 },
    { span: { start: 0x0800_0320, end: 0x0800_0400 }, kind: 1, owner: 0x0800_0200 },
  ],
  startup: { span: { start: 0x0800_0000, end: 0x0800_0100 }, entries: [0x0800_0000] },
  codeEnd: 0x0800_0400,
  rejections: [],
  diagnostics: [],
};

const meta = (id: RuleId): RuleMeta => ({
  id,
  summary: `summary of ${id}`,
  restsOn: 'r',
  recovers: 'c',
  reads: [],
  adds: [],
});
const RULES: readonly RuleMeta[] = [
  'valid.dense',
  'gap.forward-chain',
  'seed.call',
  'seed.pool-pointer',
  'bl.near-is-call',
].map((id) => meta(id as RuleId));

const EVENTS: readonly TrailEvent[] = [
  { kind: 'propose', at: 0x0800_0300, rule: 'gap.forward-chain', round: 4, cites: [] },
  {
    kind: 'reject',
    at: 0x0800_0300,
    rule: 'valid.dense',
    round: 3,
    cites: [0x0800_0300],
    detail: 'not-dense: 9 holes',
  },
  { kind: 'verdict', at: 0x0800_0308, rule: 'walk.decoder-flow', round: 4, cites: [0x0800_0600] },
];

test('the bucket is the 256-byte aligned block that holds the address', () => {
  assert.equal(EXPLAIN_BUCKET, 0x100);
  assert.deepEqual(explainBucket(0x0800_0314), { start: 0x0800_0300, end: 0x0800_0400 });
  assert.deepEqual(explainBucket(0x0800_0300), { start: 0x0800_0300, end: 0x0800_0400 });
});

test('the filter widens the bucket to every extent that covers the address', () => {
  assert.deepEqual(explainFilter(0x0800_0314), { start: 0x0800_0300, end: 0x0800_0400 });
  assert.deepEqual(explainFilter(0x0800_0314, RESULT), { start: 0x0800_0200, end: 0x0800_0400 });
  assert.deepEqual(explainFilter(0x0800_0900, RESULT), { start: 0x0800_0900, end: 0x0800_0a00 });
});

test('an address inside a nested function is owned by the innermost extent', () => {
  const x = explainAnalysis(RESULT, EVENTS, 0x0800_0314, RULES);
  assert.equal(x.addr, 0x0800_0314);
  assert.equal(x.claim, 2);
  assert.deepEqual(x.owner, { entry: 0x0800_0300, origin: 'gap-scan', provenance: [INNER.accepted] });
  assert.deepEqual(x.events, EVENTS);
  // walk.decoder-flow has no metadata and is left out; the rest are sorted by id, each once.
  assert.deepEqual(
    x.rules.map((r) => r.id),
    ['gap.forward-chain', 'valid.dense'],
  );
});

test('the owner carries every provenance record; an unclaimed address has no owner', () => {
  const x = explainAnalysis(RESULT, [], 0x0800_0330, RULES);
  assert.equal(x.claim, 1);
  assert.deepEqual(x.owner?.provenance, [OUTER.accepted, ...OUTER.also]);
  assert.deepEqual(
    x.rules.map((r) => r.id),
    ['seed.call', 'seed.pool-pointer'],
  );
  const free = explainAnalysis(RESULT, [], 0x0800_0900, RULES);
  assert.equal(free.claim, 0);
  assert.equal(free.owner, undefined);
  assert.ok(!('owner' in free));
  assert.deepEqual(free.rules, []);
});
