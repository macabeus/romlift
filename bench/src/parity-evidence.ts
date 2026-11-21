// The PoC-parity evidence of bench/results.json (architecture §4.5 milestone M1, §8.2, g2.poc-parity):
// what the lead's run under the PoC's LIFO worklist measured, kept as written once 'poc-lifo' is deleted
// and the gate is historical. Per tuning ROM: the parity digest of romlift's run against the committed
// PoC digest (bench/baseline/poc-digests.json), whether its bench rows equal the PoC baseline, and the
// lockstep summary of each family set (bench/src/lockstep.ts): the families computed by romlift's rules,
// the others answered from the PoC's log, with the record counts and the first divergence, if any.
import { compareCodeUnits } from 'romlift';

import { BenchError, isRecord } from './files.ts';

export const PARITY_EVIDENCE_SCHEMA = 'romlift-bench/parity-evidence@1';

/** The analysis families of architecture §4.1, in its order (the lockstep's families). */
export const EVIDENCE_FAMILIES = ['seed', 'walk', 'bl', 'valid', 'accept', 'gap', 'claim', 'region'] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];

/**
 * The family sets the lockstep proves, in order: the driver alone (every family answered), each wave-1
 * component's families real with the rest answered, then every family real (roadmap 2.B, 2.C, 2.D).
 */
export const LOCKSTEP_SETS: ReadonlyArray<{ readonly name: string; readonly real: readonly EvidenceFamily[] }> = [
  { name: 'driver', real: [] },
  { name: 'walk+bl+claim', real: ['walk', 'bl', 'claim'] },
  { name: 'seed+valid+accept', real: ['seed', 'valid', 'accept'] },
  { name: 'gap+region', real: ['gap', 'region'] },
  { name: 'all', real: EVIDENCE_FAMILIES },
];

/** The families a set answers from the log: every family it does not compute. */
export function answeredBy(real: readonly EvidenceFamily[]): EvidenceFamily[] {
  return EVIDENCE_FAMILIES.filter((f) => !real.includes(f));
}

/** The first divergence of a lockstep run, as recorded. */
export interface DivergenceSummary {
  readonly seq: number;
  readonly kind: string;
  readonly epoch: number;
  readonly method: string;
  readonly detail: string;
}

export interface LockstepSummary {
  readonly set: string;
  readonly real: readonly EvidenceFamily[];
  readonly queries: number;
  readonly matched: number;
  readonly answered: number;
  readonly compared: number;
  readonly markers: number;
  readonly skipped: number;
  readonly recalled: number;
  /** The parity digest of the lockstep run; null when it stopped at a divergence. */
  readonly parityDigest: string | null;
  readonly divergence: DivergenceSummary | null;
}

export interface RomParityEvidence {
  /** The parity digest of romlift's run under 'poc-lifo'. */
  readonly digest: string;
  /** The committed PoC digest. */
  readonly expected: string;
  /** The number of bench rows that differ from the PoC baseline. */
  readonly rowDiffs: number;
  readonly lockstep: readonly LockstepSummary[];
}

export interface ParityEvidence {
  readonly schema: typeof PARITY_EVIDENCE_SCHEMA;
  /** The commit the measuring run was made on (its HEAD), and whether the tree was dirty. */
  readonly commit: string | null;
  readonly dirty: boolean;
  readonly worklist: 'poc-lifo';
  readonly pocSourceDigest: string;
  readonly roms: Readonly<Record<string, RomParityEvidence>>;
}

/** What one ROM's evidence fails on, empty when it proves parity: digests equal, rows equal, every set followed the log. */
export function romEvidenceProblems(name: string, e: RomParityEvidence): string[] {
  const out: string[] = [];
  if (e.digest !== e.expected) out.push(`${name}: parity digest ${e.digest}, the PoC's is ${e.expected}`);
  if (e.rowDiffs !== 0) out.push(`${name}: ${e.rowDiffs} rows differ from the PoC baseline`);
  for (const set of LOCKSTEP_SETS) {
    const s = e.lockstep.find((l) => l.set === set.name);
    if (s === undefined) out.push(`${name}: no lockstep summary for ${set.name}`);
    else if (s.divergence !== null)
      out.push(
        `${name}: lockstep ${set.name} diverges at seq ${s.divergence.seq} (${s.divergence.kind}): ${s.divergence.detail}`,
      );
    else if (s.parityDigest !== e.expected)
      out.push(
        `${name}: lockstep ${set.name} ends with parity digest ${s.parityDigest ?? 'none'}, the PoC's is ${e.expected}`,
      );
    else if (s.matched + s.skipped !== s.queries)
      out.push(`${name}: lockstep ${set.name} matched ${s.matched} and skipped ${s.skipped} of ${s.queries} records`);
  }
  return out;
}

/** What the evidence fails on for the tuning ROMs `digests` names, empty when every one proves parity. */
export function evidenceProblems(
  e: ParityEvidence,
  digests: { readonly pocSourceDigest: string; readonly roms: Readonly<Record<string, string>> },
): string[] {
  const out: string[] = [];
  if (e.pocSourceDigest !== digests.pocSourceDigest)
    out.push(`the evidence pins PoC source ${e.pocSourceDigest}, poc-digests.json ${digests.pocSourceDigest}`);
  for (const name of Object.keys(digests.roms).sort(compareCodeUnits)) {
    const rom = e.roms[name];
    if (rom === undefined) {
      out.push(`${name}: no parity evidence`);
      continue;
    }
    if (rom.expected !== digests.roms[name])
      out.push(`${name}: the evidence expects ${rom.expected}, poc-digests.json holds ${digests.roms[name] ?? ''}`);
    out.push(...romEvidenceProblems(name, rom));
  }
  return out;
}

// ---------------------------------------------------------------- reading it back

function fail(at: string, what: string): never {
  throw new BenchError(`${at}: ${what}`);
}

function rec(value: unknown, at: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail(at, 'must be an object');
  return value;
}

function str(value: unknown, at: string): string {
  if (typeof value !== 'string') fail(at, 'must be a string');
  return value;
}

function count(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(at, 'must be a count');
  return value;
}

function isFamily(value: unknown): value is EvidenceFamily {
  return (EVIDENCE_FAMILIES as readonly unknown[]).includes(value);
}

function divergence(value: unknown, at: string): DivergenceSummary | null {
  if (value === null) return null;
  const d = rec(value, at);
  return {
    seq: count(d['seq'], `${at}.seq`),
    kind: str(d['kind'], `${at}.kind`),
    epoch: count(d['epoch'], `${at}.epoch`),
    method: str(d['method'], `${at}.method`),
    detail: str(d['detail'], `${at}.detail`),
  };
}

function summary(value: unknown, at: string): LockstepSummary {
  const s = rec(value, at);
  const real = s['real'];
  if (!Array.isArray(real) || !real.every(isFamily)) fail(`${at}.real`, 'must be a list of analysis families');
  const digest = s['parityDigest'];
  return {
    set: str(s['set'], `${at}.set`),
    real,
    queries: count(s['queries'], `${at}.queries`),
    matched: count(s['matched'], `${at}.matched`),
    answered: count(s['answered'], `${at}.answered`),
    compared: count(s['compared'], `${at}.compared`),
    markers: count(s['markers'], `${at}.markers`),
    skipped: count(s['skipped'], `${at}.skipped`),
    recalled: count(s['recalled'], `${at}.recalled`),
    parityDigest: digest === null ? null : str(digest, `${at}.parityDigest`),
    divergence: divergence(s['divergence'], `${at}.divergence`),
  };
}

/** Reads the `parity` member of results.json; throws a BenchError naming the first field that is not as written. */
export function parseParityEvidence(value: unknown, where: string): ParityEvidence {
  const v = rec(value, where);
  if (v['schema'] !== PARITY_EVIDENCE_SCHEMA) fail(`${where}.schema`, `must be ${PARITY_EVIDENCE_SCHEMA}`);
  if (v['worklist'] !== 'poc-lifo') fail(`${where}.worklist`, "must be 'poc-lifo'");
  if (typeof v['dirty'] !== 'boolean') fail(`${where}.dirty`, 'must be a boolean');
  const roms: Record<string, RomParityEvidence> = {};
  const raw = rec(v['roms'], `${where}.roms`);
  for (const name of Object.keys(raw).sort(compareCodeUnits)) {
    const at = `${where}.roms.${name}`;
    const r = rec(raw[name], at);
    const lockstep = r['lockstep'];
    if (!Array.isArray(lockstep)) fail(`${at}.lockstep`, 'must be an array');
    roms[name] = {
      digest: str(r['digest'], `${at}.digest`),
      expected: str(r['expected'], `${at}.expected`),
      rowDiffs: count(r['rowDiffs'], `${at}.rowDiffs`),
      lockstep: lockstep.map((s, i) => summary(s, `${at}.lockstep[${i}]`)),
    };
  }
  return {
    schema: PARITY_EVIDENCE_SCHEMA,
    commit: v['commit'] === null ? null : str(v['commit'], `${where}.commit`),
    dirty: v['dirty'],
    worklist: 'poc-lifo',
    pocSourceDigest: str(v['pocSourceDigest'], `${where}.pocSourceDigest`),
    roms,
  };
}
