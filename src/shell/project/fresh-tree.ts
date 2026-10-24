// Writes a model's emission stream into an empty directory as a fresh project is written (architecture §6.4
// steps 3 and 4): core/write-plan/project-plan.ts freshTreePlanInputs plans it (no manifest, every path absent, the
// non-generated modules retained), planWrites decides, applyWrites applies. What `verify --assemble/--link`
// and the bench's emission runs write their trees with. Mechanical: it hashes and writes, it decides nothing.
import type { FileEntry } from '../../core/emit/tree.ts';
import type { Model } from '../../core/model/types.ts';
import { planWrites } from '../../core/write-plan/plan-writes.ts';
import { retainedPrefixes } from '../../core/model/paths.ts';
import { freshTreePlanInputs } from '../../core/write-plan/project-plan.ts';
import { sha1Of } from '../hash.ts';
import { applyWrites } from './apply-writes.ts';
import type { ApplyResult } from './apply-writes.ts';

export interface FreshTree {
  readonly model: Model;
  /** The stream to write (generatedEntries, possibly wrapped); read once. */
  readonly entries: Iterable<FileEntry>;
  /** The stream's paths, as the check pass kept them. */
  readonly paths: readonly string[];
}

/** Plans `tree` into the empty directory `dir` and applies the plan (refused, touching nothing, when it has errors). */
export async function writeFreshTree(dir: string, tree: FreshTree): Promise<ApplyResult> {
  const plan = planWrites(freshTreePlanInputs(tree.entries, tree.paths, (text) => sha1Of(text), retainedPrefixes(tree.model)));
  return applyWrites(dir, plan);
}
