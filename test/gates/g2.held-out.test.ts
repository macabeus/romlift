// g2.held-out (architecture §8.4 "Held-out runs", §13, D25, D53): sealed. Each sealed dataset (held out,
// never revealed) passes when raw precision >= 99.7%, raw recall >= 99.46%, no miss is `glued`, at most 11
// misses are label candidates, >= 99.9% of sized extents agree, and the code end is within 16 bytes. At
// least two sealed ROMs must pass, from at least two engine families, one of them a family absent from the
// tuning set. Only counts and verdicts are read and printed: never an address or a name, and never the
// bench's raw output.
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --only <sealed dataset> --json   exit 0; the last stdout line is romlift/bench-run@1
//   whose `sealed[]` holds one entry of counts for that dataset:
//     {name, entries, elfFunctions, tp, glued, labelCandidates,
//      falseEntries: {startup, veneer, adrCallback, insideElfFunction},
//      extents: {sized, agree}, codeEnd: {delta}}
//   entries and elfFunctions are counted from the end of the startup region, startup entries excluded.
import { gate, type DatasetRef, type GateContext } from './gate.ts';

interface SealedCounts {
  readonly name: string;
  readonly entries: number;
  readonly elfFunctions: number;
  readonly tp: number;
  readonly glued: number;
  readonly labelCandidates: number;
  readonly falseEntries: Readonly<Record<string, number>>;
  readonly extents: { readonly sized: number; readonly agree: number };
  readonly codeEnd: { readonly delta: number };
}

interface BenchRun {
  readonly schema: string;
  readonly sealed: readonly SealedCounts[];
}

const MIN_PRECISION = 0.997;
const MIN_RECALL = 0.9946;
const MAX_LABEL_CANDIDATES = 11;
const MIN_EXTENTS = 0.999;
const MAX_CODE_END_DELTA = 16;
/** A hex address, or a key that holds addresses or symbol names, in a sealed entry means the seal leaked. */
const LEAK = /0x[0-9a-f]{5,}|"(addr|addrs|names|symbol|symbols|misses|rows|labels|untyped)"\s*:/i;

function share(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Runs one sealed dataset and judges its counts; throws without echoing any bench output. */
async function judge(cx: GateContext, dataset: DatasetRef): Promise<{ readonly pass: boolean; readonly summary: string }> {
  const run = await cx.npm('bench', ['run', '--only', dataset.name, '--json']);
  if (run.code !== 0) throw new Error(`bench run --only ${dataset.name} --json exited ${run.code} (output withheld: sealed)`);
  let result: BenchRun;
  try {
    result = cx.lastJson<BenchRun>(run.stdout);
  } catch {
    throw new Error(`bench run --only ${dataset.name} printed no JSON summary (output withheld: sealed)`);
  }
  const counts = result.sealed.find((s) => s.name === dataset.name);
  if (counts === undefined) throw new Error(`bench run --only ${dataset.name} reported no sealed counts`);
  if (LEAK.test(JSON.stringify(counts))) throw new Error(`the sealed entry of ${dataset.name} carries an address or a name; the seal is broken (not printed)`);

  const precision = share(counts.tp, counts.entries);
  const recall = share(counts.tp, counts.elfFunctions);
  const extents = share(counts.extents.agree, counts.extents.sized);
  const failures: string[] = [];
  if (precision < MIN_PRECISION) failures.push(`precision ${pct(precision)} < 99.70%`);
  if (recall < MIN_RECALL) failures.push(`recall ${pct(recall)} < 99.46%`);
  if (counts.glued !== 0) failures.push(`${counts.glued} glued`);
  if (counts.labelCandidates > MAX_LABEL_CANDIDATES) failures.push(`${counts.labelCandidates} label candidates > 11`);
  if (extents < MIN_EXTENTS) failures.push(`extents ${pct(extents, 3)} < 99.9%`);
  if (Math.abs(counts.codeEnd.delta) > MAX_CODE_END_DELTA) failures.push(`code end ${counts.codeEnd.delta} bytes off`);
  const falseByClass = Object.keys(counts.falseEntries)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((k) => `${k} ${counts.falseEntries[k] ?? 0}`)
    .join(', ');
  const measured = `precision ${pct(precision)}, recall ${pct(recall)}, glued ${counts.glued}, label candidates ${counts.labelCandidates}, extents ${pct(extents, 3)}, code end ${counts.codeEnd.delta}, false entries ${falseByClass}`;
  const verdict = failures.length === 0 ? 'pass' : `fail (${failures.join('; ')})`;
  return { pass: failures.length === 0, summary: `${dataset.name} [${dataset.family ?? 'no family'}] ${verdict}: ${measured}` };
}

gate({
  id: 'g2.held-out',
  phase: 2,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['analyze', 'discover'],
  async run(cx) {
    if (cx.sealed.length < 2) throw new Error(`${cx.sealed.length} sealed datasets; the gate needs at least two`);
    const tuningFamilies = new Set(cx.datasets.map((d) => d.family ?? ''));
    const passing: DatasetRef[] = [];
    for (const dataset of cx.sealed) {
      const { pass, summary } = await judge(cx, dataset);
      cx.note(summary);
      if (pass) passing.push(dataset);
    }
    const families = [...new Set(passing.map((d) => d.family ?? ''))].filter((f) => f !== '');
    const fresh = families.filter((f) => !tuningFamilies.has(f));
    const problems: string[] = [];
    if (passing.length < 2) problems.push(`${passing.length} of ${cx.sealed.length} sealed ROMs pass, at least two must`);
    if (families.length < 2) problems.push(`the passing ROMs span ${families.length} engine families, at least two must`);
    if (fresh.length === 0) problems.push('no passing ROM is from a family absent from the tuning set');
    if (problems.length > 0) throw new Error(`held-out: ${problems.join('; ')}`);
    cx.note(`${passing.length} sealed ROMs pass, families ${families.join(', ')} (absent from tuning: ${fresh.join(', ')})`);
  },
});
