// The finer classes of the objdiff family's differences (phase-3.md Q1): what each gated difference of
// objdiff.ts amounts to, read from its detail text and the addresses the reference ELF and the model give its
// names. Pure and bench-internal; bench/tools/objdiff-classes.ts runs it over the tuning ROMs.
//
//   resolved-call     objdiff.ts's kind: a call or branch `as` resolved inside the reference object
//   static-callee     a `bl <offset> | bl <name>-0x4` whose callee the reference object names otherwise (a
//                     static function the ELF names more than once)
//   value-named       `.word <value> | .word <name>` where <name> is at <value>: the reference holds the plain
//                     constant, the base names it; both link to the same word
//   alias             a relocation `<a> | <b>` where <a> and <b> name one address
//   symbol-addend     a relocation `<a> | <b>` where <b> lies inside <a> or at its end (the ELF's size): the
//                     reference relocates against `<a> + addend` (objdiff prints no addend), the base names the
//                     label at that address
//   value-for-symbol  a missing relocation: the reference relocates against a symbol (often plus an addend),
//                     the base holds the plain value it links to
//   trailing-pad      a zero halfword after the last instruction that the reference's symbol size counts and
//                     the base's chunk leaves to the next `.align` (`.hword 0x0 | (none)`)
//   relocation-other  any other relocation difference (a `sym + addend` against a label inside it, for one)
//   instruction-other any other instruction difference
//   and objdiff.ts's own missing-symbol, tool, assemble, score and unnamed-target.
//
// SAME_WORD lists the classes whose two sides link to the same word, the classes Q1's option (b) reports
// rather than gates; NOT_COMPARED the functions objdiff could not compare at all.
import type { ObjdiffExample } from './objdiff.ts';

export type ObjdiffClass =
  | 'resolved-call'
  | 'static-callee'
  | 'value-named'
  | 'alias'
  | 'symbol-addend'
  | 'value-for-symbol'
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
  'trailing-pad',
  'relocation-other',
  'instruction-other',
  'assemble',
  'score',
  'missing-symbol',
  'tool',
  'unnamed-target',
];

/** The classes whose two sides link to the same word. */
export const SAME_WORD: ReadonlySet<ObjdiffClass> = new Set<ObjdiffClass>(['resolved-call', 'static-callee', 'value-named', 'alias', 'symbol-addend', 'value-for-symbol']);
/** The classes that are functions objdiff did not compare. */
export const NOT_COMPARED: ReadonlySet<ObjdiffClass> = new Set<ObjdiffClass>(['missing-symbol', 'tool']);

/** Where a name stands: an address and the size the ELF gives it (0 when unknown). */
export interface NamedSpan {
  readonly addr: number;
  readonly size: number;
}

/** The spans a name stands for: the ELF's symbols of that name, else the address a default spelling encodes. */
export type NameAddresses = (name: string) => readonly NamedSpan[];

const DEFAULT_SPELLING = /^(?:sub|unk|gUnk)?_([0-9A-F]{8})$/;

/** A NameAddresses over ELF symbols (name, addr), falling back to romlift's default spellings. */
export function nameAddresses(symbols: readonly { readonly name: string; readonly addr: number; readonly size?: number }[]): NameAddresses {
  const byName = new Map<string, NamedSpan[]>();
  for (const s of symbols) {
    const span = { addr: s.addr, size: s.size ?? 0 };
    const list = byName.get(s.name);
    if (list === undefined) byName.set(s.name, [span]);
    else if (!list.some((x) => x.addr === s.addr)) list.push(span);
  }
  return (name) => {
    const found = byName.get(name);
    if (found !== undefined) return found;
    const spelled = DEFAULT_SPELLING.exec(name)?.[1];
    return spelled === undefined ? [] : [{ addr: Number.parseInt(spelled, 16), size: 0 }];
  };
}

const WORD_ROW = /arg-mismatch: \.word (0x[0-9a-f]+) \| \.word ([A-Za-z_.$][A-Za-z0-9_.$]*)$/;
const STATIC_CALL = /arg-mismatch: (?:bl|b) 0x[0-9a-f]+ \| (?:bl|b) [A-Za-z_.$][A-Za-z0-9_.$]*-0x[48]$/;
const TRAILING_PAD = /delete: \.hword 0x0 \| \(none\)$/;
const RELOCATION_ROW = /: ([A-Za-z_.$][A-Za-z0-9_.$]*) \| ([A-Za-z_.$][A-Za-z0-9_.$]*)$/;

function shareAnAddress(a: readonly NamedSpan[], b: readonly NamedSpan[]): boolean {
  return a.some((x) => b.some((y) => y.addr === x.addr));
}

/** Whether some span of `b` starts inside a span of `a` or at its end. */
function insideOrAtEnd(a: readonly NamedSpan[], b: readonly NamedSpan[]): boolean {
  return a.some((x) => b.some((y) => y.addr > x.addr && y.addr <= x.addr + x.size));
}

/** The class of one difference. */
export function objdiffClass(example: ObjdiffExample, addressesOf: NameAddresses): ObjdiffClass {
  const { kind, detail } = example;
  switch (kind) {
    case 'instruction': {
      const word = WORD_ROW.exec(detail);
      if (word !== null && addressesOf(word[2] ?? '').some((x) => x.addr === Number.parseInt(word[1] ?? '', 16))) return 'value-named';
      if (STATIC_CALL.test(detail)) return 'static-callee';
      if (TRAILING_PAD.test(detail)) return 'trailing-pad';
      return 'instruction-other';
    }
    case 'relocation': {
      const names = RELOCATION_ROW.exec(detail);
      if (names === null) return 'relocation-other';
      const a = addressesOf(names[1] ?? '');
      const b = addressesOf(names[2] ?? '');
      if (shareAnAddress(a, b)) return 'alias';
      return insideOrAtEnd(a, b) ? 'symbol-addend' : 'relocation-other';
    }
    case 'missing-relocation':
      return 'value-for-symbol';
    case 'resolved-call':
    case 'missing-symbol':
    case 'tool':
    case 'assemble':
    case 'score':
    case 'unnamed-target':
      return kind;
    default:
      return 'instruction-other';
  }
}

/** The count of every class over `examples`, every class present (0 when none). */
export function classCounts(examples: readonly ObjdiffExample[], addressesOf: NameAddresses): Readonly<Record<ObjdiffClass, number>> {
  const out = Object.fromEntries(OBJDIFF_CLASSES.map((c) => [c, 0])) as Record<ObjdiffClass, number>;
  for (const e of examples) out[objdiffClass(e, addressesOf)] += 1;
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
