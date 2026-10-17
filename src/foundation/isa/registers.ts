// The register effect of a decoded instruction, read from its row's RegisterSpec (types.ts) over the
// instruction's operands, so a hi register (H:R3) or a register list reads as the row's syntax names it.
import { rowOf } from './rows.ts';
import type { Insn, RegisterEffect } from './types.ts';

const NONE: RegisterEffect = { writes: 0, from: [] };

/** What `insn` writes and where the written value comes from; nothing for a row without a RegisterSpec. */
export function registerEffect(insn: Insn): RegisterEffect {
  const row = rowOf(insn.specId);
  const spec = row.spec.registers;
  if (spec === undefined) return NONE;
  const ops = row.toOps(insn.fields, insn.addr);
  let writes = spec.fixed ?? 0;
  for (const name of spec.writes ?? []) writes |= 1 << (ops[name] ?? 0);
  if (spec.list !== undefined) writes |= ops[spec.list] ?? 0;
  return { writes, from: (spec.from ?? []).map((name) => ops[name] ?? 0) };
}
