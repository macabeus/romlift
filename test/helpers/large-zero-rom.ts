// A child process for test/unit/analysis/large-zero-rom.test.ts (not a test file): builds a 32 MiB
// cartridge image that is mostly zeros, with Thumb pointers into the zeros and into a 1 MiB run of
// never-branching Thumb data, analyses it under the heap limit the parent gives, and prints one JSON
// line: the functions found, the diagnostic codes and the peak resident set in MiB.
import { analyze } from '../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../src/core/profile/agbcc.ts';
import { romWith, words } from './analysis.ts';
import { armAt } from './arm.ts';

const SIZE = 32 * 1024 * 1024;
const BASE = 0x0800_0000;
const DATA = BASE + 0x0040_0000;
const zeroTargets = Array.from({ length: 32 }, (_, i) => BASE + 0x0100_0000 + i * 0x4_0000 + 1);
const dataTargets = Array.from({ length: 8 }, (_, i) => DATA + i * 0x2_0000 + 1);
const run = new Uint8Array(0x10_0000);
for (let k = 0; k < run.length; k += 2) run[k] = 0x32; // lsls r2, r6, #0
const rom = romWith(
  [
    { at: BASE + 0xc0, bytes: armAt(BASE + 0xc0)`bx lr` },
    { at: BASE + 0x100, bytes: words(...zeroTargets, ...dataTargets) },
    { at: DATA, bytes: run },
  ],
  { size: SIZE, entry: BASE + 0xc0 },
);
const result = analyze(rom, AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
process.stdout.write(
  `${JSON.stringify({
    functions: result.functions.length,
    diagnostics: result.diagnostics.map((d) => d.code),
    rssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  })}\n`,
);
