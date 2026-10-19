// The live heap of a process, from node:v8's GCProfiler (D70 d): the largest heap V8 found used after a full
// mark-compact, which is what runs into the `--max-old-space-size` cap. large-rom.ts's children and rss-probe.ts (the
// processes large-rom-bin.ts measures) both report it.

/** What GCProfiler.stop() returns, as far as peakLiveHeapOf reads it. */
export interface GcProfile {
  readonly statistics: readonly { readonly gcType: string; readonly afterGC: { readonly heapStatistics: { readonly usedHeapSize: number } } }[];
}

/** The largest used heap after a full mark-compact, in MiB to a hundredth, or null when none ran. */
export function peakLiveHeapOf(profile: GcProfile | undefined): number | null {
  const sizes = (profile?.statistics ?? []).filter((s) => s.gcType === 'MarkSweepCompact').map((s) => s.afterGC.heapStatistics.usedHeapSize);
  return sizes.length === 0 ? null : Math.round((Math.max(...sizes) / 1024 / 1024) * 100) / 100;
}
