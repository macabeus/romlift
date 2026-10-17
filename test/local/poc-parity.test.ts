// Milestone M1's parity (architecture §4.5), as committed evidence: before 'poc-lifo' was deleted, a lead
// run under the PoC's LIFO worklist, the epoch cache and no oracle recorded the `parity` member of
// bench/results.json (romlift-bench/parity-evidence@1). Each tuning ROM's recorded parity digest equals
// its digest in bench/baseline/poc-digests.json, and its bench rows equalled the PoC baseline. The run
// is not repeated (g2.poc-parity is historical once phase 2 lands); this checks what it recorded.
//
// test/local imports romlift only through its entry points (architecture §2), so the bench's evidence
// module is loaded by a non-literal dynamic import and typed by the surface below.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface RomEvidence {
  readonly digest: string;
  readonly expected: string;
  readonly rowDiffs: number;
}

interface EvidenceModule {
  parseParityEvidence(value: unknown, where: string): { readonly worklist: string; readonly pocSourceDigest: string; readonly roms: Readonly<Record<string, RomEvidence>> };
}

const digests = JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as { readonly pocSourceDigest: string; readonly roms: Readonly<Record<string, string>> };
const results = JSON.parse(readFileSync(path.join(REPO, 'bench', 'results.json'), 'utf8')) as { readonly parity?: unknown };

for (const rom of Object.keys(digests.roms).sort(byCodeUnit)) {
  test(`the committed parity evidence has the PoC's parity digest: ${rom}`, async (t) => {
    const module = (await import(pathToFileURL(path.join(REPO, 'bench', 'src', 'parity-evidence.ts')).href)) as EvidenceModule;
    assert.notEqual(results.parity, undefined, 'bench/results.json holds the parity evidence');
    const evidence = module.parseParityEvidence(results.parity, 'bench/results.json: parity');
    assert.equal(evidence.worklist, 'poc-lifo');
    assert.equal(evidence.pocSourceDigest, digests.pocSourceDigest, 'the evidence pins the committed PoC checkout');
    const r = evidence.roms[rom];
    assert.ok(r !== undefined, `${rom} has evidence`);
    t.diagnostic(`${rom}: digest ${r.digest}`);
    assert.equal(r.digest, digests.roms[rom], 'the parity digest equals the PoC digest in bench/baseline/poc-digests.json');
    assert.equal(r.expected, digests.roms[rom]);
    assert.equal(r.rowDiffs, 0, 'the rows equalled the PoC baseline');
  });
}
