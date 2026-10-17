// The held-out verdict of g2.held-out (architecture §8.4 "Held-out runs", D25, D53, D60), in one place: the
// gate calls it and test/unit/gates/held-out-verdict.test.ts tests it, so the code the unit tests cover is
// the code that decides the gate. Gates import only romlift's entry points, node:* and test/gates/**
// (architecture §2), so it lives here rather than in bench/src.

/** One sealed dataset's judged run: its family (empty when the dataset names none) and its per-ROM verdict. */
export interface SealedResult {
  readonly name: string;
  readonly family: string;
  readonly pass: boolean;
}

/** A sealed dataset as the waiver binds it: the files the decision was made about. */
export interface SealedBinding {
  readonly name: string;
  readonly sha1: string;
  readonly elfSha256: string;
}

/**
 * An owner's waiver of the family conditions of D53. It is bound to the facts it was decided on: the exact
 * sealed datasets (name, ROM SHA-1, ELF SHA-256) and the tuning families at the time. Any change to either
 * (a sealed ROM added, removed, revealed or rebuilt, a tuning family added or dropped) ends the waiver, so
 * the full rule applies again until the owner decides anew.
 */
export interface FamilyWaiver {
  readonly decided: string;
  readonly by: string;
  readonly decision: string;
  readonly sealed: readonly SealedBinding[];
  readonly tuningFamilies: readonly string[];
  /** Why each family condition is waived: the owner's words, or what was inferred from them. */
  readonly grounds: { readonly twoFamilies: string; readonly freshFamily: string };
}

/**
 * The waiver of 17 October 2026 (D60): "Tune on tmc, no new ROM" moved tmc, the only sealed ROM of a family
 * absent from the tuning set, into the tuning set; pokefirered and pokeruby stay sealed and must pass.
 */
export const FAMILY_WAIVER: FamilyWaiver = {
  decided: '2026-10-17',
  by: 'the owner, Bruno Macabeus (architecture section 12 item 4)',
  decision: 'D60',
  sealed: [
    { name: 'pokefirered', sha1: '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc', elfSha256: 'bbe723fd5723f311f45b1d5db7a71e9f0284dd54f57ab0f700162d7a88346b5e' },
    { name: 'pokeruby', sha1: 'f28b6ffc97847e94a6c21a63cacf633ee5c8df1e', elfSha256: '51cfc8cf2654880e0cd6e20f3801e8c816624dc202c67d0cce8cdc6915128dde' },
  ],
  tuningFamilies: ['fe-gba', 'kleod', 'pret-gen3', 'sat-r', 'zeldaret-tmc'],
  grounds: {
    freshFamily: "the owner's words: the gate is recorded as having no held-out ROM from a family absent from the tuning set",
    twoFamilies: "inferred from the owner's words (pokefirered and pokeruby, both pret-gen3, must pass and phase 2 then lands); confirmation requested (phase-2.md, Owner questions)",
  },
};

export interface HeldOutVerdict {
  readonly pass: boolean;
  /** The passing datasets, in input order. */
  readonly passing: readonly string[];
  /** The families of the passing datasets, sorted. */
  readonly families: readonly string[];
  /** Those of `families` absent from the tuning set. */
  readonly freshFamilies: readonly string[];
  readonly problems: readonly string[];
  /** The family conditions the waiver covered (they would have failed), when it applied. */
  readonly waived?: readonly string[];
  /** Why a given waiver did not apply, when the family conditions failed and it was bound to other facts. */
  readonly waiverRefused?: string;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bindingKey(b: SealedBinding): string {
  return `${b.name} ${b.sha1} ${b.elfSha256}`;
}

/** Why `waiver` does not cover the run of `sealed` with these tuning families, or undefined when it does. */
export function waiverMismatch(waiver: FamilyWaiver, sealed: readonly SealedBinding[], tuningFamilies: readonly string[]): string | undefined {
  const want = waiver.sealed.map(bindingKey).sort(byCodeUnit);
  const got = sealed.map(bindingKey).sort(byCodeUnit);
  const problems: string[] = [];
  if (want.join('\n') !== got.join('\n')) {
    const missing = want.filter((k) => !got.includes(k)).map((k) => k.split(' ')[0]);
    const extra = got.filter((k) => !want.includes(k)).map((k) => k.split(' ')[0]);
    problems.push(`the sealed datasets differ from those it was decided on (missing or changed: ${missing.join(', ') || 'none'}; new or changed: ${extra.join(', ') || 'none'})`);
  }
  const wantFamilies = [...new Set(waiver.tuningFamilies)].sort(byCodeUnit);
  const gotFamilies = [...new Set(tuningFamilies)].filter((f) => f !== '').sort(byCodeUnit);
  if (wantFamilies.join(',') !== gotFamilies.join(',')) problems.push(`the tuning families are ${gotFamilies.join(', ')}, it was decided on ${wantFamilies.join(', ')}`);
  return problems.length === 0 ? undefined : `the ${waiver.decision} waiver does not apply: ${problems.join('; ')}; a new owner decision is needed`;
}

/**
 * At least two sealed ROMs pass, from at least two families, one of them absent from the tuning set
 * (D53). With `waiver` (D60) the two family conditions are reported as waived instead of failing, only
 * while the sealed datasets and the tuning families are exactly those it is bound to; the count of passing
 * ROMs and every per-ROM threshold still decide.
 */
export function heldOutVerdict(
  results: readonly SealedResult[],
  tuningFamilies: readonly string[],
  waiver?: { readonly waiver: FamilyWaiver; readonly sealed: readonly SealedBinding[] },
): HeldOutVerdict {
  const tuning = new Set(tuningFamilies);
  const passed = results.filter((r) => r.pass);
  const families = [...new Set(passed.map((r) => r.family).filter((f) => f !== ''))].sort(byCodeUnit);
  const freshFamilies = families.filter((f) => !tuning.has(f));
  const problems: string[] = [];
  const familyProblems: { readonly text: string; readonly ground: 'twoFamilies' | 'freshFamily' }[] = [];
  if (passed.length < 2) problems.push(`${passed.length} of ${results.length} sealed ROMs pass, at least two must`);
  if (families.length < 2) familyProblems.push({ text: `the passing ROMs span ${families.length} codebase families, at least two must`, ground: 'twoFamilies' });
  if (freshFamilies.length === 0) familyProblems.push({ text: 'no passing ROM is from a family absent from the tuning set', ground: 'freshFamily' });
  const refused = waiver === undefined || familyProblems.length === 0 ? undefined : waiverMismatch(waiver.waiver, waiver.sealed, tuningFamilies);
  const waives = waiver !== undefined && familyProblems.length > 0 && refused === undefined;
  if (!waives) problems.push(...familyProblems.map((p) => p.text));
  return {
    pass: problems.length === 0,
    passing: passed.map((r) => r.name),
    families,
    freshFamilies,
    problems,
    ...(waives
      ? { waived: familyProblems.map((p) => `${p.text}: waived by ${waiver.waiver.by} on ${waiver.waiver.decided} (${waiver.waiver.decision}; ${waiver.waiver.grounds[p.ground]})`) }
      : {}),
    ...(refused === undefined ? {} : { waiverRefused: refused }),
  };
}
