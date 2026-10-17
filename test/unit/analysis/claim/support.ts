// Shared helpers for the claim rule tests (not a test file): accept one entry through the driver with the
// registered walk, bl and claim rules, and read back the claim of each byte of a span.
import type { Addr, Mode } from '../../../../src/foundation/rom/span.ts';
import { accept } from '../../../../src/core/analysis/driver/accept.ts';
import type { DriverState } from '../../../../src/core/analysis/driver/state.ts';
import type { ClaimKind, FunctionFact, Reading } from '../../../../src/core/analysis/types.ts';

/** Accepts `entry` as a listed seed would be. */
export function take(s: DriverState, entry: Addr, mode: Mode = 'thumb'): void {
  accept(s, { entry, mode, proposedBy: 'seed.listed', cites: [] });
}

/** The claim of every byte of [start, end). */
export function claimsOf(s: DriverState, start: Addr, end: Addr): readonly ClaimKind[] {
  const out: ClaimKind[] = [];
  for (let a = start; a < end; a++) out.push(s.view.claimAt(a));
  return out;
}

/** `n` copies of `kind`. */
export function run(kind: ClaimKind, n: number): readonly ClaimKind[] {
  return Array.from({ length: n }, () => kind);
}

/** The FunctionFact a driver would build for `r` accepted on its own (claim rules read `r`, not the fact). */
export function factOf(r: Reading): FunctionFact {
  return {
    entry: r.entry,
    mode: r.mode,
    extent: { start: r.entry, end: r.end },
    codeEnd: r.codeEnd,
    code: r.insns.map((i) => ({ start: i.addr, end: i.addr + i.len })),
    dead: [],
    pools: [],
    farPools: [],
    tables: r.tables,
    calls: r.calls,
    blVerdicts: r.blVerdicts,
    exits: r.exits,
    branchTargets: r.branchTargets,
    adrs: r.adrs,
    veneers: r.veneers,
    absorbed: [],
    holes: r.holes,
    origin: 'listed',
    accepted: { rule: 'seed.listed', round: 0, cites: [] },
    also: [],
  };
}
