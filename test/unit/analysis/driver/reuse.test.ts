// The 'epoch-reuse' cache (core/analysis/driver/reuse.ts): what a reading records while it is computed,
// how a change invalidates it, how a callee's facts and its older stamp pass to its caller, and that on
// every synthetic fixture the analysis under 'epoch-reuse' is the analysis under 'epoch'.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { canonicalJson, profileById, romFromBytes, type AnalysisResult, type JsonValue } from 'romlift';
import { analyzeTuned } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import {
  beginReading,
  carry,
  endReading,
  readAddr,
  readInProgress,
  readOpaque,
  readReading,
  reuseState,
  stillHolds,
  takeCarried,
  touch,
} from '../../../../src/core/analysis/driver/reuse.ts';
import { listSyntheticFixtures } from '../../../helpers/fixtures.ts';
import { BASE, readingOf, romWith } from '../../../helpers/analysis.ts';

const NONE: ReadonlySet<number> = new Set();
const reading = readingOf(romWith([]), { entry: BASE + 0x100 });

test('a reading records the 64-byte pages it read; a change to one of them, and only then, invalidates it', () => {
  const r = reuseState(BASE, 0x1000);
  beginReading(r);
  readAddr(r, BASE + 0x100);
  readAddr(r, BASE + 0x102);
  readAddr(r, BASE + 0x200);
  endReading(r, BASE + 0x100);
  const facts = r.facts.get(BASE + 0x100);
  assert.deepEqual(facts?.pages, [4, 8]);
  assert.ok(facts !== undefined && stillHolds(r, facts, NONE));
  touch(r, BASE + 0x300, BASE + 0x340);
  assert.ok(stillHolds(r, facts, NONE), 'page 12 was not read');
  touch(r, BASE + 0x23f, BASE + 0x240);
  assert.ok(!stillHolds(r, facts, NONE), 'page 8 changed');
});

test('a carried reading is served again only while its facts hold, then belongs to the epoch again', () => {
  const r = reuseState(BASE, 0x1000);
  beginReading(r);
  readAddr(r, BASE + 0x100);
  endReading(r, BASE + 0x100);
  carry(r, BASE + 0x100, reading);
  assert.equal(r.facts.has(BASE + 0x100), false);
  assert.equal(takeCarried(r, BASE + 0x100, NONE), reading);
  assert.equal(r.facts.has(BASE + 0x100), true);
  carry(r, BASE + 0x100, reading);
  touch(r, BASE + 0x100, BASE + 0x104);
  assert.equal(takeCarried(r, BASE + 0x100, NONE), undefined, 'its page changed');
  assert.equal(r.carried.has(BASE + 0x100), false, 'a stale reading is dropped');
});

test('inProgress answers are facts too; an untracked view query makes the reading opaque, never carried', () => {
  const r = reuseState(BASE, 0x1000);
  beginReading(r);
  readInProgress(r, BASE + 0x400, false);
  endReading(r, BASE + 0x100);
  const facts = r.facts.get(BASE + 0x100);
  assert.ok(facts !== undefined && stillHolds(r, facts, NONE));
  assert.ok(!stillHolds(r, facts, new Set([BASE + 0x400])), 'the entry is being settled now');
  beginReading(r);
  readOpaque(r);
  endReading(r, BASE + 0x200);
  carry(r, BASE + 0x200, reading);
  assert.equal(r.carried.has(BASE + 0x200), false);
  // An address outside the ROM cannot be tracked by page.
  beginReading(r);
  readAddr(r, BASE + 0x2000);
  endReading(r, BASE + 0x300);
  assert.equal(r.facts.get(BASE + 0x300)?.opaque, true);
});

test("a callee's facts and its older stamp pass to the caller; an accepted callee contributes its entry's page only", () => {
  const r = reuseState(BASE, 0x1000);
  beginReading(r);
  readAddr(r, BASE + 0x800);
  endReading(r, BASE + 0x800);
  const callee = r.facts.get(BASE + 0x800);
  touch(r, BASE + 0xf00, BASE + 0xf04);
  // The caller is computed after the change and is served the callee's (older) reading.
  beginReading(r);
  readAddr(r, BASE + 0x100);
  readReading(r, BASE + 0x800, false);
  readReading(r, BASE + 0xa00, true);
  endReading(r, BASE + 0x100);
  const caller = r.facts.get(BASE + 0x100);
  assert.deepEqual(caller?.pages, [4, 32, 40]);
  assert.equal(caller?.stamp, callee?.stamp, 'the oldest stamp of the facts it embeds');
  // A callee computed inside the caller merges in when it ends.
  beginReading(r);
  beginReading(r);
  readAddr(r, BASE + 0xc00);
  endReading(r, BASE + 0xc00);
  endReading(r, BASE + 0xb00);
  assert.deepEqual(r.facts.get(BASE + 0xb00)?.pages, [48], 'the callee entry and what it read');
  // A callee with no recorded facts cannot be vouched for.
  beginReading(r);
  readReading(r, BASE + 0xe00, false);
  endReading(r, BASE + 0xd00);
  assert.equal(r.facts.get(BASE + 0xd00)?.opaque, true);
});

const digest = (r: AnalysisResult): string => Array.from(canonicalJson(r as unknown as JsonValue)).join('');

test("'epoch-reuse' gives the analysis 'epoch' gives on every synthetic fixture", () => {
  const profile = profileById('agbcc');
  assert.ok(profile !== undefined);
  const fixtures = listSyntheticFixtures();
  assert.ok(fixtures.length > 0);
  for (const f of fixtures) {
    const bytes = new Uint8Array(readFileSync(f.rom));
    const rom = romFromBytes(bytes, sha1Of(bytes));
    const run = (cache: 'epoch' | 'epoch-reuse'): string => digest(analyzeTuned(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, { cache, disabled: [] }));
    assert.equal(run('epoch-reuse'), run('epoch'), f.name);
  }
});
