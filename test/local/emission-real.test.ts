// Emission on the six tuning ROMs (architecture §6.4, §13 g3.self-check, g3.text-layout, g3.raw-link, g3.link;
// D60, D62 h). Per ROM: the seedless discover analysis under profileById('agbcc'), the config
// configFromDiscover builds from it and buildModel; then verifyModel (tiling, re-encode, module size), the
// text-layout and paths pass over the stream of each printer, and linkCheck of each printer's tree written to
// a temporary directory. The raw tree must reproduce the ROM's SHA-1 on all six (g3.raw-link); the readable
// tree is required to on every ROM too, the target of g3.link (whose floor is three of six), so a ROM that
// stops linking readably fails here and is looked at, never excluded. Each ROM's numbers are printed as a
// diagnostic: the checks, both SHA-1 verdicts, the item and raw-insn counts and the times.
//
// A missing ROM or missing binutils makes the ROM's test `unavailable`, or fails it when
// ROMLIFT_REQUIRE_LOCAL=1. test/local imports romlift only through its entry points (architecture §2).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  analyze,
  buildModel,
  buildUnits,
  checkEntries,
  configFromDiscover,
  emitTree,
  ItemKind,
  profileById,
  romFromBytes,
  verifyModel,
  type FileEntry,
  type Model,
  type Printer,
  type Rom,
  type VerifyReport,
} from 'romlift';
import { findBinutils, linkCheck, sha1Of } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const TUNING = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3', 'tmc'] as const;
const PRINTERS: readonly Printer[] = ['raw', 'readable'];

const profile = profileById('agbcc');
if (profile === undefined) throw new Error('the agbcc profile is not registered');
const tools = findBinutils(process.env);
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const ms = (started: bigint): number => Math.round(Number(process.hrtime.bigint() - started) / 1e6);

function failures(report: VerifyReport): string {
  return report.checks
    .filter((c) => !c.ok)
    .map((c) => `${c.id}: ${c.detail} ${c.diagnostics.slice(0, 5).map((d) => d.message).join('; ')}`)
    .join(' | ');
}

/** The number of items of one kind. */
function countKind(model: Model, kind: number): number {
  let n = 0;
  for (let i = 0; i < model.items.count; i++) if (model.items.kind[i] === kind) n++;
  return n;
}

/** Writes a stream's generated entries under a fresh directory. */
async function writeTree(rom: string, printer: Printer, entries: readonly FileEntry[]): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `romlift-emission-${rom}-${printer}-`));
  roots.push(dir);
  for (const e of entries) {
    if (!('text' in e)) throw new Error(`${e.path}: a reconciled entry in a phase-3 stream`);
    await mkdir(path.dirname(path.join(dir, e.path)), { recursive: true });
    await writeFile(path.join(dir, e.path), e.text);
  }
  return dir;
}

interface PrinterResult {
  readonly layout: VerifyReport;
  readonly sha1: string | null;
  readonly detail: string;
  readonly files: number;
  readonly emitMs: number;
  readonly linkMs: number;
}

async function runPrinter(name: string, rom: Rom, model: Model, printer: Printer): Promise<PrinterResult> {
  const emitStarted = process.hrtime.bigint();
  const entries = [...emitTree(rom, model, { decomp: { defined: [] }, printer })];
  const layout = checkEntries(rom, model, entries);
  const emitMs = ms(emitStarted);
  const linkStarted = process.hrtime.bigint();
  const dir = await writeTree(name, printer, entries);
  const result = await linkCheck({ dir, rom, units: buildUnits(model), ...('code' in tools ? {} : { tools }) });
  const detail = `${result.detail} ${result.diagnostics.map((d) => d.message).join('; ')}`.trim();
  await rm(dir, { recursive: true, force: true });
  return { layout, sha1: result.sha1, detail, files: entries.length, emitMs, linkMs: ms(linkStarted) };
}

for (const name of TUNING) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${name}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = !existsSync(romPath) ? `unavailable: rom ${romPath}` : 'code' in tools ? `unavailable: ${tools.message}` : undefined;

  test(`emission on ${name}: self-checks, text layout, raw and readable links reproduce the SHA-1`, { skip: REQUIRE ? false : (unavailable ?? false) }, async (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const rom = romFromBytes(bytes, sha1);

    const analysisStarted = process.hrtime.bigint();
    const analysis = analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
    const analysisMs = ms(analysisStarted);
    const modelStarted = process.hrtime.bigint();
    const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
    const modelMs = ms(modelStarted);
    const checks = verifyModel(rom, model);

    const results = new Map<Printer, PrinterResult>();
    for (const printer of PRINTERS) results.set(printer, await runPrinter(name, rom, model, printer));
    const raw = results.get('raw');
    const readable = results.get('readable');
    assert.ok(raw !== undefined && readable !== undefined);

    t.diagnostic(
      `${name}: checks ${checks.ok ? 'ok' : 'FAIL'}, text layout raw ${raw.layout.ok ? 'ok' : 'FAIL'} readable ${readable.layout.ok ? 'ok' : 'FAIL'}, ` +
        `raw link ${raw.sha1 === sha1 ? 'SHA-1' : 'differs'}, readable link ${readable.sha1 === sha1 ? 'SHA-1' : 'differs'}; ` +
        `${model.items.count} items, ${countKind(model, ItemKind.rawInsn)} raw-insn, ${model.modules.length} modules, ${readable.files} files; ` +
        `analysis ${analysisMs} ms, model ${modelMs} ms, emit+check raw ${raw.emitMs} ms readable ${readable.emitMs} ms, link raw ${raw.linkMs} ms readable ${readable.linkMs} ms`,
    );
    assert.ok(checks.ok, `${name}: ${failures(checks)}`);
    assert.ok(raw.layout.ok, `${name} (raw): ${failures(raw.layout)}`);
    assert.ok(readable.layout.ok, `${name} (readable): ${failures(readable.layout)}`);
    assert.equal(raw.sha1, sha1, `${name}: the raw tree does not link to the ROM: ${raw.detail}`);
    assert.equal(readable.sha1, sha1, `${name}: the readable tree does not link to the ROM: ${readable.detail}`);
  });
}
