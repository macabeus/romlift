// g1.encoder-agrees (architecture §5, §13): the in-process `assemble` produces the same bytes as
// arm-none-eabi-as for every text the printer emitted in the corpus.
//
// FROZEN input: romlift/corpus-summary@1, the last stdout line of `npm run corpus -- --json --reuse`
// (exit 0 when every section agrees, 1 when one does not; both print the summary). This gate reads
// {schema, inputsDigest, encoderAgrees.{checked, disagree, examples}}.
import { gate, withLock, type ExecResult, type GateContext } from './gate.ts';

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

interface CorpusSummary {
  readonly schema: string;
  readonly inputsDigest: string;
  readonly encoderAgrees: { readonly checked: number; readonly disagree: number; readonly examples: readonly unknown[] };
}

gate({
  id: 'g1.encoder-agrees',
  phase: 1,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['decode', 'encode', 'format', 'parse', 'assemble', 'roundTrips', 'specOf', 'DIALECT', 'assembleWithBinutils'],
  async run(cx) {
    const { encoderAgrees } = await corpusSummary(cx);
    if (encoderAgrees.checked <= 0) throw new Error('no printed text was checked against assemble');
    if (encoderAgrees.disagree !== 0) {
      throw new Error(`assemble differs from as on ${encoderAgrees.disagree} of ${encoderAgrees.checked} texts; first: ${examples(encoderAgrees.examples)}`);
    }
    cx.note(`assemble equals as on all ${encoderAgrees.checked} printed texts`);
  },
});
