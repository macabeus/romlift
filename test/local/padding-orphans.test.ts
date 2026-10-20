// Padding-only orphans folded into a neighbour on the six tuning ROMs (the owner's answer to Q5 b of phase-3.md,
// D68 e; D75 d; roadmap.md, phase 4, "Carried from phase 3"). Per ROM: the model `generate` emits from it, initModel
// (initConfig, then confirmModel over the config configFromDiscover builds), must hold no orphan chunk that is only a
// zero pad: 1 to 3 zero bytes up to a word-aligned address with no label inside, whether a function of its module
// follows (its start macro emits the pad) or its module ends there (the chunk before takes it as its last item).
// Each ROM's orphan files before the fold (the orphans left plus the chunks that folded a pad) and after it are
// printed as a diagnostic, with the 0x46C0 nop pads that stay orphans (D75 d) and how many of those lie in `c`
// modules; phase-3.md measured the before counts on the discover model (pokeemerald 3,222, tmc 2,320, fe7j 1,558,
// sa3 882, sa2 464, klonoa 87, of which 3,203, 2,289, 1,530, 867, 448 and 64 padding-only).
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

/** Whether [start, end) is a zero pad: 1 to 3 zero bytes up to a word-aligned address. */
function isPad(rom: Rom, start: number, end: number): boolean {
  if (end % WORD !== 0 || end - start >= WORD || end <= start) return false;
  for (let a = start; a < end; a++) if (rom.bytes[a - rom.base] !== 0) return false;
  return true;
}

/** Whether [start, end) is one Thumb nop (0x46C0) up to a word-aligned address. */
function isNopPad(rom: Rom, start: number, end: number): boolean {
  return end - start === 2 && end % WORD === 0 && rom.bytes[start - rom.base] === 0xc0 && rom.bytes[start + 1 - rom.base] === 0x46;
}

interface Counts {
  /** Orphan chunks of the model. */
  readonly orphans: number;
  /** Chunks that folded a pad: before their entry (Chunk.entry) or as their last item at their module's end. */
  readonly folded: number;
  /** Orphan chunks that are a zero pad with no label inside (none expected). */
  readonly padOrphans: readonly string[];
  /** Orphan chunks that are one 0x46C0 nop pad, and how many of them lie in `c` modules. */
  readonly nopOrphans: number;
  readonly nopInC: number;
}

function countsOf(rom: Rom, model: Model): Counts {
  let orphans = 0;
  let folded = 0;
  let nopOrphans = 0;
  let nopInC = 0;
  const padOrphans: string[] = [];
  const kinds = new Map(model.modules.map((m) => [m.name, m.kind] as const));
  const labelled = new Set(model.labels.map((l) => l.addr));
  model.chunks.forEach((c) => {
    if (c.kind === 'function' && chunkEntry(c) > c.span.start) folded++;
    const last = c.items.first + c.items.count - 1;
    const lastStart = model.items.start[last] ?? c.span.start;
    if ((c.kind === 'function' || c.kind === 'orphan') && c.items.count > 1 && model.items.kind[last] === 4 && isPad(rom, lastStart, c.span.end) && model.modules.some((m) => m.span.end === c.span.end)) folded++;
    if (c.kind !== 'orphan') return;
    orphans++;
    let inside = false;
    for (let a = c.span.start + 1; a < c.span.end; a++) if (labelled.has(a)) inside = true;
    if (isPad(rom, c.span.start, c.span.end) && c.innerLabels.length === 0 && !inside) padOrphans.push(c.name);
    if (isNopPad(rom, c.span.start, c.span.end)) {
      nopOrphans++;
      if (kinds.get(c.module) === 'c') nopInC++;
    }
  });
  return { orphans, folded, padOrphans, nopOrphans, nopInC };
}

for (const name of TUNING) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${name}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;

  test(`no padding-only orphan on ${name}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const rom = romFromBytes(bytes, sha1);
    const init = initModel(rom, { profile });
    assert.ok(init.ok, init.ok ? '' : init.diagnostics.map((d) => d.message).join('; '));
    const counts = countsOf(rom, init.model);
    t.diagnostic(`${name}: orphan files before ${counts.orphans + counts.folded}, after ${counts.orphans} (${counts.folded} pads folded); 0x46C0 nop pads left as orphans ${counts.nopOrphans}, ${counts.nopInC} of them in c modules`);
    assert.deepEqual(counts.padOrphans.slice(0, 10), [], `${name}: ${counts.padOrphans.length} padding-only orphans`);
    assert.ok(counts.folded > 0, `${name}: no pad folded`);
  });
}
