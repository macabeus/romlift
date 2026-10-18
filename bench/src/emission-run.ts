// The emission workflows the bench measures (architecture §6.4, §9.3, §9.4, D41, D42): `generate` (the confirm
// analysis over a config built beforehand, the model, the check pass, then planWrites and applyWrites of the tree
// into a directory) and its `init` equivalent (the discover analysis and configFromDiscover first). As `generate`
// does, the tree is written only when the check pass is ok and nothing raised an error (§6.4 step 2); otherwise the
// outcome says why and nothing is written. The tree digest is the sha256 over path, NUL, text, NUL of every entry in
// stream order (g3.tree-determinism's), hashed while planWrites reads the stream, so no tree is held for it.
import { createHash } from 'node:crypto';

import { configFromDiscover, discover, generate, modulePathPrefixes, planWrites, type FileEntry, type Rom, type RomliftConfig } from 'romlift';
import { applyWrites, sha1Of } from 'romlift/node';

/** What one emission run did. */
export interface EmissionOutcome {
  /** The check pass was ok, nothing raised an error, and the tree was written. */
  readonly ok: boolean;
  /** Why it is not ok: a failed check (exit 3 in the CLI), an error diagnostic, or the write (exit 1). */
  readonly failure?: 'check' | 'error' | 'write';
  /** The first failure, or what was written. */
  readonly detail: string;
  /** The files of the stream. */
  readonly files: number;
  /** sha256 over path NUL text NUL in stream order; absent when nothing was written. */
  readonly treeDigest?: string;
}

/** How the bench reaches the emission workflows; tests inject a fake (the real one is ROMLIFT_EMISSION). */
export interface EmissionRunner {
  /** The config `generate` starts from: configFromDiscover over the discover analysis. */
  prepare(rom: Rom): RomliftConfig;
  /** `generate` with `config`, then planWrites and applyWrites into the empty directory `dir`. */
  generate(rom: Rom, config: RomliftConfig, dir: string): Promise<EmissionOutcome>;
  /** The `init` equivalent: the discover analysis, configFromDiscover, then `generate` into the empty directory `dir`. */
  init(rom: Rom, dir: string): Promise<EmissionOutcome>;
}

/** `entries` unchanged, each one hashed into `hash` as it passes (path NUL text NUL). */
function* hashing(entries: Iterable<FileEntry>, hash: ReturnType<typeof createHash>): Generator<FileEntry> {
  for (const entry of entries) {
    hash.update(entry.path).update('\0').update('text' in entry ? entry.text : JSON.stringify(entry.edits)).update('\0');
    yield entry;
  }
}

/** The config of a ROM as `init` would write it: configFromDiscover over its discover analysis. */
export function configOf(rom: Rom): RomliftConfig {
  return configFromDiscover(rom, discover(rom));
}

/** generate over `config`, and when its check pass is clean, the tree written into the empty directory `dir`. */
export async function generateInto(rom: Rom, config: RomliftConfig, dir: string): Promise<EmissionOutcome> {
  const result = generate({ rom, config, decomp: { defined: new Set() }, printer: 'readable' });
  const files = result.paths.length;
  const failed = result.report.checks.find((c) => !c.ok);
  if (failed !== undefined) return { ok: false, failure: 'check', detail: `the ${failed.id} check failed: ${failed.detail}; nothing written`, files };
  const error = result.diagnostics.find((d) => d.severity === 'error');
  if (error !== undefined) return { ok: false, failure: 'error', detail: `${error.code}: ${error.message}; nothing written`, files };
  const { model } = result;
  const hash = createHash('sha256');
  const plan = planWrites({
    entries: hashing(result.entries(), hash),
    manifest: null,
    disk: new Map(result.paths.map((p) => [p, 'absent'] as const)),
    reconciledTexts: new Map(),
    hash: sha1Of,
    retained: model.modules.filter((m) => !m.generated).flatMap((m) => modulePathPrefixes(model, m)),
  });
  const treeDigest = hash.digest('hex');
  const applied = await applyWrites(dir, plan);
  if (!applied.ok) return { ok: false, failure: 'write', detail: applied.diagnostics.map((d) => d.message).join('; '), files };
  return { ok: true, detail: `${applied.applied} files written`, files, treeDigest };
}

/** romlift's own emission workflows. */
export const ROMLIFT_EMISSION: EmissionRunner = {
  prepare: configOf,
  generate: generateInto,
  init: (rom, dir) => generateInto(rom, configOf(rom), dir),
};
