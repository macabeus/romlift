// The explain workflow (architecture §9.2, D35): two discover runs, the second with trail 'full' filtered
// to explainFilter (the 256-byte bucket around the address widened to the extents covering it), composed
// by explainAnalysis with the registered rules' metadata; the phase-2 report is the analysis part only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { RULES } from '../../../src/core/analysis/driver/rules.ts';
import { explainAnalysis, explainBucket, explainFilter } from '../../../src/core/analysis/explain.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import type { TrailEvent } from '../../../src/core/provenance/trail.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { explain, explainOutcome } from '../../../src/core/workflow/explain.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { DUMMY_PROFILE } from '../../helpers/dummy-profile.ts';
import { listSyntheticFixtures } from '../../helpers/fixtures.ts';

function fixtureRom(name: string): Rom {
  const fixture = listSyntheticFixtures().find((f) => f.name === name);
  assert.ok(fixture !== undefined, `fixture ${name}`);
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  return romFromBytes(bytes, sha1Of(bytes));
}

test('explain equals explainAnalysis over the filtered full-trail rerun of discover', () => {
  const rom = fixtureRom('far-jump');
  const addr = 0x0800_0104;
  const filter = explainFilter(addr, discover(rom));
  const events: TrailEvent[] = [];
  const result = discover(rom, { trail: 'full', trailFilter: filter }, { event: (e) => events.push(e) });
  const expected = explainAnalysis(result, events, addr, Object.values(RULES).map((r) => r.meta));
  assert.deepEqual(explain(rom, addr), expected);
});

test('the trail filter keeps only events touching the bucket and the extents covering the address', () => {
  for (const fixture of listSyntheticFixtures()) {
    const rom = fixtureRom(fixture.name);
    const first = discover(rom);
    for (const f of first.functions) {
      const filter = explainFilter(f.entry, first);
      const bucket = explainBucket(f.entry);
      assert.ok(filter.start <= bucket.start && bucket.end <= filter.end);
      const inside = (a: number): boolean => a >= filter.start && a < filter.end;
      const report = explain(rom, f.entry);
      assert.ok(report.events.length > 0, `${fixture.name} ${f.entry.toString(16)} has events`);
      for (const e of report.events) assert.ok(inside(e.at) || e.cites.some(inside), `${fixture.name}: ${e.kind} at ${e.at.toString(16)} outside the filter`);
    }
  }
});

test('the filtered trail is exactly the unfiltered full trail restricted to the events touching the filter', () => {
  for (const name of ['far-jump', 'adr-handler-block', 'pool-word-push-lr']) {
    const rom = fixtureRom(name);
    const all: TrailEvent[] = [];
    const first = discover(rom, { trail: 'full' }, { event: (e) => all.push(e) });
    for (const addr of [0x0800_0104, 0x0800_0120, 0x0800_0300]) {
      const filter = explainFilter(addr, first);
      const inside = (a: number): boolean => a >= filter.start && a < filter.end;
      assert.deepEqual(explain(rom, addr).events, all.filter((e) => inside(e.at) || e.cites.some(inside)), `${name} ${addr.toString(16)}`);
    }
  }
});

test('an entry is owned by its function, with its provenance and the meta of its rules', () => {
  const rom = fixtureRom('far-jump');
  const fact = discover(rom).functions.find((f) => f.entry === 0x0800_0104);
  assert.ok(fact !== undefined);
  const report = explain(rom, 0x0800_0104);
  assert.equal(report.addr, 0x0800_0104);
  assert.equal(report.claim, Claim.code);
  assert.deepEqual(report.owner, { entry: fact.entry, origin: fact.origin, provenance: [fact.accepted, ...fact.also] });
  const ids = report.rules.map((m) => m.id);
  assert.ok(ids.includes(fact.accepted.rule));
  assert.deepEqual(ids, [...ids].sort());
});

test('an address no extent covers has no owner; its events are still filtered to the bucket', () => {
  const rom = fixtureRom('pool-word-push-lr');
  const report = explain(rom, 0x0800_0120);
  assert.equal(report.owner, undefined);
  assert.ok(report.events.some((e) => e.kind === 'reject' && e.at === 0x0800_0120));
});

test('a given profile is the one explained', () => {
  const rom = fixtureRom('far-jump');
  const fact = discover(rom, { profile: DUMMY_PROFILE }).functions[0];
  assert.ok(fact !== undefined);
  assert.equal(explain(rom, fact.entry, { profile: DUMMY_PROFILE }).owner?.entry, fact.entry);
});

test('an image that is not a cartridge: a free, ownerless report and the E_ROM_NOT_GBA diagnostics, no throw', () => {
  const bytes = new Uint8Array(0x100);
  const rom = romFromBytes(bytes, sha1Of(bytes));
  const outcome = explainOutcome(rom, 0x0800_0000);
  assert.deepEqual(outcome.report, { addr: 0x0800_0000, claim: Claim.free, events: [], rules: [] });
  assert.ok(outcome.diagnostics.length > 0 && outcome.diagnostics.every((d) => d.code === 'E_ROM_NOT_GBA'));
  assert.deepEqual(explain(rom, 0x0800_0000), outcome.report);
});
