// g1.arm-sample (architecture §5, §13): every printed ARM mnemonic of the corpus (each row's field
// classes at their boundaries, all 16 conditions, the PC-relative extremes, and a seeded sample of at
// least 2^20 words) assembles to its own bytes, and every ARM row the decoder can reach has a coverage
// entry recording which field classes were swept exhaustively and which only sampled.
//
// FROZEN input: romlift/corpus-summary@1, the last stdout line of `npm run corpus -- --json --reuse`
// (exit 0 when every section agrees, 1 when one does not; both print the summary). This gate reads
// {schema, inputsDigest, options.armSample, sections.arm.{cases, mnemonic, raw, agree, disagree, rawByReason, examples, coverage{<specId>: {exhaustive[], sampled[]}}}}.
//
// The ARM rows are enumerated through the public decoder: one word per (bits 27..20, bits 7..4) bucket
// key under four fills of the other bits, which reaches every row the decode buckets can select.
import { gate, withLock, type ExecResult, type GateContext } from './gate.ts';

type RawReason = 'undefined' | 'unpredictable' | 'sbz-set' | 'as-alias' | 'no-roundtrip';
const RAW_REASONS: readonly RawReason[] = ['undefined', 'unpredictable', 'sbz-set', 'as-alias', 'no-roundtrip'];

interface CorpusSection {
  readonly cases: number;
  readonly mnemonic: number;
  readonly raw: number;
  readonly agree: number;
  readonly disagree: number;
  readonly rawByReason: Readonly<Partial<Record<RawReason, number>>>;
  readonly examples: readonly unknown[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/**
 * The corpus summary. `--reuse` regenerates only a stale corpus; the lock keeps the five corpus gates,
 * which node:test runs in parallel processes, from regenerating it at the same time.
 */
async function corpusSummary(cx: GateContext): Promise<CorpusSummary> {
  const run = await withLock('corpus', () => cx.npm('corpus', ['--json', '--reuse']));
  if (run.code !== 0 && run.code !== 1) throw new Error(`npm run corpus -- --json --reuse exited ${run.code}:\n${tail(run)}`);
  const summary = cx.lastJson<CorpusSummary>(run.stdout);
  if (summary.schema !== 'romlift/corpus-summary@1') {
    throw new Error(`npm run corpus printed schema '${String(summary.schema)}', expected 'romlift/corpus-summary@1'`);
  }
  cx.digest('corpus', summary.inputsDigest);
  return summary;
}

function examples(list: readonly unknown[]): string {
  return JSON.stringify(list.slice(0, 5));
}

interface ArmCoverage {
  readonly exhaustive: readonly string[];
  readonly sampled: readonly string[];
}

interface CorpusSummary {
  readonly schema: string;
  readonly inputsDigest: string;
  readonly options: { readonly armSample: number };
  readonly sections: { readonly arm: CorpusSection & { readonly coverage: Readonly<Record<string, ArmCoverage>> } };
}

/** The slice of `romlift/isa` this gate calls. */
type Decode = (mode: 'thumb' | 'arm', word: number, addr: number) => { readonly specId: string; readonly flow: { readonly kind: string } } | undefined;
type SpecOf = (id: string) => { readonly id: string; readonly mode: string } | undefined;

const ARM_SAMPLE_FLOOR = 1 << 20;
const FILLS: readonly number[] = [0x00000000, 0x000fff0f, 0x0005a50a, 0x000a5a05];

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The ids of the ARM rows the decoder selects for some word, invalid decodings excluded. */
function reachableArmRows(decode: Decode): readonly string[] {
  const ids = new Set<string>();
  for (let high = 0; high < 0x100; high++) {
    for (let low = 0; low < 0x10; low++) {
      for (const fill of FILLS) {
        const word = (0xe0000000 | (high << 20) | (low << 4) | fill) >>> 0;
        const insn = decode('arm', word, 0x08000000);
        if (insn !== undefined && insn.flow.kind !== 'invalid' && insn.specId.startsWith('arm.')) ids.add(insn.specId);
      }
    }
  }
  return [...ids].sort(byCodeUnit);
}

function rawCounts(section: CorpusSection): string {
  return RAW_REASONS.map((reason) => `${reason} ${section.rawByReason[reason] ?? 0}`).join(', ');
}

/** Every printed mnemonic of the section assembles to its own bytes. */
function assertSection(name: string, section: CorpusSection, minCases: number): string {
  if (section.cases < minCases) throw new Error(`the ${name} corpus has ${section.cases} cases, expected at least ${minCases}`);
  if (section.mnemonic <= 0) throw new Error(`the ${name} corpus printed no mnemonic`);
  if (section.disagree !== 0) {
    throw new Error(
      `${section.disagree} of ${section.mnemonic} printed ${name} mnemonics do not assemble to their bytes; first: ${examples(section.examples)}`,
    );
  }
  return `${name}: ${section.cases} cases, ${section.mnemonic} mnemonics, ${section.agree} agree, 0 disagree; raw ${section.raw} (${rawCounts(section)})`;
}

gate({
  id: 'g1.arm-sample',
  phase: 1,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['decode', 'encode', 'format', 'parse', 'assemble', 'roundTrips', 'specOf', 'DIALECT', 'assembleWithBinutils'],
  async run(cx) {
    const summary = await corpusSummary(cx);
    const arm = summary.sections.arm;
    const sample = summary.options.armSample;
    if (!(sample >= ARM_SAMPLE_FLOOR)) throw new Error(`the ARM sample is ${sample} words, expected at least 2^20 = ${ARM_SAMPLE_FLOOR}`);
    cx.note(assertSection('arm', arm, sample));

    const specOf = cx.need<SpecOf>('specOf');
    const covered = Object.keys(arm.coverage).sort(byCodeUnit);
    if (covered.length === 0) throw new Error('the ARM corpus records no per-row coverage');
    const unknown = covered.filter((id) => {
      try {
        const spec = specOf(id);
        return spec === undefined || spec.id !== id || spec.mode !== 'arm';
      } catch {
        return true;
      }
    });
    if (unknown.length > 0) throw new Error(`coverage names ids that are not ARM rows: ${unknown.slice(0, 10).join(', ')}`);
    const reachable = reachableArmRows(cx.need<Decode>('decode'));
    const missing = reachable.filter((id) => arm.coverage[id] === undefined);
    if (missing.length > 0) throw new Error(`${missing.length} decodable ARM rows have no coverage entry: ${missing.slice(0, 10).join(', ')}`);
    // A raw-only row with no fields (arm.nv, arm.undefined) has nothing to sweep, so its entry is empty;
    // it decodes only as invalid, so only the rows decode can select must record a field class.
    const fieldless = (id: string): boolean => (arm.coverage[id]?.exhaustive.length ?? 0) + (arm.coverage[id]?.sampled.length ?? 0) === 0;
    const empty = reachable.filter(fieldless);
    if (empty.length > 0) throw new Error(`${empty.length} decodable ARM rows record no covered field class: ${empty.slice(0, 10).join(', ')}`);
    const rawOnly = covered.filter(fieldless);
    if (rawOnly.length > 0) cx.note(`fieldless raw-only arm rows: ${rawOnly.join(' ')}`);

    let exhaustive = 0;
    let sampled = 0;
    const sampledOnly: string[] = [];
    for (const id of covered) {
      const entry = arm.coverage[id];
      if (entry === undefined) continue;
      exhaustive += entry.exhaustive.length;
      sampled += entry.sampled.length;
      if (entry.sampled.length > 0) sampledOnly.push(`${id}[${entry.sampled.join(',')}]`);
    }
    cx.note(`arm coverage: ${covered.length} rows (${reachable.length} reachable by decode), ${exhaustive} field classes exhaustive, ${sampled} only sampled`);
    if (sampledOnly.length > 0) cx.note(`arm classes covered only by sampling: ${sampledOnly.join(' ')}`);
  },
});
