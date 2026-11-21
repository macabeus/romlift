// The `romlift` bin's own commands on the deterministic 32 MiB synthetic ROM, under the heap cap its launcher passes
// to Node (1,024 MiB, the owner's answer to Q7, D72; Q6's answer, D69: "every ROM size up to 32 MiB must complete
// under it"; phase-3.md, fix round 4). g3.large-rom measures the bench's `init` and `generate` workflow children; the CLI's commands take their own
// paths (verify's generateFromRom, analyze's and model's NDJSON), so `bench/src/large-rom.ts --bin` runs each of
// them from source with the Node options of src/cli/main.ts's first line, and every one must exit 0 with an ok summary
// (and, after --link, the ROM's SHA-1). From phase 4 that includes the one-shot workflow (roadmap 4.E): `init` in a
// directory holding only the ROM as baserom.gba, then `generate` in the project it wrote. Their peak RSS and live heap
// are recorded in the phase records, not judged: the budget is the gate's.
//
// Needs no ROM (the image is built from the committed fixtures); missing binutils makes the test `unavailable`, or
// fails it when ROMLIFT_REQUIRE_LOCAL=1. About fifteen minutes of CPU, one command after another.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findBinutils } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const tools = findBinutils(process.env);
const unavailable = 'code' in tools ? `unavailable: ${tools.message}` : undefined;

interface Report {
  readonly schema: string;
  readonly romBytes: number;
  readonly sha1: string;
  readonly nodeOptions: readonly string[];
  readonly runs: readonly {
    readonly command: string;
    readonly exitCode: number;
    readonly maxRssMiB: number | null;
    readonly peakLiveHeapMiB: number | null;
    readonly summaryOk?: boolean;
    readonly detail: string;
  }[];
}

test(
  'the romlift bin completes every command, init and generate among them, on the 32 MiB synthetic ROM under its 1,024 MiB heap cap',
  { skip: REQUIRE ? false : (unavailable ?? false) },
  () => {
    assert.equal(unavailable, undefined, unavailable);
    const ran = spawnSync(
      process.execPath,
      ['--conditions=source', path.join(REPO, 'bench', 'src', 'large-rom.ts'), '--bin', '--json'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const last = ran.stdout.trimEnd().split('\n').at(-1) ?? '';
    const report = JSON.parse(last) as Report;
    assert.equal(report.schema, 'romlift/bench-large-rom-bin@1');
    assert.equal(report.romBytes, 32 * 1024 * 1024);
    assert.ok(
      report.nodeOptions.includes('--max-old-space-size=1024'),
      `the launcher's options: ${report.nodeOptions.join(' ')}`,
    );
    assert.deepEqual(
      report.runs.map((r) => r.command),
      ['explain', 'explain --json', 'init --json', 'generate --json', 'update --json'],
    );
    const failed = report.runs.filter((r) => r.exitCode !== 0 || r.summaryOk === false);
    assert.deepEqual(
      failed.map((r) => `${r.command}: exit ${r.exitCode}, ${r.detail}`),
      [],
    );
    assert.equal(ran.status, 0, ran.stderr.slice(-2000));
  },
);
