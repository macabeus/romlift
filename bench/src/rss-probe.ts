// A preload (`node --import <this file>`) for the processes bench/src/large-rom-bin.ts measures: when the process exits
// normally it writes its peak resident set to stderr as one last line, `romlift-bench-rss <maxRSS KiB>`. A process V8
// aborts (out of memory) writes nothing, and its run reports no RSS. Nothing else changes in the process.
process.on('exit', () => {
  process.stderr.write(`\nromlift-bench-rss ${process.resourceUsage().maxRSS}\n`);
});
