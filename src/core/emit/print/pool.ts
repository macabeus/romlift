// Literal pools (architecture §5 "Literal pools"): what a 32-bit word prints as. A value prints as a name
// only when the linker writes the same word for `.4byte Name` (resolver.ts wordValueOf): an odd value equal
// to a Thumb function's address plus one prints that function; an even value equal to a Thumb function's
// address stays numeric (the linker would set the Thumb bit); a value equal to an ARM function, a table, a
// pool or a data label prints that name, and so does a RAM, I/O or absolute address the config's [symbols]
// names (a global label symbols.ld defines). A local label (a branch target) never names a word, and a label
// is a candidate only where the module can see it (global, or lying in the module). Anything else prints
// `0xXXXXXXXX`.
import type { Addr } from '../../../foundation/rom/span.ts';
import { hex } from '../../../foundation/util/hex.ts';
import { compareLabels, moduleAt, wordValueOf } from '../../model/resolver.ts';
import type { Label, Model } from '../../model/types.ts';

/** The labels of the model at run address `addr` that module `module` can see, preferred first (compareLabels). */
export function visibleLabelsAt(model: Pick<Model, 'labels' | 'modules'>, module: string, addr: Addr): readonly Label[] {
  const labels = model.labels;
  let lo = 0;
  let hi = labels.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((labels[mid] as Label).addr < addr) lo = mid + 1;
    else hi = mid;
  }
  const out: Label[] = [];
  for (let i = lo; i < labels.length; i++) {
    const l = labels[i] as Label;
    if (l.addr !== addr) break;
    out.push(l);
  }
  if (out.length === 0) return out;
  const own = moduleAt(model, addr)?.name === module;
  return out.filter((l) => l.scope === 'global' || own).sort(compareLabels);
}

/** The label `.4byte <name>` of which links to exactly `value`, visible in `module`, or undefined. */
export function labelForWord(model: Pick<Model, 'labels' | 'modules'>, module: string, value: number): Label | undefined {
  const word = value >>> 0;
  const candidates = (word & 1) === 1 ? [...visibleLabelsAt(model, module, word - 1), ...visibleLabelsAt(model, module, word)] : visibleLabelsAt(model, module, word);
  return candidates.find((l) => l.kind !== 'local' && wordValueOf(l) === word);
}

/** The operand of a `.4byte` holding `value`: a label's name under the rule above, else `0xXXXXXXXX`. */
export function wordText(model: Pick<Model, 'labels' | 'modules'>, module: string, value: number): string {
  return labelForWord(model, module, value)?.name ?? `0x${hex(value)}`;
}

/** A pool word's line: its labels on the same line, `_08001A3C: .4byte gFoo`. */
export function poolLine(labels: readonly string[], operand: string): string {
  return labels.length === 0 ? `\t.4byte ${operand}` : `${labels.map((n) => `${n}:`).join(' ')} .4byte ${operand}`;
}

/** The comment a PC-relative load carries: `@ =<what the pool word prints as>`. */
export function poolLoadComment(operand: string): string {
  return `@ =${operand}`;
}
