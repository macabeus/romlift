// g6.signatures-loo (architecture §8.4 "Signatures", §13, D31): leave one reference out. For every signature
// version that names two or more references in signatures/specs/*.json, and for each of its references R:
// rebuilding the version without R and applying it to R's ROM adds no placement, moves none, and still
// places every member that another reference of the version also has. The gate requires the bench to
// report every such (library, version, reference) triple from the specs, and every count to be zero.
//
// Expected output, aligned by the phase-6 lead (architecture §8.5, D93; bench/src/signatures.ts is p6-signatures-match's):
//   npm run bench -- signatures --loo --json   exit 0; the last stdout line is
//   {"schema":"romlift/bench-signatures-loo@1","runs":[{"library","version","reference",
//     "added","moved","missingShared"}]}   reference = the dataset name the spec gives
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { type ExecResult, gate } from './gate.ts';

interface Spec {
  readonly library: string;
  readonly versions: readonly { readonly id: string; readonly references: readonly { readonly dataset: string }[] }[];
}

interface LooRun {
  readonly library: string;
  readonly version: string;
  readonly reference: string;
  readonly added: number;
  readonly moved: number;
  readonly missingShared: number;
}

interface BenchLoo {
  readonly schema: string;
  readonly runs: readonly LooRun[];
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function key(library: string, version: string, reference: string): string {
  return `${library}@${version} without ${reference}`;
}

gate({
  id: 'g6.signatures-loo',
  phase: 6,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['buildSignatures', 'matchSignatures', 'resolvePlacements'],
  async run(cx) {
    const specDir = path.join(cx.repoRoot, 'signatures', 'specs');
    const expected = new Set<string>();
    for (const name of (await readdir(specDir))
      .filter((n) => n.endsWith('.json'))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const spec = JSON.parse(await readFile(path.join(specDir, name), 'utf8')) as Spec;
      for (const version of spec.versions) {
        if (version.references.length < 2) continue;
        for (const ref of version.references) expected.add(key(spec.library, version.id, ref.dataset));
      }
    }
    if (expected.size === 0)
      throw new Error('no spec version names two or more references, so leave-one-out checks nothing');

    const run = await cx.npm('bench', ['signatures', '--loo', '--json']);
    if (run.code !== 0) throw new Error(`bench signatures --loo --json exited ${run.code}:\n${tail(run)}`);
    const result = cx.lastJson<BenchLoo>(run.stdout);
    if (result.schema !== 'romlift/bench-signatures-loo@1')
      throw new Error(`bench signatures --loo printed schema '${String(result.schema)}'`);
    const reported = new Map(result.runs.map((r) => [key(r.library, r.version, r.reference), r]));
    const problems: string[] = [];
    for (const k of [...expected].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const r = reported.get(k);
      if (r === undefined) problems.push(`${k}: not run`);
      else if (r.added > 0 || r.moved > 0 || r.missingShared > 0)
        problems.push(`${k}: ${r.added} added, ${r.moved} moved, ${r.missingShared} shared members not placed`);
    }
    if (problems.length > 0) throw new Error(`leave one reference out: ${problems.join('; ')}`);
    cx.note(`${expected.size} leave-one-out runs add, move and lose no placement`);
  },
});
