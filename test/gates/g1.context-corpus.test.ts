// g1.context-corpus (architecture §5, §13): every PC-relative and branch form agrees with as at a
// 0-mod-4 and a 2-mod-4 address and at its offset extremes (minimum, maximum, maximum + 1 falling back to
// raw), under the shared dialect preamble.
//
// FROZEN input: romlift/corpus-summary@1, the last stdout line of `npm run corpus -- --json --reuse`
// (exit 0 when every section agrees, 1 when one does not; both print the summary). This gate reads
// {schema, inputsDigest, context.{checked, disagree, alignments[], extremes, examples}}.
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
  readonly context: {
    readonly checked: number;
    readonly disagree: number;
    readonly alignments: readonly string[];
    readonly extremes: number;
    readonly examples: readonly unknown[];
  };
}

const ALIGNMENTS: readonly string[] = ['0-mod-4', '2-mod-4'];

gate({
  id: 'g1.context-corpus',
  phase: 1,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['decode', 'encode', 'format', 'parse', 'assemble', 'roundTrips', 'specOf', 'DIALECT', 'assembleWithBinutils'],
  async run(cx) {
    const { context } = await corpusSummary(cx);
    const absent = ALIGNMENTS.filter((alignment) => !context.alignments.includes(alignment));
    if (absent.length > 0) throw new Error(`the context corpus lacks the ${absent.join(' and ')} alignment (has ${context.alignments.join(', ')})`);
    if (context.extremes <= 0) throw new Error('the context corpus checked no offset extreme');
    if (context.checked <= 0) throw new Error('the context corpus checked no address-dependent form');
    if (context.disagree !== 0) {
      throw new Error(`${context.disagree} of ${context.checked} address-dependent forms disagree with as; first: ${examples(context.examples)}`);
    }
    cx.note(`context: ${context.checked} forms at ${context.alignments.join(', ')}, ${context.extremes} offset extremes, 0 disagree`);
  },
});
