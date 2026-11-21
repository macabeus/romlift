// g2.held-out (architecture §8.4 "Held-out runs", §13, D25, D53): sealed. Each sealed dataset (held out,
// never revealed) passes when raw precision >= 99.7%, raw recall >= 99.46%, no miss is `glued`, at most 11
// misses are label candidates, >= 99.9% of sized extents agree, and the code end is within 16 bytes. At
// least two sealed ROMs must pass, from at least two codebase families, one of them a family absent from the
// tuning set. Only counts and verdicts are read and printed: never an address or a name, and never the
// bench's raw output.
//
// The owner's decision of 17 October 2026 (Bruno Macabeus, architecture §12 item 4, D60), "Tune on tmc, no
// new ROM", moved tmc, the only sealed ROM of a family absent from the tuning set, into the tuning set, and
// records the gate as having no held-out ROM of such a family: that waives the fresh-family condition. The
// owner's answer to Q4 of phase-2.md on 18 October 2026 (D61), the option chosen: "Waive both", waives the
// two-families condition too, with those words as its grounds. The verdict is held-out-verdict.ts's
// heldOutVerdict, the unit-tested function: the waiver is bound to the sealed datasets (name, ROM SHA-1,
// ELF SHA-256) and the tuning families it was decided on, and any change to either ends it. It is printed
// in the gate's note every time it applies, with its grounds, and it never covers a per-ROM threshold or the
// count of passing ROMs (at least two).
//
// Expected output, for the phase-2 lead to align (architecture §8.5):
//   npm run bench -- run --only <sealed dataset> --json   exit 0; the last stdout line is romlift/bench-run@1
//   whose `sealed[]` holds one entry of counts for that dataset:
//     {name, entries, elfFunctions, tp, glued, gluedWhere: {insideExtent, outsideExtents, pastCodeEnd},
//      labelCandidates, falseEntries: {startup, veneer, adrCallback, insideElfFunction, other},
//      extents: {sized, agree}, codeEnd: {delta}}
//   gluedWhere splits the glued misses (inside a found extent: a glued split; in no extent or past the code
//   end: code the run never reached) and is printed, never judged: zero glued is the threshold.
//   entries and elfFunctions are counted from the end of the startup region, startup entries excluded.
import { type DatasetRef, type GateContext, gate } from './gate.ts';
import { FAMILY_WAIVER, type SealedResult, heldOutVerdict } from './held-out-verdict.ts';

interface SealedCounts {
  readonly name: string;
  readonly entries: number;
  readonly elfFunctions: number;
  readonly tp: number;
  readonly glued: number;
  readonly gluedWhere?: {
    readonly insideExtent: number;
    readonly outsideExtents: number;
    readonly pastCodeEnd: number;
  };
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
async function judge(
  cx: GateContext,
  dataset: DatasetRef,
): Promise<{ readonly pass: boolean; readonly summary: string }> {
  const run = await cx.npm('bench', ['run', '--only', dataset.name, '--json']);
  if (run.code !== 0)
    throw new Error(`bench run --only ${dataset.name} --json exited ${run.code} (output withheld: sealed)`);
  let result: BenchRun;
  try {
    result = cx.lastJson<BenchRun>(run.stdout);
  } catch {
    throw new Error(`bench run --only ${dataset.name} printed no JSON summary (output withheld: sealed)`);
  }
  const counts = result.sealed.find((s) => s.name === dataset.name);
  if (counts === undefined) throw new Error(`bench run --only ${dataset.name} reported no sealed counts`);
  if (LEAK.test(JSON.stringify(counts)))
    throw new Error(
      `the sealed entry of ${dataset.name} carries an address or a name; the seal is broken (not printed)`,
    );

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
  const g = counts.gluedWhere;
  const where =
    g === undefined
      ? ''
      : ` (inside an extent ${g.insideExtent}, outside every extent ${g.outsideExtents}, past the code end ${g.pastCodeEnd})`;
  const measured = `precision ${pct(precision)}, recall ${pct(recall)}, glued ${counts.glued}${where}, label candidates ${counts.labelCandidates}, extents ${pct(extents, 3)}, code end ${counts.codeEnd.delta}, false entries ${falseByClass}`;
  const verdict = failures.length === 0 ? 'pass' : `fail (${failures.join('; ')})`;
  return {
    pass: failures.length === 0,
    summary: `${dataset.name} [${dataset.family ?? 'no family'}] ${verdict}: ${measured}`,
  };
}

gate({
  id: 'g2.held-out',
  phase: 2,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['analyze', 'discover'],
  async run(cx) {
    if (cx.sealed.length < 2) throw new Error(`${cx.sealed.length} sealed datasets; the gate needs at least two`);
    const tuningFamilies = cx.datasets.map((d) => d.family ?? '');
    const results: SealedResult[] = [];
    for (const dataset of cx.sealed) {
      const { pass, summary } = await judge(cx, dataset);
      cx.note(summary);
      results.push({ name: dataset.name, family: dataset.family ?? '', pass });
    }
    const sealed = cx.sealed.map((d) => ({ name: d.name, sha1: d.sha1, elfSha256: d.elfSha256 ?? '' }));
    const verdict = heldOutVerdict(results, tuningFamilies, { waiver: FAMILY_WAIVER, sealed });
    if (verdict.waiverRefused !== undefined) cx.note(verdict.waiverRefused);
    for (const w of verdict.waived ?? []) cx.note(`WAIVED: ${w}`);
    if (!verdict.pass) throw new Error(`held-out: ${verdict.problems.join('; ')}`);
    cx.note(
      `${verdict.passing.length} sealed ROMs pass, families ${verdict.families.join(', ')} (absent from tuning: ${verdict.freshFamilies.length === 0 ? 'none' : verdict.freshFamilies.join(', ')})`,
    );
  },
});
