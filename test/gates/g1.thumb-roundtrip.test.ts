// g1.thumb-roundtrip (architecture §5, §13): every printed Thumb mnemonic of the corpus (all 65,536
// halfwords) assembles with arm-none-eabi-as to its own bytes; the raw count per RawReason is recorded.
//
// FROZEN input: romlift/corpus-summary@1, the last stdout line of `npm run corpus -- --json --reuse`
// (exit 0 when every section agrees, 1 when one does not; both print the summary). This gate reads
// {schema, inputsDigest, sections.thumb.{cases, mnemonic, raw, agree, disagree, rawByReason, examples}}.
import { type ExecResult, type GateContext, gate, withLock } from './gate.ts';

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
  if (run.code !== 0 && run.code !== 1)
    throw new Error(`npm run corpus -- --json --reuse exited ${run.code}:\n${tail(run)}`);
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

interface CorpusSummary {
  readonly schema: string;
  readonly inputsDigest: string;
  readonly sections: { readonly thumb: CorpusSection };
}

function rawCounts(section: CorpusSection): string {
  return RAW_REASONS.map((reason) => `${reason} ${section.rawByReason[reason] ?? 0}`).join(', ');
}

/** Every printed mnemonic of the section assembles to its own bytes. */
function assertSection(name: string, section: CorpusSection, minCases: number): string {
  if (section.cases < minCases)
    throw new Error(`the ${name} corpus has ${section.cases} cases, expected at least ${minCases}`);
  if (section.mnemonic <= 0) throw new Error(`the ${name} corpus printed no mnemonic`);
  if (section.disagree !== 0) {
    throw new Error(
      `${section.disagree} of ${section.mnemonic} printed ${name} mnemonics do not assemble to their bytes; first: ${examples(section.examples)}`,
    );
  }
  return `${name}: ${section.cases} cases, ${section.mnemonic} mnemonics, ${section.agree} agree, 0 disagree; raw ${section.raw} (${rawCounts(section)})`;
}

gate({
  id: 'g1.thumb-roundtrip',
  phase: 1,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['decode', 'encode', 'format', 'parse', 'assemble', 'roundTrips', 'specOf', 'DIALECT', 'assembleWithBinutils'],
  async run(cx) {
    const summary = await corpusSummary(cx);
    cx.note(assertSection('thumb', summary.sections.thumb, 65536));
  },
});
