// The held-out verdict of g2.held-out (architecture §8.4 "Held-out runs", D25, D53, D60), in one place: the
// gate calls it and test/unit/gates/held-out-verdict.test.ts tests it, so the code the unit tests cover is
// the code that decides the gate. Gates import only romlift's entry points, node:* and test/gates/**
// (architecture §2), so it lives here rather than in bench/src.
import { byCodeUnit } from './order.ts';

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
  readonly by: string;
  /** The decisions the whole waiver rests on, for the message that refuses it. */
  readonly decision: string;
  readonly sealed: readonly SealedBinding[];
  readonly tuningFamilies: readonly string[];
  /**
   * For each family condition the waiver covers, the owner's words and the date and decision that waived
   * it, each printed with that condition. A condition without grounds is not waived: it fails as without a
   * waiver.
   */
  readonly grounds: Readonly<Partial<Record<FamilyCondition, WaiverGround>>>;
}

/** Why one family condition is waived: the owner's words, the day they were given and the decision recording them. */
export interface WaiverGround {
  readonly text: string;
  readonly decided: string;
  readonly decision: string;
}

/** The two family conditions of D53: the passing ROMs span two families; one of them is absent from the tuning set. */
export type FamilyCondition = 'twoFamilies' | 'freshFamily';

/**
 * The waiver of 17 October 2026 (D60): "Tune on tmc, no new ROM" moved tmc, the only sealed ROM of a family
 * absent from the tuning set, into the tuning set; pokefirered and pokeruby stay sealed and must pass. The
 * owner's answer to Q4 on 18 October 2026 (D61), the option chosen: "Waive both" extends it to the
 * two-families condition; every per-ROM threshold and the count of passing ROMs still decide.
 */
export const FAMILY_WAIVER: FamilyWaiver = {
  by: 'the owner, Bruno Macabeus (architecture section 12 item 4)',
  decision: 'D60, D61',
  sealed: [
    {
      name: 'pokefirered',
      sha1: '41cb23d8dccc8ebd7c649cd8fbb58eeace6e2fdc',
      elfSha256: 'bbe723fd5723f311f45b1d5db7a71e9f0284dd54f57ab0f700162d7a88346b5e',
    },
    {
      name: 'pokeruby',
      sha1: 'f28b6ffc97847e94a6c21a63cacf633ee5c8df1e',
      elfSha256: '51cfc8cf2654880e0cd6e20f3801e8c816624dc202c67d0cce8cdc6915128dde',
    },
  ],
  tuningFamilies: ['fe-gba', 'kleod', 'pret-gen3', 'sat-r', 'zeldaret-tmc'],
  grounds: {
    freshFamily: {
      text: "the owner's words: the gate is recorded as having no held-out ROM from a family absent from the tuning set",
      decided: '2026-10-17',
      decision: 'D60',
    },
    twoFamilies: {
      text: 'the owner\'s answer to Q4 of phase-2.md, the option chosen: "Waive both"',
      decided: '2026-10-18',
      decision: 'D61 b',
    },
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

function bindingKey(b: SealedBinding): string {
  return `${b.name} ${b.sha1} ${b.elfSha256}`;
}

/** Why `waiver` does not cover the run of `sealed` with these tuning families, or undefined when it does. */
export function waiverMismatch(
  waiver: FamilyWaiver,
  sealed: readonly SealedBinding[],
  tuningFamilies: readonly string[],
): string | undefined {
  const want = waiver.sealed.map(bindingKey).sort(byCodeUnit);
  const got = sealed.map(bindingKey).sort(byCodeUnit);
  const problems: string[] = [];
  if (want.join('\n') !== got.join('\n')) {
    const missing = want.filter((k) => !got.includes(k)).map((k) => k.split(' ')[0]);
    const extra = got.filter((k) => !want.includes(k)).map((k) => k.split(' ')[0]);
    problems.push(
      `the sealed datasets differ from those it was decided on (missing or changed: ${missing.join(', ') || 'none'}; new or changed: ${extra.join(', ') || 'none'})`,
    );
  }
  const wantFamilies = [...new Set(waiver.tuningFamilies)].sort(byCodeUnit);
  const gotFamilies = [...new Set(tuningFamilies)].filter((f) => f !== '').sort(byCodeUnit);
  if (wantFamilies.join(',') !== gotFamilies.join(','))
    problems.push(`the tuning families are ${gotFamilies.join(', ')}, it was decided on ${wantFamilies.join(', ')}`);
  return problems.length === 0
    ? undefined
    : `the ${waiver.decision} waiver does not apply: ${problems.join('; ')}; a new owner decision is needed`;
}

/**
 * At least two sealed ROMs pass, from at least two families, one of them absent from the tuning set
 * (D53). With `waiver` (D60) a family condition the waiver has grounds for is reported as waived instead
 * of failing, only while the sealed datasets and the tuning families are exactly those it is bound to; a
 * condition without grounds still fails, and the count of passing ROMs
 * and every per-ROM threshold still decide.
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
  const familyProblems: { readonly text: string; readonly ground: FamilyCondition }[] = [];
  if (passed.length < 2) problems.push(`${passed.length} of ${results.length} sealed ROMs pass, at least two must`);
  if (families.length < 2)
    familyProblems.push({
      text: `the passing ROMs span ${families.length} codebase families, at least two must`,
      ground: 'twoFamilies',
    });
  if (freshFamilies.length === 0)
    familyProblems.push({ text: 'no passing ROM is from a family absent from the tuning set', ground: 'freshFamily' });
  const refused =
    waiver === undefined || familyProblems.length === 0
      ? undefined
      : waiverMismatch(waiver.waiver, waiver.sealed, tuningFamilies);
  const w = waiver !== undefined && refused === undefined ? waiver.waiver : undefined;
  const waived: string[] = [];
  for (const p of familyProblems) {
    const ground = w?.grounds[p.ground];
    if (w !== undefined && ground !== undefined) {
      waived.push(`${p.text}: waived by ${w.by} on ${ground.decided} (${ground.decision}; ${ground.text})`);
      continue;
    }
    problems.push(p.text);
  }
  return {
    pass: problems.length === 0,
    passing: passed.map((r) => r.name),
    families,
    freshFamilies,
    problems,
    ...(waived.length > 0 ? { waived } : {}),
    ...(refused === undefined ? {} : { waiverRefused: refused }),
  };
}
