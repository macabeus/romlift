// The reading queries several rule families share (D56, D59): density, anchoring, filling a hole and
// frame balance. Rule files may import walk/, never each other, so the PoC's dense(), anchoredAtStart(),
// anchoredAtEnd() and popsCallersFrame() live here once.
import type { Rom } from '../../../foundation/rom/rom.ts';
import type { Addr } from '../../../foundation/rom/span.ts';
import type { CompilerProfile, ReadingSummary } from '../../profile/types.ts';
import { Claim } from '../types.ts';
import type { AnalysisView, Reading } from '../types.ts';

/** The PoC's dense(): the reading's holes stay within max(minHoles, extent >> holeShift) bytes. */
export function isDense(r: Reading, profile: CompilerProfile): boolean {
  return r.holeBytes <= Math.max(profile.density.minHoles, (r.end - r.entry) >> profile.density.holeShift);
}

/** The PoC's popsCallersFrame(): some return or tail exit pops more than the function pushed. */
export function popsCallersFrame(r: Reading): boolean {
  return r.balance.some((b) => b > 0);
}

/** The reading ends within `slack` bytes before `end` (a hole filled). */
export function fillsTo(r: Reading, end: Addr, slack: number): boolean {
  const d = end - r.end;
  return d >= 0 && d <= slack;
}

function paddingAt(v: AnalysisView, a: Addr): boolean {
  return v.claimAt(a) === Claim.free && v.profile.idioms.isPadding(v.rom, a);
}

/** The PoC's anchoredAtStart(): claimed bytes end just before the entry, give or take anchorSlack padding bytes. */
export function anchoredAtStart(entry: Addr, v: AnalysisView): boolean {
  let k = entry - 1;
  while (k >= v.rom.base && entry - k <= v.profile.anchorSlack && paddingAt(v, k)) k--;
  return k >= v.rom.base && v.claimAt(k) !== Claim.free;
}

/** The PoC's anchoredAtEnd(): a function starts just after the extent, give or take anchorSlack padding bytes. */
export function anchoredAtEnd(r: Reading, v: AnalysisView): boolean {
  let k = r.end;
  while (k < v.rom.end && k - r.end < v.profile.anchorSlack && paddingAt(v, k)) k++;
  return k < v.rom.end && v.isFunction(k);
}

/** What the far-jump idiom reads of a caller. */
export function readingSummary(r: Reading, rom: Rom, profile: CompilerProfile): ReadingSummary {
  return { entry: r.entry, mode: r.mode, codeEnd: r.codeEnd, end: r.end, prologue: profile.idioms.isPrologue(rom, r.entry, r.mode) };
}

