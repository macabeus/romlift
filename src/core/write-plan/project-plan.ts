// The write plan of a tree into a directory (architecture §6.4 steps 3 and 4, D17, D75 k): what the shell read of the
// directory (ProjectWriteState) turned into planWrites' inputs, for a project (projectPlanInputs) or for an empty
// directory (freshTreePlanInputs), and whether a plan would change anything at all (planChangesNothing), which decides
// whether the shell applies it. Pure: the hash is injected; the retained prefixes (the files of the modules romlift
// does not generate) come from the model (core/model/paths.ts retainedPrefixes).
import type { FileEntry } from '../emit/tree.ts';
import type { Journal } from './journal.ts';
import { encodeManifest } from './manifest.ts';
import type { DiskFileState, Manifest, WritePlan, WritePlanInputs } from './types.ts';

/** What the shell read of the directory a tree is written into, for planWrites (§6.4 step 3). */
export interface ProjectWriteState {
  readonly manifest: Manifest | null;
  readonly journal: Journal | null;
  /** What is on disk at every tree path, manifest path and file under the generated roots (WritePlanInputs.disk). */
  readonly disk: ReadonlyMap<string, DiskFileState>;
  readonly reconciledTexts: ReadonlyMap<string, string>;
  /** The tree paths of executable scaffold entries whose file has its executable bits (WritePlanInputs.executables). */
  readonly executables?: ReadonlySet<string>;
}

/** The planWrites inputs of writing `entries` (a model's stream, plus any scaffold entries) over `state`. */
export function projectPlanInputs(entries: Iterable<FileEntry>, state: ProjectWriteState, hash: (text: string) => string, romlift: string, retained: readonly string[]): WritePlanInputs {
  return {
    entries,
    manifest: state.manifest,
    disk: state.disk,
    reconciledTexts: state.reconciledTexts,
    hash,
    retained,
    journal: state.journal,
    romlift,
    ...(state.executables === undefined ? {} : { executables: state.executables }),
  };
}

/**
 * The planWrites inputs of writing `entries` (whose paths are `paths`) into an empty directory, as a fresh project is
 * written: no manifest, every path absent on disk, no reconciled text, and `retained` left alone.
 */
export function freshTreePlanInputs(entries: Iterable<FileEntry>, paths: readonly string[], hash: (text: string) => string, retained: readonly string[]): WritePlanInputs {
  return {
    entries,
    manifest: null,
    disk: new Map<string, DiskFileState>(paths.map((p) => [p, { kind: 'absent' }])),
    reconciledTexts: new Map(),
    hash,
    retained,
  };
}

function manifestText(manifest: Manifest): string {
  return [...encodeManifest(manifest)].join('');
}

/**
 * Whether applying `plan` would change nothing on disk: every op is a keep, no interrupted run's journal is left,
 * and the manifest it would write is the one already there. The shell then skips the apply step, so `generate`
 * right after `init` leaves every file, the manifest included, with its modification time (g4.generate-idempotent).
 */
export function planChangesNothing(plan: Pick<WritePlan, 'ops' | 'manifest'>, state: Pick<ProjectWriteState, 'manifest' | 'journal'>): boolean {
  if (state.journal !== null || state.manifest === null) return false;
  if (!plan.ops.every((op) => op.op === 'keep')) return false;
  return manifestText(plan.manifest) === manifestText(state.manifest);
}
