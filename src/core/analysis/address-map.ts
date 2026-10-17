// Load and run addresses (architecture §3.3, D46). A byte's load address is where it sits in the ROM;
// its run address is where the CPU executes it. They differ only inside an override with `runsAt`.
// Phase 2 builds the identity: no override sets runsAt yet; phase 6 fills the ranges.
import { ROM_BASE, ROM_MAX_SIZE } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import type { OverrideFact } from './types.ts';

export interface AddressMap {
  /** Sorted, disjoint load ranges with the run address of their first byte. */
  readonly ranges: readonly { readonly load: Span; readonly run: Addr }[];
}

/** The address map of the overrides; the identity when none sets runsAt (all of phase 2). */
export function addressMap(overrides: readonly OverrideFact[]): AddressMap {
  void overrides;
  return { ranges: [] };
}

/** The run address of a load address. */
export function toRun(m: AddressMap, load: Addr): Addr {
  for (const r of m.ranges) if (load >= r.load.start && load < r.load.end) return r.run + (load - r.load.start);
  return load;
}

/** The load address of a run address; undefined when no cartridge byte runs there (a RAM reference). */
export function toLoad(m: AddressMap, run: Addr): Addr | undefined {
  for (const r of m.ranges) {
    const length = r.load.end - r.load.start;
    if (run >= r.run && run < r.run + length) return r.load.start + (run - r.run);
  }
  return run >= ROM_BASE && run < ROM_BASE + ROM_MAX_SIZE ? run : undefined;
}
