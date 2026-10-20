// Padding-only orphans folded into the next function on the six tuning ROMs (the owner's answer to Q5 b of
// phase-3.md, D68 e; roadmap.md, phase 4, "Carried from phase 3"). Per ROM: the model `generate` emits from it,
// initModel (initConfig, then confirmModel over the config configFromDiscover builds), must hold no orphan chunk
// that is only the zero pad `.align 2, 0` emits before a function of the same module: 1 to 3 zero bytes ending at
// that function's word-aligned entry. Each ROM's orphan files before the fold (the orphans left plus the function
// chunks that folded a pad, chunkEntry past their start) and after it are printed as a diagnostic; phase-3.md
// measured the before counts on the discover model (pokeemerald 3,222, tmc 2,320, fe7j 1,558, sa3 882, sa2 464,
// klonoa 87, of which 3,203, 2,289, 1,530, 867, 448 and 64 padding-only).
//
// A missing ROM makes the ROM's test `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1. test/local imports
// romlift only through its entry points (architecture §2).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { chunkEntry, initModel, profileById, romFromBytes, type Model, type Rom } from 'romlift';
import { sha1Of } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const TUNING = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc'] as const;
const WORD = 4;

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');

/** Whether [start, end) is the zero pad `.align 2, 0` emits before a word-aligned entry at `end`. */
function isPad(rom: Rom, start: number, end: number): boolean {
  if (end % WORD !== 0 || end - start >= WORD || end <= start) return false;
  for (let a = start; a < end; a++) if (rom.bytes[a - rom.base] !== 0) return false;
  return true;
}

interface Counts {
  /** Orphan chunks of the model. */
  readonly orphans: number;
  /** Function chunks that folded the pad before their entry. */
  readonly folded: number;
  /** Orphan chunks that are a pad before a function of the same module (none expected). */
  readonly padOrphans: readonly string[];
}

function countsOf(rom: Rom, model: Model): Counts {
  let orphans = 0;
  let folded = 0;
  const padOrphans: string[] = [];
  model.chunks.forEach((c, i) => {
    if (c.kind === 'function' && chunkEntry(model, c) > c.span.start) folded++;
    if (c.kind !== 'orphan') return;
    orphans++;
    const next = model.chunks[i + 1];
    if (next !== undefined && next.kind === 'function' && next.module === c.module && next.span.start === c.span.end && isPad(rom, c.span.start, c.span.end)) padOrphans.push(c.name);
  });
  return { orphans, folded, padOrphans };
}

for (const name of TUNING) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${name}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;

  test(`no padding-only orphan precedes a function on ${name}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const rom = romFromBytes(bytes, sha1);
    const init = initModel(rom, { profile });
    assert.ok(init.ok, init.ok ? '' : init.diagnostics.map((d) => d.message).join('; '));
    const counts = countsOf(rom, init.model);
    t.diagnostic(`${name}: orphan files before ${counts.orphans + counts.folded}, after ${counts.orphans} (${counts.folded} pads folded into the next function)`);
    assert.deepEqual(counts.padOrphans.slice(0, 10), [], `${name}: ${counts.padOrphans.length} padding-only orphans before a function`);
    assert.ok(counts.folded > 0, `${name}: no pad folded`);
  });
}
