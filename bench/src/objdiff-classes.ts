// The finer classes of the objdiff family's differences (phase-3.md Q1): what each gated difference of
// objdiff.ts amounts to. A class that says both sides link to the same word is given only when that is checked:
// the word each side links to is computed from the addresses the reference ELF gives the names (the address of
// romlift's default spelling, core/model/names.ts defaultSpellingAddress, when it has none), the relocation's addend read from the object that carries it, and the base's plain
// value read from the base object (objdiff.ts DifferenceFacts). A difference that would fall in such a class but
// whose facts are missing is `unverified`, which is gated under every option. Pure and bench-internal;
// bench/tools/objdiff-classes.ts runs it over the tuning ROMs, and objdiff.ts's verdict counts with it what g6.objdiff
// gates.
//
//   resolved-call     objdiff.ts's kind: a call or branch `as` resolved inside the reference object, which the
//                     base relocates against the same function (objdiff.ts resolvedCall checks the offset)
//   static-callee     `bl <offset> | bl <name>-0x4` (or `b`), where the reference's resolved target, its section's
//                     linked start plus <offset>, is an address the ELF gives <name>: a callee the reference
//                     object names otherwise (a static function the ELF names more than once, a local label)
//   value-named       `.word <value> | .word <name>` or `.word <name>+0x<addend>` (`-0x` below it) where <name>
//                     plus the addend links to <value> (with the Thumb bit of a Thumb function, as R_ARM_ABS32 sets
//                     it): the reference holds the plain constant, the base names it (romlift's printer spells a word
//                     inside a named, sized entry `name + offset`, core/emit/print/pool.ts)
//   alias             a relocation `<a> | <b>` where <a> and <b> name one address and both sides, with their
//                     addends, link to the same word
//   symbol-addend     a relocation `<a> | <b>` where `<a> + addend` (the reference's) links to the word `<b> +
//                     addend` (the base's) does and <b> lies inside <a> or at its end (the ELF's size)
//   value-for-symbol  a missing relocation: the reference relocates against `<symbol> + addend`, the base holds a
//                     plain value, and the two are the same word (an R_ARM_ABS32's word; an R_ARM_THM_CALL's
//                     target, from the row's linked address)
//   unverified        a difference of one of the checked shapes above whose facts are missing: an entry or an
//                     addend unknown, a relocation type the reader does not decode
//   trailing-pad      a zero halfword after the last instruction that the reference's symbol size counts and
//                     the base's chunk leaves to the next `.align` (`.hword 0x0 | (none)`)
//   default-name      a relocation `<a> | <b>` where <b> is romlift's default data name `gUnk_<ADDR>` of the address
//                     it spells (D111: a work-RAM word nothing names), outside <a>, and both sides with their addends
//                     link to the same word: the plain value the default name stands for, as value-for-symbol
//                     (the owner's answer of 9 November 2026, D111)
//   relocation-other  any other relocation difference: two words that differ, or the same word through a label
//                     outside the symbol's ELF size (not claimed as symbol-addend)
//   instruction-other any other instruction difference
//   and objdiff.ts's own missing-symbol, tool, assemble, score and unnamed-target.
//
// SAME_WORD lists the classes whose two sides are checked to link to the same word, the classes Q1's option (b)
// reports rather than gates; NOT_COMPARED the functions objdiff could not compare at all. D34 as the owner amended it
// on 25 October 2026 (D102: phase-3.md Q1 option (b) and phase-6.md Q6 option (c)) gates every other class but
// unnamed-target (isGated), up to each tuning ROM's ceiling (bench/baseline/objdiff-ceiling.json, g6.objdiff).
import { R_ARM, R_ARM_BRANCHES, abs32Word } from 'romlift';
import { defaultSpellingAddress } from 'romlift/internal';

import type { ObjdiffDifference } from './objdiff.ts';

export type ObjdiffClass =
  | 'resolved-call'
  | 'static-callee'
  | 'value-named'
  | 'alias'
  | 'symbol-addend'
  | 'value-for-symbol'
  | 'default-name'
  | 'unverified'
  | 'trailing-pad'
  | 'relocation-other'
  | 'instruction-other'
  | 'missing-symbol'
  | 'tool'
  | 'assemble'
  | 'score'
  | 'unnamed-target';

/** Every class, in the order a table lists them. */
export const OBJDIFF_CLASSES: readonly ObjdiffClass[] = [
  'resolved-call',
  'static-callee',
  'value-named',
  'alias',
  'symbol-addend',
  'value-for-symbol',
  'default-name',
  'unverified',
  'trailing-pad',
  'relocation-other',
  'instruction-other',
  'assemble',
  'score',
  'missing-symbol',
  'tool',
  'unnamed-target',
];

/** The classes whose two sides are checked to link to the same word. */
export const SAME_WORD: ReadonlySet<ObjdiffClass> = new Set<ObjdiffClass>([
  'resolved-call',
  'static-callee',
  'value-named',
  'alias',
  'symbol-addend',
  'value-for-symbol',
  'default-name',
]);
/** The classes that are functions objdiff did not compare. */
export const NOT_COMPARED: ReadonlySet<ObjdiffClass> = new Set<ObjdiffClass>(['missing-symbol', 'tool']);

/** Where a name stands: an address, the size the ELF gives it (0 when unknown), and whether it is a Thumb function. */
export interface NamedSpan {
  readonly addr: number;
  readonly size: number;
  readonly thumb: boolean;
}

/** The spans a name stands for: the ELF's symbols of that name, else the address a default spelling encodes. */
export type NameAddresses = (name: string) => readonly NamedSpan[];

interface ElfName {
  readonly name: string;
  readonly addr: number;
  readonly size?: number;
  readonly thumb?: boolean;
}

/**
 * A NameAddresses over ELF symbols (name, addr, size, thumb), falling back to romlift's default spellings; a default
 * spelling is a Thumb function when the ELF has a Thumb function at its address.
 */
export function nameAddresses(symbols: readonly ElfName[]): NameAddresses {
  const byName = new Map<string, NamedSpan[]>();
  const thumbAt = new Set<number>();
  for (const s of symbols) {
    const span: NamedSpan = { addr: s.addr, size: s.size ?? 0, thumb: s.thumb === true };
    if (span.thumb) thumbAt.add(s.addr);
    const list = byName.get(s.name);
    if (list === undefined) byName.set(s.name, [span]);
    else if (!list.some((x) => x.addr === s.addr)) list.push(span);
  }
  return (name) => {
    const found = byName.get(name);
    if (found !== undefined) return found;
    const addr = defaultSpellingAddress(name);
    return addr === undefined ? [] : [{ addr, size: 0, thumb: thumbAt.has(addr) }];
  };
}

const NAME = '[A-Za-z_.$][A-Za-z0-9_.$]*';
const WORD_ROW = new RegExp(`arg-mismatch: \\.word (0x[0-9a-f]+) \\| \\.word (${NAME})(?:([+-])0x([0-9a-f]+))?$`);
const STATIC_CALL = new RegExp(`arg-mismatch: (?:bl|b) (0x[0-9a-f]+) \\| (?:bl|b) (${NAME})-0x[48]$`);
const TRAILING_PAD = /delete: \.hword 0x0 \| \(none\)$/;
const RELOCATION_ROW = new RegExp(`: (${NAME}) \\| (${NAME})$`);
const MISSING_ROW = new RegExp(`: (${NAME}) \\| a plain value$`);

/**
 * The word `span + addend` links to under relocation `type`: R_ARM_ABS32 sets the Thumb bit of a Thumb function; for a
 * branch (R_ARM_BRANCHES) it is the target, the PC bias of both sides being one.
 */
function linkedWord(span: NamedSpan, addend: number, type: number): number | undefined {
  if (type === R_ARM.ABS32) return abs32Word({ addr: span.addr, thumbFunction: span.thumb }, addend);
  if (R_ARM_BRANCHES.has(type)) return (span.addr + addend) >>> 0;
  return undefined;
}

/** romlift's default data name `gUnk_<ADDR>` (D111), as foundation/util/project-files.ts dataName spells it. */
const DEFAULT_DATA_NAME = /^gUnk_[0-9A-F]{8}$/;

/** The class of a relocation `<a> | <b>`: alias, symbol-addend, default-name, relocation-other or unverified. */
function relocationClass(
  a: readonly NamedSpan[],
  b: readonly NamedSpan[],
  d: ObjdiffDifference,
  baseName = '',
): ObjdiffClass {
  const { relocationType: type, referenceAddend, baseAddend } = d.facts;
  if (
    type === undefined ||
    referenceAddend === undefined ||
    baseAddend === undefined ||
    a.length === 0 ||
    b.length === 0
  )
    return 'unverified';
  if (!R_ARM_BRANCHES.has(type) && type !== R_ARM.ABS32) return 'unverified';
  let alias = false;
  let inside = false;
  for (const x of a) {
    for (const y of b) {
      if (linkedWord(x, referenceAddend, type) !== linkedWord(y, baseAddend, type)) continue;
      if (y.addr === x.addr) alias = true;
      else if (y.addr > x.addr && y.addr <= x.addr + x.size) inside = true;
    }
  }
  if (alias) return 'alias';
  if (inside) return 'symbol-addend';
  // The base names the word by its default name, the address it spells, which the reference's `<a> + addend` links to.
  const spelled = DEFAULT_DATA_NAME.test(baseName) ? defaultSpellingAddress(baseName) : undefined;
  const sameWord =
    spelled !== undefined &&
    a.some(
      (x) =>
        linkedWord(x, referenceAddend, type) === linkedWord({ addr: spelled, size: 0, thumb: false }, baseAddend, type),
    );
  return sameWord ? 'default-name' : 'relocation-other';
}

/** The class of a missing relocation: value-for-symbol, relocation-other or unverified. */
function missingClass(symbol: readonly NamedSpan[], d: ObjdiffDifference): ObjdiffClass {
  const { relocationType: type, referenceAddend, baseField, sectionBase, offset } = d.facts;
  if (type === undefined || referenceAddend === undefined || baseField === undefined || symbol.length === 0)
    return 'unverified';
  if (type === R_ARM.ABS32)
    return symbol.some((x) => linkedWord(x, referenceAddend, type) === baseField >>> 0)
      ? 'value-for-symbol'
      : 'relocation-other';
  if (type === R_ARM.THM_CALL) {
    // The reference's bl at P reaches S + A + 4, the base's plain bl P + 4 + its offset: one target when S + A = P + offset.
    if (sectionBase === undefined || offset === undefined) return 'unverified';
    const site = sectionBase + offset;
    return symbol.some((x) => (x.addr + referenceAddend) >>> 0 === (site + baseField) >>> 0)
      ? 'value-for-symbol'
      : 'relocation-other';
  }
  return 'unverified';
}

/** The class of one instruction difference. */
function instructionClass(d: ObjdiffDifference, addressesOf: NameAddresses): ObjdiffClass {
  const detail = d.example.detail;
  const word = WORD_ROW.exec(detail);
  if (word !== null) {
    const value = Number.parseInt(word[1] ?? '', 16);
    const addend = word[4] === undefined ? 0 : Number.parseInt(word[4], 16) * (word[3] === '-' ? -1 : 1);
    return addressesOf(word[2] ?? '').some((x) => linkedWord(x, addend, R_ARM.ABS32) === value)
      ? 'value-named'
      : 'instruction-other';
  }
  const call = STATIC_CALL.exec(detail);
  if (call !== null) {
    if (d.facts.sectionBase === undefined) return 'unverified';
    const target = d.facts.sectionBase + Number.parseInt(call[1] ?? '', 16);
    return addressesOf(call[2] ?? '').some((x) => x.addr === target) ? 'static-callee' : 'instruction-other';
  }
  return TRAILING_PAD.test(detail) ? 'trailing-pad' : 'instruction-other';
}

/** The class of one difference. */
export function objdiffClass(d: ObjdiffDifference, addressesOf: NameAddresses): ObjdiffClass {
  switch (d.kind) {
    case 'instruction':
      return instructionClass(d, addressesOf);
    case 'relocation': {
      const names = RELOCATION_ROW.exec(d.example.detail);
      return names === null
        ? 'relocation-other'
        : relocationClass(addressesOf(names[1] ?? ''), addressesOf(names[2] ?? ''), d, names[2] ?? '');
    }
    case 'missing-relocation': {
      const name = MISSING_ROW.exec(d.example.detail);
      return name === null ? 'unverified' : missingClass(addressesOf(name[1] ?? ''), d);
    }
    case 'resolved-call':
    case 'missing-symbol':
    case 'tool':
    case 'assemble':
    case 'score':
    case 'unnamed-target':
      return d.kind;
    default: {
      const unknown: never = d.kind;
      throw new Error(`objdiff-classes: no class for the kind ${String(unknown)}`);
    }
  }
}

/** The count of every class in `classes` (one per difference), every class present (0 when none). */
export function countClasses(classes: readonly ObjdiffClass[]): Readonly<Record<ObjdiffClass, number>> {
  const out = Object.fromEntries(OBJDIFF_CLASSES.map((c) => [c, 0])) as Record<ObjdiffClass, number>;
  for (const c of classes) out[c] += 1;
  return out;
}

/** The count of every class over `differences`, every class present (0 when none). */
export function classCounts(
  differences: readonly ObjdiffDifference[],
  addressesOf: NameAddresses,
): Readonly<Record<ObjdiffClass, number>> {
  return countClasses(differences.map((d) => objdiffClass(d, addressesOf)));
}

/** Whether D34, as the owner amended it (D102), gates a class: neither a same-word class, nor an uncompared function, nor unnamed-target. */
export function isGated(c: ObjdiffClass): boolean {
  return c !== 'unnamed-target' && !SAME_WORD.has(c) && !NOT_COMPARED.has(c);
}

/** The totals of a ROM's class counts. */
export interface ClassTotals {
  /** The differences D34 as amended gates (isGated), held to the ROM's ceiling by g6.objdiff. */
  readonly gated: number;
  /** The functions objdiff did not compare (NOT_COMPARED), counted and reported. */
  readonly uncompared: number;
  /** The differences checked to link to the same word (SAME_WORD), reported. */
  readonly sameWord: number;
  /** Every difference but unnamed-target: what D34 gated as first written, before D102. */
  readonly beforeAmendment: number;
}

/** The totals of `counts` (classCounts). */
export function classTotals(counts: Readonly<Record<ObjdiffClass, number>>): ClassTotals {
  let gated = 0;
  let uncompared = 0;
  let sameWord = 0;
  let beforeAmendment = 0;
  for (const c of OBJDIFF_CLASSES) {
    const n = counts[c];
    if (c !== 'unnamed-target') beforeAmendment += n;
    if (isGated(c)) gated += n;
    if (NOT_COMPARED.has(c)) uncompared += n;
    if (SAME_WORD.has(c)) sameWord += n;
  }
  return { gated, uncompared, sameWord, beforeAmendment };
}
