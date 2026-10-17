// A child process for test/unit/analysis/pointer-flood-rom.test.ts (not a test file): builds a 32 MiB
// cartridge image whose last FLOOD_MIB MiB (argv[2]) are Thumb pointers into themselves, scattered by a
// fixed stride, so every word is a harvest candidate whose reading wanders over the flood. It analyses
// the image under the heap limit the parent gives and prints one JSON line: the functions found, the
// diagnostic codes, the rejections and the peak resident set in MiB.
import { analyze } from '../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../src/core/profile/agbcc.ts';
import { romWith } from './analysis.ts';
import { armAt } from './arm.ts';

const SIZE = 32 * 1024 * 1024;
const BASE = 0x0800_0000;
const floodBytes = Number(process.argv[2] ?? '28') * 1024 * 1024;
const start = BASE + SIZE - floodBytes;
const n = floodBytes / 4;
const flood = new Uint8Array(floodBytes);
const view = new DataView(flood.buffer);
for (let i = 0; i < n; i++) view.setUint32(4 * i, (start + 4 * ((i * 7919) % n) + 1) >>> 0, true);
const rom = romWith(
  [
    { at: BASE + 0xc0, bytes: armAt(BASE + 0xc0)`bx lr` },
    { at: start, bytes: flood },
  ],
  { size: SIZE, entry: BASE + 0xc0 },
);
const result = analyze(rom, AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
process.stdout.write(
  `${JSON.stringify({
    functions: result.functions.length,
    diagnostics: result.diagnostics.map((d) => d.code),
    rejections: result.rejections.length,
    rssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  })}\n`,
);
