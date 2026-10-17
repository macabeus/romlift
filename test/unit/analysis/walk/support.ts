// Shared builders for the walk rule tests (not a test file): the registered walk slot of agbcc, the slot
// without one rule (to show what the rule decides), decoded instructions at an address, and a cursor
// for asking one rule directly.
import { decode } from '../../../../src/foundation/isa/decode.ts';
import type { Insn } from '../../../../src/foundation/isa/types.ts';
import { contains, u16, u32 } from '../../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../src/foundation/rom/span.ts';
import type { RuleId } from '../../../../src/core/provenance/rule-id.ts';
import { WALK_RULES } from '../../../../src/core/analysis/rules/walk/index.ts';
import type { AnalysisView, WalkPolicy } from '../../../../src/core/analysis/types.ts';
import type { ResolvedPolicy, WalkCursor } from '../../../../src/core/analysis/walk/cursor.ts';
import { registeredWalk } from '../../../helpers/analysis.ts';

/** agbcc's walk slot, resolved from RULES. */
export const WALK: readonly ResolvedPolicy[] = registeredWalk();

/** The walk slot without `id`. */
export function without(id: RuleId): readonly ResolvedPolicy[] {
  return WALK.filter((p) => p.id !== id);
}

/** The registered walk rule `id`. */
export function walkRule(id: keyof typeof WALK_RULES): WalkPolicy {
  return WALK_RULES[id];
}

/** The instruction at `a`, decoded as the walker decodes it (no runs_at range in these tests). */
export function insnAt(rom: Rom, a: Addr, mode: Mode): Insn {
  if (mode === 'arm') return decode('arm', u32(rom, a), a);
  const word = (u16(rom, a) | (contains(rom, a + 2, 2) ? u16(rom, a + 2) << 16 : 0)) >>> 0;
  return decode('thumb', word, a);
}

/** A cursor for asking a rule directly; phase 'insn' at the entry unless `over` says otherwise. */
export function cursorOf(view: AnalysisView, over: Partial<WalkCursor> & { readonly entry: Addr; readonly mode: Mode }): WalkCursor {
  return { view, phase: 'insn', stop: undefined, at: over.entry, sp: 0, run: [], conditional: false, walked: () => false, ...over };
}
