// The seeds a run starts from (architecture §4.2, D12, D59 r): they come from the project's TOML or from
// evidence, never from the ROM, so the driver checks their shape before round 0. A seed whose entry is not
// a safe integer, whose mode is neither 'thumb' nor 'arm', or whose size is not a positive integer that
// fits the ROM from its entry is left out with W_SEED_MALFORMED; it would otherwise make a walk or an
// extent of nothing (an entry of NaN, a negative or a 64 MiB size). An entry outside the ROM, odd, or
// listed twice is well formed: validity judges it (W_LISTED_INVALID).
import { diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { contains } from '../../../foundation/rom/rom.ts';
import type { Rom } from '../../../foundation/rom/rom.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { AnalysisCodes } from '../codes.ts';
import type { AnalysisCode } from '../codes.ts';
import type { Seed } from '../types.ts';

/** Why a seed is malformed, or undefined when it is well formed. */
export function seedProblem(rom: Rom, seed: Seed): string | undefined {
  if (!Number.isSafeInteger(seed.entry) || seed.entry < 0) return `its entry ${String(seed.entry)} is not an address`;
  if (seed.mode !== 'thumb' && seed.mode !== 'arm') return `its mode ${String(seed.mode)} is neither thumb nor arm`;
  if (seed.size === undefined) return undefined;
  if (!Number.isSafeInteger(seed.size) || seed.size <= 0) return `its size ${String(seed.size)} is not a positive integer`;
  const fits = contains(rom, seed.entry) ? contains(rom, seed.entry, seed.size) : seed.size <= rom.bytes.length;
  return fits ? undefined : `its size ${seed.size} runs past the end of the ROM`;
}

/** The well-formed seeds, in their order, and a W_SEED_MALFORMED for each one left out. */
export function wellFormedSeeds(rom: Rom, seeds: readonly Seed[]): { readonly seeds: readonly Seed[]; readonly diagnostics: readonly Diagnostic<AnalysisCode>[] } {
  const kept: Seed[] = [];
  const diagnostics: Diagnostic<AnalysisCode>[] = [];
  for (const seed of seeds) {
    const problem = seedProblem(rom, seed);
    if (problem === undefined) {
      kept.push(seed);
      continue;
    }
    const at = Number.isSafeInteger(seed.entry) && seed.entry >= 0 ? hexAddr(seed.entry) : String(seed.entry);
    diagnostics.push(
      diagnostic(AnalysisCodes, 'W_SEED_MALFORMED', `the ${seed.rule} seed at ${at} is left out: ${problem}`, {
        ...(Number.isSafeInteger(seed.entry) && seed.entry >= 0 ? { addr: seed.entry } : {}),
        rule: seed.rule,
      }),
    );
  }
  return { seeds: kept, diagnostics };
}
