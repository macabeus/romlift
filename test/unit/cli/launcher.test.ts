// The built `romlift` bin's launcher (correctness-r0-2, D68 b, D69, D72): the heap cap reaches a user only through
// the first line of dist/cli/main.js, the file package.json's `bin` names. The build of `npm run build` (`tsc -p
// tsconfig.build.json`) is run into a temporary outDir, never the repository's dist/, and the built entry's first
// line must be exactly the launcher, so a build that drops or changes it fails here. A platform whose `env` lacks
// `-S` cannot start the bin (a known limitation, phase-4.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LAUNCHER = '#!/usr/bin/env -S node --max-old-space-size=1024';

test(
  'the built bin starts Node with the 1,024 MiB heap cap: the first line of cli/main.js is the launcher',
  { timeout: 300_000 },
  () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      readonly bin?: Readonly<Record<string, string>>;
    };
    assert.equal(pkg.bin?.['romlift'], './dist/cli/main.js', 'the bin is the build of src/cli/main.ts');
    const outDir = mkdtempSync(join(tmpdir(), 'romlift-launcher-'));
    try {
      const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
      const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', outDir], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 280_000,
      });
      assert.equal(build.status, 0, `${build.stdout}${build.stderr}`);
      const built = readFileSync(join(outDir, 'cli', 'main.js'), 'utf8');
      assert.equal(built.split('\n')[0], LAUNCHER);
      assert.equal(
        readFileSync(join(ROOT, 'src', 'cli', 'main.ts'), 'utf8').split('\n')[0],
        LAUNCHER,
        'the source carries the same line',
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  },
);
