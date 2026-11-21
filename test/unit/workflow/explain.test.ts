// The explain workflow (architecture §9.2, D35): one discover run with trail 'full' kept to a window around
// the address, filtered afterwards to explainFilter (the 256-byte bucket around the address widened to the
// extents covering it); a second run only when an extent reaches past the window. explainAnalysis composes
// it with the registered rules' metadata; phase 3 adds the item and chunk of the model configFromDiscover and
// buildModel make of the same discover result (D35); phase 6 the signature part, from the placement holding the
// address on a bare ROM and from the TOML's `from` key in a project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { RULES } from '../../../src/core/analysis/driver/rules.ts';
import { explainAnalysis, explainBucket, explainFilter } from '../../../src/core/analysis/explain.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import { findItem, itemAt } from '../../../src/core/model/item-table.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { TrailEvent } from '../../../src/core/provenance/trail.ts';
import { parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile } from '../../../src/core/signatures/schema.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import {
  explain,
  explainOutcome,
  explainProject,
  modelPart,
  namePart,
  signatureFromConfig,
  signatureOfKey,
} from '../../../src/core/workflow/explain.ts';
import { initConfigOf } from '../../../src/core/workflow/init-config.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { DUMMY_PROFILE } from '../../helpers/dummy-profile.ts';
import { SYNTHETIC_ROOT, listSyntheticFixtures } from '../../helpers/fixtures.ts';

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
  const expected = explainAnalysis(
    result,
    events,
    addr,
    Object.values(RULES).map((r) => r.meta),
  );
  const { item, chunk, name, ...analysisPart } = explain(rom, addr);
  assert.deepEqual(analysisPart, expected);
  const model = buildModel(rom, result, configFromDiscover(rom, result));
  assert.deepEqual({ item, chunk }, modelPart(rom, model, addr));
  assert.deepEqual({ name }, namePart(model, addr));
});

test('phase 3: the item and the chunk of the address in the model of the discover run', () => {
  const rom = fixtureRom('far-jump');
  const found = discover(rom);
  const model = buildModel(rom, found, configFromDiscover(rom, found));
  const entry = explain(rom, 0x0800_0104);
  assert.deepEqual(entry.chunk, { name: 'sub_08000104', kind: 'function', module: 'main' });
  assert.equal(entry.item?.kind, 'insn');
  assert.deepEqual(entry.item, itemAt(model.items, findItem(model.items, 0x0800_0104), rom));
  assert.deepEqual(entry.item?.span, { start: 0x0800_0104, end: 0x0800_0106 });
  // The middle of an item is explained by that item; the header by the header chunk.
  const inside = explain(rom, 0x0800_0105);
  assert.deepEqual(inside.item, entry.item);
  const header = explain(rom, 0x0800_0010);
  assert.deepEqual(header.chunk, { name: 'rom_header', kind: 'header', module: 'rom_header' });
  assert.equal(header.item?.kind, 'data');
  // A pool word of a function is a pool item with its value.
  const pool = found.functions.flatMap((f) => f.pools)[0];
  assert.ok(pool !== undefined);
  assert.equal(explain(rom, pool).item?.kind, 'pool');
});

test('an address outside the ROM has no item and no chunk', () => {
  const rom = fixtureRom('far-jump');
  const report = explain(rom, 0x0300_0000);
  assert.equal(report.item, undefined);
  assert.equal(report.chunk, undefined);
  assert.deepEqual(
    modelPart(rom, buildModel(rom, discover(rom), configFromDiscover(rom, discover(rom))), rom.end + 4),
    {},
  );
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
      for (const e of report.events)
        assert.ok(
          inside(e.at) || e.cites.some(inside),
          `${fixture.name}: ${e.kind} at ${e.at.toString(16)} outside the filter`,
        );
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
      assert.deepEqual(
        explain(rom, addr).events,
        all.filter((e) => inside(e.at) || e.cites.some(inside)),
        `${name} ${addr.toString(16)}`,
      );
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

test('an extent that reaches past the window is explained by a second run filtered to it: the owner and its acceptance are kept', async () => {
  const { romWith, words } = await import('../../helpers/analysis.ts');
  const { armAt } = await import('../../helpers/arm.ts');
  const { thumbAt } = await import('../../helpers/thumb.ts');
  const F = 0x0800_0200;
  // 36,000 `movs r1, #1` then `bx lr`: a 72 KB Thumb function the ARM startup code loads and enters.
  const body = new Uint8Array(2 * 36_000);
  for (let k = 0; k < body.length; k += 2) body.set([0x01, 0x21], k);
  const rom = romWith(
    [
      { at: 0x0800_00c0, bytes: armAt(0x0800_00c0)`ldr r0, _080000c8; bx r0` },
      { at: 0x0800_00c8, bytes: words(F + 1) },
      { at: F, bytes: body },
      { at: F + body.length, bytes: thumbAt(F + body.length)`bx lr` },
    ],
    { entry: 0x0800_00c0 },
  );
  const addr = F + 0x1_1000;
  const { report } = explainOutcome(rom, addr);
  assert.equal(report.owner?.entry, F);
  assert.ok(
    report.events.some((e) => e.kind === 'accept' && e.at === F),
    'the acceptance at the entry, 68 KiB below the address, is kept',
  );
  assert.deepEqual(report, explain(rom, addr));
});

// Phase 4: the name part, and explain inside a project (the confirm run over the project's config).

test('phase 4: a bare ROM names the function holding the address by its default spelling (source default)', () => {
  const rom = fixtureRom('far-jump');
  const report = explain(rom, 0x0800_0104);
  assert.deepEqual(report.name, { value: 'sub_08000104', source: { kind: 'default' } });
  assert.equal(explain(rom, rom.end + 0x100).name, undefined, 'past the ROM no function holds the address');
});

test('phase 4: inside a project, the name and its source come from the TOML, and the analysis is the confirm run', () => {
  const rom = fixtureRom('far-jump');
  const found = discover(rom);
  const config = configFromDiscover(rom, found);
  const entry = config.functions.get(0x0800_0104);
  assert.ok(entry !== undefined);
  const functions = new Map(config.functions);
  functions.set(0x0800_0104, { ...entry, name: 'FarJumpCaller', from: 'legacy' });
  const project = explainProject({ rom, config: { ...config, functions } }, 0x0800_0106);
  assert.ok(project.ok);
  assert.deepEqual(project.report.name, { value: 'FarJumpCaller', source: { kind: 'toml', from: 'legacy' } });
  assert.deepEqual(project.report.chunk, { name: 'FarJumpCaller', kind: 'function', module: 'main' });
  // The claim and the owner equal the bare ROM's: confirm equals discover on the config init writes.
  const bare = explain(rom, 0x0800_0106);
  assert.equal(project.report.claim, bare.claim);
  assert.equal(project.report.owner?.entry, bare.owner?.entry);
  assert.ok(project.report.events.length > 0);
});

test('phase 4: inside a project, another ROM than [rom] sha1 records is E_ROM_SHA1_MISMATCH and nothing is explained', () => {
  const rom = fixtureRom('far-jump');
  const config = configFromDiscover(rom, discover(rom));
  const refused = explainProject(
    { rom, config: { ...config, rom: { ...config.rom, sha1: '0'.repeat(40) } } },
    0x0800_0104,
  );
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.ok ? [] : refused.diagnostics.map((d) => d.code), ['E_ROM_SHA1_MISMATCH']);
});

// ---------------------------------------------------------------------------------------------------
// The signature part (phase 6, D35): from a placement on a bare ROM, from the TOML's `from` key in a project.

const LIBFIX = ((): SignatureFile => {
  const parsed = parseSignatureFile(
    JSON.parse(readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), 'utf8')),
  );
  assert.ok(parsed.ok);
  return parsed.value;
})();

test('signatureOfKey reads sig:<library>@<version> and nothing else', () => {
  assert.deepEqual(signatureOfKey('sig:m4a@2001', 'SoundMain'), { library: 'm4a', version: '2001', name: 'SoundMain' });
  assert.deepEqual(signatureOfKey('sig:libgcc@agbcc', '__divsi3'), {
    library: 'libgcc',
    version: 'agbcc',
    name: '__divsi3',
  });
  for (const bad of [undefined, 'legacy', 'sig:', 'sig:m4a', 'sig:@1', 'sig:m4a@'])
    assert.equal(signatureOfKey(bad, 'X'), undefined, String(bad));
});

test('a bare ROM: the placement holding the address, with its rule; none without files or outside every placement', () => {
  const rom = fixtureRom('library-game');
  const inside = explainOutcome(rom, 0x0800_0246, { signatureFiles: [LIBFIX] }).report;
  assert.deepEqual(inside.signature, { library: 'libfix', version: '1.0', name: 'FixAbs', rule: 'sig.unique-fit' });
  assert.deepEqual(explainOutcome(rom, 0x0800_0278, { signatureFiles: [LIBFIX] }).report.signature, {
    library: 'libfix',
    version: '1.0',
    name: 'gFixTable',
    rule: 'sig.short-member-window',
  });
  assert.equal(explainOutcome(rom, 0x0800_0246).report.signature, undefined);
  assert.equal(
    explainOutcome(rom, 0x0800_0160, { signatureFiles: [LIBFIX] }).report.signature,
    undefined,
    'GameFiller is no member',
  );
});

test("a project: the from key of the function or the symbol holding the address, never the matcher's rule", () => {
  const rom = fixtureRom('library-game');
  const made = initConfigOf(rom, { signatureFiles: [LIBFIX] });
  assert.ok(made.ok);
  const at = (addr: number) => {
    const out = explainProject({ rom, config: made.config }, addr);
    assert.ok(out.ok);
    return out.report.signature;
  };
  assert.deepEqual(at(0x0800_0246), { library: 'libfix', version: '1.0', name: 'FixAbs' });
  assert.deepEqual(at(0x0800_0278), { library: 'libfix', version: '1.0', name: 'gFixTable' });
  assert.equal(at(0x0800_0160), undefined);
  const plain = initConfigOf(rom);
  assert.ok(plain.ok);
  const out = explainProject({ rom, config: plain.config }, 0x0800_0246);
  assert.ok(out.ok && out.report.signature === undefined, 'no from key, no signature: the matcher is not run');
  const model = buildModel(rom, discover(rom), made.config);
  assert.deepEqual(signatureFromConfig(model, made.config, 0x0800_0246).signature?.name, 'FixAbs');
});
