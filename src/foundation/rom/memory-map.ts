// The GBA address space as data (GBATEK "Memory Map"): one entry per region, with lookups.
import type { Addr } from './span.ts';

export type MemoryRegionName = 'bios' | 'ewram' | 'iwram' | 'io' | 'palette' | 'vram' | 'oam' | 'rom' | 'sram';

/** What a region holds: work RAM is where game variables and RAM-run code live. */
export type MemoryRegionKind = 'bios' | 'work-ram' | 'io' | 'video' | 'rom' | 'save';

export interface MemoryRegion {
  readonly name: MemoryRegionName;
  readonly kind: MemoryRegionKind;
  /** First bus address. */
  readonly start: Addr;
  /** Size in bytes; the region is the half-open range [start, start + size). */
  readonly size: number;
}

/** The regions in address order. `rom` covers the three wait-state mirrors (0x08, 0x0A, 0x0C). */
export const MEMORY_REGIONS: readonly MemoryRegion[] = [
  { name: 'bios', kind: 'bios', start: 0x0000_0000, size: 0x4000 },
  { name: 'ewram', kind: 'work-ram', start: 0x0200_0000, size: 0x4_0000 },
  { name: 'iwram', kind: 'work-ram', start: 0x0300_0000, size: 0x8000 },
  { name: 'io', kind: 'io', start: 0x0400_0000, size: 0x400 },
  { name: 'palette', kind: 'video', start: 0x0500_0000, size: 0x400 },
  { name: 'vram', kind: 'video', start: 0x0600_0000, size: 0x1_8000 },
  { name: 'oam', kind: 'video', start: 0x0700_0000, size: 0x400 },
  { name: 'rom', kind: 'rom', start: 0x0800_0000, size: 0x0600_0000 },
  { name: 'sram', kind: 'save', start: 0x0e00_0000, size: 0x1_0000 },
];

/** The region containing `addr`, or undefined for an unmapped address. */
export function regionOf(addr: Addr): MemoryRegion | undefined {
  for (const region of MEMORY_REGIONS) {
    if (addr >= region.start && addr < region.start + region.size) return region;
  }
  return undefined;
}

/** Whether `addr` lies in cartridge ROM or one of its wait-state mirrors. */
export function isRomAddress(addr: Addr): boolean {
  return regionOf(addr)?.kind === 'rom';
}

/**
 * Whether `addr` lies in the top 0x100 bytes of IWRAM, [0x03007F00, 0x03008000), which the BIOS owns (GBATEK "BIOS RAM
 * Usage"): the default user stack's top (0x03007F00), the IRQ and supervisor stacks below 0x03007FA0 and 0x03007FE0,
 * and the BIOS's words at 0x03007FF0 to 0x03007FFF (the sound info pointer, the IRQ check flags, the soft-reset flag
 * and the IRQ vector). C reaches them through constants (`gba/defines.h`'s `INTR_CHECK`, `INTR_VECTOR`,
 * `SOUND_INFO_PTR`), never through a variable.
 */
export function isBiosIwram(addr: Addr): boolean {
  return addr >= 0x0300_7f00 && addr < 0x0300_8000;
}

/** Whether `addr` lies in work RAM (EWRAM or IWRAM). */
export function isRamAddress(addr: Addr): boolean {
  return regionOf(addr)?.kind === 'work-ram';
}
