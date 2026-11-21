// `bench web [--port 4173] [--base <ref|file>]` (architecture §8.5): serves bench/web/index.html and
// one JSON endpoint with the artifact, the base it is compared with, the regression verdict, the rows
// that moved, the datasets and the three vocabularies. Read-only; it listens on localhost only.
import { type ServerResponse, createServer } from 'node:http';
import { join } from 'node:path';
import { MISS_REASONS, ORIGINS } from 'romlift';

import { readResultsFile } from './artifact.ts';
import { type BenchContext, resultsPath } from './context.ts';
import { loadDatasets } from './dataset.ts';
import { readFileBytes } from './files.ts';
import { defaultBase, readBase, regression } from './regression.ts';
import { diffResults } from './report.ts';
import { EXCEPTION_CATEGORIES } from './vocabulary.ts';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The body of /api/results. */
export async function apiResults(
  cx: BenchContext,
  baseRef: string | undefined,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const results = await readResultsFile(resultsPath(cx));
  if (results === undefined)
    return { status: 404, body: { error: 'no bench/results.json yet: run `npm run bench -- run`' } };
  let ref = baseRef;
  let baseNote = '';
  if (ref === undefined) {
    try {
      ref = await defaultBase(cx);
    } catch (error) {
      baseNote = message(error);
    }
  }
  const base =
    ref === undefined
      ? undefined
      : (await readBase(cx, ref).catch(() => ({ artifact: undefined, isFile: false }))).artifact;
  let gate: readonly string[] = [];
  let notes: readonly string[] = baseNote === '' ? [] : [baseNote];
  if (ref !== undefined) {
    try {
      const outcome = await regression(cx, { base: ref });
      gate = outcome.failures;
      notes = [...notes, ...outcome.notes];
    } catch (error) {
      notes = [...notes, message(error)];
    }
  }
  return {
    status: 200,
    body: {
      results,
      base: base === undefined || ref === undefined ? null : { ref, meta: base.meta },
      gate,
      notes,
      diff: base === undefined ? null : diffResults(results, base),
      datasets: (await loadDatasets(cx)).datasets,
      vocab: { missReasons: MISS_REASONS, origins: ORIGINS, categories: EXCEPTION_CATEGORIES },
    },
  };
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

export function serve(cx: BenchContext, port: number, baseRef: string | undefined, log: (line: string) => void): void {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const handle = async (): Promise<void> => {
      if (url === '/' || url === '/index.html') {
        send(
          res,
          200,
          'text/html; charset=utf-8',
          await readFileBytes(join(cx.repoRoot, 'bench', 'web', 'index.html')),
        );
      } else if (url === '/api/results') {
        const { status, body } = await apiResults(cx, baseRef);
        send(res, status, 'application/json', JSON.stringify(body));
      } else {
        send(res, 404, 'text/plain', 'not found');
      }
    };
    handle().catch((error: unknown) => send(res, 500, 'application/json', JSON.stringify({ error: message(error) })));
  });
  server.listen(port, '127.0.0.1', () =>
    log(`romlift benchmark: http://localhost:${port}/  (base: ${baseRef ?? 'git merge-base origin/main HEAD'})`),
  );
}
