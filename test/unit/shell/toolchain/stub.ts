// Stub arm-none-eabi-{as,ld,objcopy} for tests of a broken toolchain: each prints a version line for
// `--version` and otherwise runs the given shell body (default `exit 0`), so a test can make a tool
// that exits 0 without writing its output file.
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type StubBodies = Partial<Record<'as' | 'ld' | 'objcopy', string>>;

/** Runs `fn` with a directory holding the three stub programs, removed afterwards. */
export async function stubBinutils(bodies: StubBodies, fn: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-stub-'));
  try {
    for (const tool of ['as', 'ld', 'objcopy'] as const) {
      const file = path.join(dir, `arm-none-eabi-${tool}`);
      const body = bodies[tool] ?? 'exit 0';
      await writeFile(
        file,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "GNU ${tool} (stub) 0.0"; exit 0; fi\n${body}\n`,
      );
      await chmod(file, 0o755);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
