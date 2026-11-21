// A preload (`node --import <this file>`) for the processes bench/src/large-rom-bin.ts measures: when the process exits
// normally it writes its peak resident set and its peak live heap (live-heap.ts: the largest heap V8 found used after
// a full mark-compact, `-` when none ran) to stderr as its two last lines, `romlift-bench-rss <maxRSS KiB>` and
// `romlift-bench-live-heap <MiB>`. A process V8 aborts (out of memory) writes neither, and its run reports no RSS and
// no live heap. The probe's GCProfiler only listens to the collections V8 runs; nothing else changes in the process.
import { GCProfiler } from 'node:v8';

import { peakLiveHeapOf } from './live-heap.ts';

const profiler = new GCProfiler();
profiler.start();
process.on('exit', () => {
  const live = peakLiveHeapOf(profiler.stop());
  process.stderr.write(
    `\nromlift-bench-rss ${process.resourceUsage().maxRSS}\nromlift-bench-live-heap ${live === null ? '-' : live.toFixed(2)}\n`,
  );
});
