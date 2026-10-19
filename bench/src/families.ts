// The metric families of architecture §8.4 and the phase from which each is gated. A `rom` family is
// recorded per tuning ROM in meta.families; a `global` family is a top-level member of results.json
// named after it (the printer's corpus summary is `printer`); `sealed` families are judged per sealed
// ROM by g2.held-out. The provenance check requires every family live at the landed phase.
import { compareCodeUnits } from 'romlift';

export type FamilyScope = 'rom' | 'global' | 'sealed';

export interface FamilySpec {
  readonly liveFrom: 1 | 2 | 3 | 4 | 5 | 6;
  readonly scope: FamilyScope;
  readonly summary: string;
}

export const FAMILIES = {
  printer: { liveFrom: 1, scope: 'global', summary: '100% round-trip; raw share never rises; both alignments and every offset extreme agree' },
  scaffold: { liveFrom: 1, scope: 'rom', summary: 'the scaffold reproduces the SHA-1' },
  entries: { liveFrom: 2, scope: 'rom', summary: 'every miss and false entry listed; raw precision and true positives hold' },
  extents: { liveFrom: 2, scope: 'rom', summary: 'no agreeing function stops agreeing; 99.9% of sized functions agree' },
  'code-end': { liveFrom: 2, scope: 'rom', summary: 'within 16 bytes of the ELF' },
  'held-out': { liveFrom: 2, scope: 'sealed', summary: 'the sealed held-out gate' },
  determinism: { liveFrom: 2, scope: 'rom', summary: 'two processes with a varied environment give one digest' },
  speed: { liveFrom: 2, scope: 'rom', summary: 'CPU time within the ratchet and the budget' },
  readability: { liveFrom: 3, scope: 'rom', summary: 'readability shares only increase; objdiff score 0' },
  memory: { liveFrom: 3, scope: 'global', summary: 'peak RSS below 1,088 MiB under the 384 MiB heap cap on the 32 MiB synthetic ROM' },
  signatures: { liveFrom: 6, scope: 'rom', summary: 'every placement at an ELF FUNC or a listed untyped address' },
} as const satisfies Record<string, FamilySpec>;

export type Family = keyof typeof FAMILIES;

/** The per-ROM families a phase-1 `bench run` measured, from the PoC's dumps. */
export const PHASE1_ROM_FAMILIES: readonly Family[] = ['code-end', 'entries', 'extents', 'scaffold'];

/** What one phase-2 `bench run` of a tuning ROM measured, besides the entries, extents and code end it always scores. */
export interface RomEvidence {
  /** The two runs gave one analysis digest. */
  readonly deterministic: boolean;
  /** bench/baseline/speed.json holds the ROM, so the speed ratchet has a reference. */
  readonly speedBaseline: boolean;
  /** The PoC's dump held a scaffold verdict (phase 2; from phase 3 romlift's raw link, phase3RomFamilies). */
  readonly scaffold: boolean;
}

/** The per-ROM families a phase-2 `bench run` records for one tuning ROM, in name order. */
export function phase2RomFamilies(e: RomEvidence): Family[] {
  const families: Family[] = ['code-end', 'entries', 'extents'];
  if (e.deterministic) families.push('determinism');
  if (e.scaffold) families.push('scaffold');
  if (e.speedBaseline) families.push('speed');
  return families.sort(compareCodeUnits);
}

/** What one phase-3 `bench run` of a tuning ROM measured besides the phase-2 evidence. */
export interface Phase3Evidence {
  readonly deterministic: boolean;
  readonly speedBaseline: boolean;
  /** romlift's raw printer's tree was built and linked (`--scaffold`); it replaces the PoC dump's verdict. */
  readonly scaffold: boolean;
}

/**
 * The per-ROM families a phase-3 `bench run` records for one tuning ROM, in name order: the phase-2
 * families, `readability` always (every run measures the readable printer's shares), and `scaffold` only
 * from romlift's own raw link under `--scaffold`, never from the PoC's dump.
 */
export function phase3RomFamilies(e: Phase3Evidence): Family[] {
  return [...phase2RomFamilies(e), 'readability' as const].sort(compareCodeUnits);
}

export function familySpec(family: Family): FamilySpec {
  return FAMILIES[family];
}

/** The families of `scope` gated once phase `landed` has landed, in name order. */
export function liveFamilies(landed: number, scope: FamilyScope): Family[] {
  return (Object.keys(FAMILIES) as Family[])
    .filter((f) => familySpec(f).scope === scope && familySpec(f).liveFrom <= landed)
    .sort(compareCodeUnits);
}
