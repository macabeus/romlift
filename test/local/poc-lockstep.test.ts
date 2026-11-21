// The lockstep gate of the driver (roadmap 2.A, architecture §4.5, D48), as committed evidence: before
// 'poc-lifo' was deleted, the lead's parity run recorded, per tuning ROM, the lockstep of five family sets
// against the PoC's log (`export-poc --mode queries`) in the `parity` member of bench/results.json: the
// driver alone with every family answered, each wave-1 component's families computed with the rest
// answered, and every family computed. Each followed the log with no divergence, matched or skipped
// every record, and ended at the committed PoC digest. The lockstep is not repeated: its order is the
// PoC's LIFO, and the oracle that supplied it was deleted in the fix round of phase 2 (D59); this checks
// what it recorded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface LockstepSummary {
  readonly set: string;
  readonly real: readonly string[];
  readonly queries: number;
  readonly matched: number;
  readonly answered: number;
  readonly compared: number;
  readonly markers: number;
  readonly skipped: number;
  readonly parityDigest: string | null;
  readonly divergence: { readonly seq: number; readonly kind: string; readonly detail: string } | null;
}

interface EvidenceModule {
  readonly LOCKSTEP_SETS: ReadonlyArray<{ readonly name: string; readonly real: readonly string[] }>;
  parseParityEvidence(
    value: unknown,
    where: string,
  ): {
    readonly roms: Readonly<
      Record<string, { readonly expected: string; readonly lockstep: readonly LockstepSummary[] }>
    >;
  };
}

const digests = JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-digests.json'), 'utf8')) as {
  readonly roms: Readonly<Record<string, string>>;
};
const results = JSON.parse(readFileSync(path.join(REPO, 'bench', 'results.json'), 'utf8')) as {
  readonly parity?: unknown;
};

for (const rom of Object.keys(digests.roms).sort(byCodeUnit)) {
  test(`the committed lockstep of every family set followed the PoC's log: ${rom}`, async (t) => {
    const module = (await import(
      pathToFileURL(path.join(REPO, 'bench', 'src', 'parity-evidence.ts')).href
    )) as EvidenceModule;
    const evidence = module.parseParityEvidence(results.parity, 'bench/results.json: parity');
    const r = evidence.roms[rom];
    assert.ok(r !== undefined, `${rom} has evidence`);
    assert.deepEqual(
      r.lockstep.map((s) => s.set),
      module.LOCKSTEP_SETS.map((s) => s.name),
    );
    for (const s of r.lockstep) {
      t.diagnostic(
        `${rom} ${s.set}: ${s.queries} records, ${s.matched} matched (${s.markers} markers), ${s.answered} answered, ${s.compared} compared, ${s.skipped} skipped`,
      );
      assert.equal(
        s.divergence,
        null,
        s.divergence === null
          ? ''
          : `${s.set} diverges at seq ${s.divergence.seq} (${s.divergence.kind}): ${s.divergence.detail}`,
      );
      assert.ok(s.markers > 0);
      assert.equal(
        s.matched + s.skipped,
        s.queries,
        `${s.set}: every record matched, or skipped as nested under an answered query`,
      );
      assert.equal(s.parityDigest, digests.roms[rom], `${s.set}: the parity digest equals the PoC digest`);
    }
    const driver = r.lockstep.find((s) => s.set === 'driver');
    assert.equal(driver?.compared, 0, 'the driver alone: every family answered, nothing computed');
    const all = r.lockstep.find((s) => s.set === 'all');
    assert.equal(all?.answered, 0, 'every family computed: nothing answered');
  });
}
