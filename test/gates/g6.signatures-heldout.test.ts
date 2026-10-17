// g6.signatures-heldout (architecture §8.4 "Signatures", §13, D25, D32): sealed. On every sealed held-out
// ROM, every signature placement is at an ELF FUNC or classified untyped by the ELF-checkable classifiers,
// and every table is an ELF OBJECT or a label. Only counts are read and printed: never an address, a name,
// or the bench's raw output.
//
// Expected output, for the phase-6 lead to align (architecture §8.5):
//   npm run bench -- signatures --only <sealed dataset> --json   exit 0; the last stdout line is
//   romlift/bench-signatures@1 whose `sealed[]` holds one entry of counts for that dataset:
//     {name, placements: {total, atElfFunc, untyped, wrong}, tables: {total, object, label, wrong}}
import { gate, type DatasetRef, type GateContext } from './gate.ts';

interface SealedSignatures {
  readonly name: string;
  readonly placements: { readonly total: number; readonly atElfFunc: number; readonly untyped: number; readonly wrong: number };
  readonly tables: { readonly total: number; readonly object: number; readonly label: number; readonly wrong: number };
}

interface BenchSignatures {
  readonly schema: string;
  readonly sealed: readonly SealedSignatures[];
}

/** A hex address, or a key that holds addresses or symbol names, in a sealed entry means the seal leaked. */
const LEAK = /0x[0-9a-f]{5,}|"(addr|addrs|name|names|symbol|symbols|rows|labels)"\s*:/i;

async function judge(cx: GateContext, dataset: DatasetRef): Promise<{ readonly pass: boolean; readonly summary: string }> {
  const run = await cx.npm('bench', ['signatures', '--only', dataset.name, '--json']);
  if (run.code !== 0) throw new Error(`bench signatures --only ${dataset.name} --json exited ${run.code} (output withheld: sealed)`);
  let result: BenchSignatures;
  try {
    result = cx.lastJson<BenchSignatures>(run.stdout);
  } catch {
    throw new Error(`bench signatures --only ${dataset.name} printed no JSON summary (output withheld: sealed)`);
  }
  if (result.schema !== 'romlift/bench-signatures@1') throw new Error(`bench signatures printed another schema (output withheld: sealed)`);
  const counts = result.sealed.find((s) => s.name === dataset.name);
  if (counts === undefined) throw new Error(`bench signatures --only ${dataset.name} reported no sealed counts`);
  const { name: _name, ...numbers } = counts;
  if (LEAK.test(JSON.stringify(numbers))) throw new Error(`the sealed signature entry of ${dataset.name} carries an address or a name; the seal is broken (not printed)`);
  const p = counts.placements;
  const t = counts.tables;
  const failures: string[] = [];
  if (p.wrong > 0 || p.atElfFunc + p.untyped !== p.total) failures.push(`${p.wrong} placements neither at an ELF FUNC nor classified untyped`);
  if (t.wrong > 0 || t.object + t.label !== t.total) failures.push(`${t.wrong} tables neither an OBJECT nor a label`);
  const measured = `placements ${p.total} (ELF FUNC ${p.atElfFunc}, untyped ${p.untyped}, wrong ${p.wrong}), tables ${t.total} (OBJECT ${t.object}, label ${t.label}, wrong ${t.wrong})`;
  return { pass: failures.length === 0, summary: `${dataset.name} ${failures.length === 0 ? 'pass' : `fail (${failures.join('; ')})`}: ${measured}` };
}

gate({
  id: 'g6.signatures-heldout',
  phase: 6,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['matchSignatures', 'resolvePlacements', 'buildSignatures'],
  async run(cx) {
    if (cx.sealed.length === 0) throw new Error('no sealed held-out dataset');
    const failing: string[] = [];
    for (const dataset of cx.sealed) {
      const { pass, summary } = await judge(cx, dataset);
      cx.note(summary);
      if (!pass) failing.push(dataset.name);
    }
    if (failing.length > 0) throw new Error(`signatures on sealed ROMs: ${failing.length} of ${cx.sealed.length} fail (${failing.join(', ')})`);
    cx.note(`signatures on all ${cx.sealed.length} sealed ROMs land on ELF FUNCs, untyped classes, OBJECTs or labels`);
  },
});
