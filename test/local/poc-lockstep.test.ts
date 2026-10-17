// The lockstep gate of the driver (roadmap 2.A, architecture §4.5, D48): with every rule family answered
// by the PoC's log, romlift's driver alone makes the PoC's calls in the PoC's order on each tuning ROM:
// no divergence in the queries, the claim markers (the acceptance and absorb sequence) or the epoch
// boundaries, every logged record matched or skipped as nested, and the parity digest of the run equal
// to the committed one (bench/baseline/poc-digests.json). The log comes from
// `npm run export-poc -- --mode queries`. A missing ROM, PoC checkout or dump makes a ROM's test
// `unavailable` (naming the input), or fails it when ROMLIFT_REQUIRE_LOCAL=1.
//
// test/local imports romlift only through its entry points (architecture §2), so the bench's lockstep
// module is loaded by a non-literal dynamic import and typed by the surface below.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const POC_ENV = process.env['ROMLIFT_POC'];
const POC = POC_ENV ? path.resolve(REPO, POC_ENV) : path.join(BENCH_ROOT, 'romlift-poc');
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Divergence {
  readonly kind: string;
  readonly seq: number;
  readonly epoch: number;
  readonly method: string;
  readonly args: readonly unknown[];
  readonly detail: string;
  readonly path: readonly unknown[];
}

interface RomLockstep {
  readonly queries: number;
  readonly matched: number;
  readonly answered: number;
  readonly compared: number;
  readonly markers: number;
  readonly skipped: number;
  readonly recalled: number;
  readonly divergence?: Divergence;
  readonly parityDigest?: string;
  readonly expectedDigest: string;
  readonly functions?: number;
}

interface LockstepModule {
  readonly ANALYSIS_FAMILIES: readonly string[];
  lockstep(cx: { readonly repoRoot: string; readonly benchRoot: string; readonly pocRoot: string }, rom: string, families: readonly string[]): Promise<RomLockstep>;
}

async function benchModule(file: string): Promise<LockstepModule> {
  const module: unknown = await import(pathToFileURL(path.join(REPO, 'bench', 'src', file)).href);
  return module as LockstepModule;
}

/** The tuning ROMs the committed digests cover. */
function tuningRoms(): readonly string[] {
  const digests = JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as { readonly roms: Readonly<Record<string, string>> };
  return Object.keys(digests.roms).sort(byCodeUnit);
}

/** The first missing input of a ROM's lockstep, or undefined. */
function missingInput(rom: string): string | undefined {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${rom}.json`), 'utf8')) as { readonly rom: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  if (!existsSync(romPath)) return `rom ${romPath}`;
  if (!existsSync(path.join(POC, 'src', 'analysis.ts'))) return `poc ${POC}`;
  for (const file of ['queries.ndjson', 'readings.ndjson']) {
    const dump = path.join(REPO, 'bench', '.local', 'poc', rom, file);
    if (!existsSync(dump)) return `dump ${dump} (npm run export-poc -- --mode queries)`;
  }
  return undefined;
}

for (const rom of tuningRoms()) {
  const missing = missingInput(rom);
  test(`lockstep with every family answered: ${rom}`, { skip: missing !== undefined && !REQUIRE ? `unavailable: ${missing}` : false }, async (t) => {
    assert.equal(missing, undefined, `unavailable: ${missing ?? ''}`);
    const { lockstep, ANALYSIS_FAMILIES } = await benchModule('lockstep.ts');
    const r = await lockstep({ repoRoot: REPO, benchRoot: BENCH_ROOT, pocRoot: POC }, rom, ANALYSIS_FAMILIES);
    t.diagnostic(`${rom}: ${r.queries} queries, ${r.matched} matched (${r.markers} markers), ${r.answered} answered, ${r.skipped} skipped, ${r.functions ?? 0} functions, digest ${r.parityDigest ?? 'none'}`);
    assert.equal(r.divergence, undefined, r.divergence === undefined ? '' : `diverges at seq ${r.divergence.seq} (epoch ${r.divergence.epoch}, ${r.divergence.kind}): ${r.divergence.detail}; parents ${JSON.stringify(r.divergence.path)}`);
    assert.equal(r.compared, 0, 'every family answered: nothing is computed');
    assert.ok(r.markers > 0);
    assert.equal(r.matched + r.skipped, r.queries, 'every record of the log is matched, or skipped as nested under an answered query');
    assert.equal(r.parityDigest, r.expectedDigest, 'the parity digest equals the PoC digest in bench/baseline/poc-digests.json');
  });
}
