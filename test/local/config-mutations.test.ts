// Config mutations whose verdict must equal the link's (correctness-r2-2, correctness-r2-3), on klonoa: the
// config configFromDiscover builds, one entry changed, then generate's check pass and, when it says writable,
// the readable tree written and linked. A [functions] entry listed `arm` that Thumb code calls must still link
// (its callers' bl print raw, W_INTERWORKING_BRANCH), so the check pass is not passing a tree the link fails;
// a module renamed `data` (the data module's own name) or `../../evil` must not be writable at all.
//
// A missing ROM or missing binutils makes the test `unavailable`, or fails it when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildUnits, generate, generatedEntries, initConfigOf, romFromBytes, writable, type RomliftConfig, type Rom } from 'romlift';
import { findBinutils, linkCheck, sha1Of, writeFreshTree } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', 'klonoa.json'), 'utf8')) as { readonly rom: string; readonly sha1: string };
const romPath = path.join(BENCH_ROOT, dataset.rom);
const tools = findBinutils(process.env);
const unavailable = !existsSync(romPath) ? `unavailable: rom ${romPath}` : 'code' in tools ? `unavailable: ${tools.message}` : undefined;

/** generate's verdict on `config` and, when writable, whether its readable tree links to the ROM's SHA-1. */
async function verdict(rom: Rom, config: RomliftConfig): Promise<{ readonly writable: boolean; readonly linked?: boolean; readonly codes: readonly string[] }> {
  const result = generate({ rom, config, decomp: { defined: [] }, printer: 'readable' });
  const codes = [...new Set([...result.diagnostics.map((d) => d.code), ...result.report.checks.filter((c) => !c.ok).map((c) => c.id)])].sort();
  if (!writable(result)) return { writable: false, codes };
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-mutation-'));
  try {
    const applied = await writeFreshTree(dir, { model: result.model, entries: generatedEntries(rom, result), paths: result.paths });
    assert.ok(applied.ok, applied.diagnostics.map((d) => d.message).join('; '));
    const link = await linkCheck({ dir, rom, units: buildUnits(result.model), ...('code' in tools ? {} : { tools }) });
    return { writable: true, linked: link.sha1 === rom.sha1, codes };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('klonoa: a mode-flipped listed function links, and a module name the model refuses is not writable', { skip: REQUIRE ? false : (unavailable ?? false) }, async () => {
  assert.equal(unavailable, undefined, unavailable);
  const bytes = new Uint8Array(readFileSync(romPath));
  const rom = romFromBytes(bytes, sha1Of(bytes));
  assert.equal(rom.sha1, dataset.sha1);
  const init = initConfigOf(rom);
  assert.ok(init.ok);
  const base = init.config;

  for (const entry of [0x0804_0b50, 0x0804_0d68]) {
    const f = base.functions.get(entry);
    assert.ok(f !== undefined && f.mode === 'thumb', `klonoa lists a Thumb function at 0x${entry.toString(16)}`);
    const functions = new Map(base.functions);
    functions.set(entry, { ...f, mode: 'arm' });
    const flipped = await verdict(rom, { ...base, functions });
    assert.deepEqual(flipped, { writable: true, linked: true, codes: flipped.codes }, `0x${entry.toString(16)} listed arm`);
    assert.ok(flipped.codes.includes('W_INTERWORKING_BRANCH'), flipped.codes.join(', '));
  }

  const renamed = (to: string): RomliftConfig => ({ ...base, modules: base.modules.map((m) => (m.name === 'main_2' ? { ...m, name: to } : m)) });
  assert.ok(base.modules.some((m) => m.name === 'main_2') && base.modules.some((m) => m.name === 'data'));
  const data = await verdict(rom, renamed('data'));
  assert.equal(data.writable, false);
  assert.ok(data.codes.includes('E_MODULE_NAME_DUPLICATE'), data.codes.join(', '));
  for (const bad of ['../../evil', '']) {
    const refused = await verdict(rom, renamed(bad));
    assert.equal(refused.writable, false, JSON.stringify(bad));
    assert.ok(refused.codes.includes('E_NAME_INVALID') && refused.codes.includes('paths'), refused.codes.join(', '));
  }
});
