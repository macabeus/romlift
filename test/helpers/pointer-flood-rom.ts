// A child process for test/local/pointer-flood.test.ts (not a test file). It builds a cartridge image
// whose last FLOOD_MIB MiB (argv[2]) are Thumb pointers into themselves, scattered by a fixed stride, so
// every word is a harvest candidate whose reading wanders over the flood. Without argv[3] the image is
// 32 MiB with one ARM function before the flood; with argv[3] (a ROM path) the flood is appended to that
// ROM. It analyses the image under the heap limit the parent gives and prints one JSON line: the
// functions found, the diagnostic codes, the rejections, the grow rounds, the seconds and the peak
// resident set in MiB.
import { readFileSync } from 'node:fs';

import { analyze } from '../../src/core/analysis/driver/run.ts';
import { AGBCC } from '../../src/core/profile/agbcc.ts';
import { romFromBytes } from '../../src/foundation/rom/rom.ts';
import type { Rom } from '../../src/foundation/rom/rom.ts';
import { romWith } from './analysis.ts';
import { armAt } from './arm.ts';

const SIZE = 32 * 1024 * 1024;
const BASE = 0x0800_0000;
const floodBytes = Number(process.argv[2] ?? '28') * 1024 * 1024;
const basePath = process.argv[3];

function flood(start: number): Uint8Array {
  const n = floodBytes / 4;
  const bytes = new Uint8Array(floodBytes);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) view.setUint32(4 * i, (start + 4 * ((i * 7919) % n) + 1) >>> 0, true);
  return bytes;
}

function image(): Rom {
  if (basePath === undefined) {
    const start = BASE + SIZE - floodBytes;
    return romWith(
      [
        { at: BASE + 0xc0, bytes: armAt(BASE + 0xc0)`bx lr` },
        { at: start, bytes: flood(start) },
      ],
      { size: SIZE, entry: BASE + 0xc0 },
    );
  }
  const base = readFileSync(basePath);
  const length = Math.ceil(base.length / 4) * 4;
  const bytes = new Uint8Array(length + floodBytes);
  bytes.set(base);
  bytes.set(flood(BASE + length), length);
  return romFromBytes(bytes, 'flood');
}

const rom = image();
const started = process.hrtime.bigint();
const result = analyze(rom, AGBCC, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
const seconds = Number(process.hrtime.bigint() - started) / 1e9;
process.stdout.write(
  `${JSON.stringify({
    functions: result.functions.length,
    diagnostics: result.diagnostics.map((d) => d.code),
    rejections: result.rejections.length,
    seconds: Math.round(seconds * 10) / 10,
    rssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  })}\n`,
);
