// The finer classes of the objdiff family's differences (phase-3.md Q1): what each gated difference of
// objdiff.ts amounts to. A class that says both sides link to the same word is given only when that is checked:
// the word each side links to is computed from the addresses the reference ELF gives the names (the address of
// romlift's default spelling, core/model/names.ts defaultSpellingAddress, when it has none), the relocation's addend read from the object that carries it, and the base's plain
// value read from the base object (objdiff.ts DifferenceFacts). A difference that would fall in such a class but
// whose facts are missing is `unverified`, which is gated under every option. Pure and bench-internal;
// bench/tools/objdiff-classes.ts runs it over the tuning ROMs.
//
//   resolved-call     objdiff.ts's kind: a call or branch `as` resolved inside the reference object, which the
//                     base relocates against the same function (objdiff.ts resolvedCall checks the offset)
//   static-callee     `bl <offset> | bl <name>-0x4` (or `b`), where the reference's resolved target, its section's
//                     linked start plus <offset>, is an address the ELF gives <name>: a callee the reference
//                     object names otherwise (a static function the ELF names more than once, a local label)
//   value-named       `.word <value> | .word <name>` where <name> links to <value> (its address, with the Thumb bit
//                     of a Thumb function): the reference holds the plain constant, the base names it
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
//   relocation-other  any other relocation difference: two words that differ, or the same word through a label
//                     outside the symbol's ELF size (not claimed as symbol-addend)
//   instruction-other any other instruction difference
//   and objdiff.ts's own missing-symbol, tool, assemble, score and unnamed-target.
//
// SAME_WORD lists the classes whose two sides are checked to link to the same word, the classes Q1's option (b)
// reports rather than gates; NOT_COMPARED the functions objdiff could not compare at all.
import { defaultSpellingAddress } from 'romlift/internal';

import type { ObjdiffDifference } from './objdiff.ts';

export type ObjdiffClass =
  | 'resolved-call'
  | 'static-callee'
  | 'value-named'
  | 'alias'
  | 'symbol-addend'
  | 'value-for-symbol'
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
export const SAME_WORD: ReadonlySet<ObjdiffClass> = new Set<ObjdiffClass>(['resolved-call', 'static-callee', 'value-named', 'alias', 'symbol-addend', 'value-for-symbol']);
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
const WORD_ROW = new RegExp(`arg-mismatch: \\.word (0x[0-9a-f]+) \\| \\.word (${NAME})$`);
const STATIC_CALL = new RegExp(`arg-mismatch: (?:bl|b) (0x[0-9a-f]+) \\| (?:bl|b) (${NAME})-0x[48]$`);
const TRAILING_PAD = /delete: \.hword 0x0 \| \(none\)$/;
const RELOCATION_ROW = new RegExp(`: (${NAME}) \\| (${NAME})$`);
const MISSING_ROW = new RegExp(`: (${NAME}) \\| a plain value$`);

const R_ARM_ABS32 = 2;
const R_ARM_THM_CALL = 10;
/** The branch relocations whose word is a target: the linked targets compare, the PC bias of both sides being one. */
const BRANCH_TYPES: ReadonlySet<number> = new Set([1, 10, 28, 29, 102, 103]);

/** The word `span + addend` links to under relocation `type`: R_ARM_ABS32 sets the Thumb bit of a Thumb function. */
function linkedWord(span: NamedSpan, addend: number, type: number): number | undefined {
  if (type === R_ARM_ABS32) return ((span.addr + addend) | (span.thumb ? 1 : 0)) >>> 0;
  if (BRANCH_TYPES.has(type)) return (span.addr + addend) >>> 0;
  return undefined;
}

/** The class of a relocation `<a> | <b>`: alias, symbol-addend, relocation-other or unverified. */
function relocationClass(a: readonly NamedSpan[], b: readonly NamedSpan[], d: ObjdiffDifference): ObjdiffClass {
  const { relocationType: type, referenceAddend, baseAddend } = d.facts;
  if (type === undefined || referenceAddend === undefined || baseAddend === undefined || a.length === 0 || b.length === 0) return 'unverified';
  if (!BRANCH_TYPES.has(type) && type !== R_ARM_ABS32) return 'unverified';
  let alias = false;
  let inside = false;
  for (const x of a) {
    for (const y of b) {
      if (linkedWord(x, referenceAddend, type) !== linkedWord(y, baseAddend, type)) continue;
      if (y.addr === x.addr) alias = true;
      else if (y.addr > x.addr && y.addr <= x.addr + x.size) inside = true;
    }
  }
  return alias ? 'alias' : inside ? 'symbol-addend' : 'relocation-other';
}

/** The class of a missing relocation: value-for-symbol, relocation-other or unverified. */
function missingClass(symbol: readonly NamedSpan[], d: ObjdiffDifference): ObjdiffClass {
  const { relocationType: type, referenceAddend, baseField, sectionBase, offset } = d.facts;
  if (type === undefined || referenceAddend === undefined || baseField === undefined || symbol.length === 0) return 'unverified';
  if (type === R_ARM_ABS32) return symbol.some((x) => linkedWord(x, referenceAddend, type) === baseField >>> 0) ? 'value-for-symbol' : 'relocation-other';
  if (type === R_ARM_THM_CALL) {
    // The reference's bl at P reaches S + A + 4, the base's plain bl P + 4 + its offset: one target when S + A = P + offset.
    if (sectionBase === undefined || offset === undefined) return 'unverified';
    const site = sectionBase + offset;
    return symbol.some((x) => (x.addr + referenceAddend) >>> 0 === (site + baseField) >>> 0) ? 'value-for-symbol' : 'relocation-other';
  }
  return 'unverified';
}

/** The class of one instruction difference. */
function instructionClass(d: ObjdiffDifference, addressesOf: NameAddresses): ObjdiffClass {
  const detail = d.example.detail;
  const word = WORD_ROW.exec(detail);
  if (word !== null) {
    const value = Number.parseInt(word[1] ?? '', 16);
    return addressesOf(word[2] ?? '').some((x) => linkedWord(x, 0, R_ARM_ABS32) === value) ? 'value-named' : 'instruction-other';
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
      return names === null ? 'relocation-other' : relocationClass(addressesOf(names[1] ?? ''), addressesOf(names[2] ?? ''), d);
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

/** The count of every class over `differences`, every class present (0 when none). */
export function classCounts(differences: readonly ObjdiffDifference[], addressesOf: NameAddresses): Readonly<Record<ObjdiffClass, number>> {
  const out = Object.fromEntries(OBJDIFF_CLASSES.map((c) => [c, 0])) as Record<ObjdiffClass, number>;
  for (const d of differences) out[objdiffClass(d, addressesOf)] += 1;
  return out;
}

/** The differences D34 gates (every class but unnamed-target), and those still gated if the same-word classes were reported and the uncompared functions counted (Q1 option b). */
export function gatedTotals(counts: Readonly<Record<ObjdiffClass, number>>): { readonly gated: number; readonly gatedUnderOptionB: number } {
  let gated = 0;
  let underB = 0;
  for (const c of OBJDIFF_CLASSES) {
    if (c === 'unnamed-target') continue;
    gated += counts[c];
    if (!SAME_WORD.has(c) && !NOT_COMPARED.has(c)) underB += counts[c];
  }
  return { gated, gatedUnderOptionB: underB };
}
