// The write policy (architecture §6.4 step 3, D17, D44, D62 d): turns the emission stream, the manifest,
// a digest snapshot of the disk, the reconciled files' texts and an interrupted run's journal into the ops
// the shell applies, and the manifest it writes last. Pure: the hash is injected, nothing is read.
//
//   generated   `write` when the disk differs, `keep` when it holds the same sha1. A path that exists with
//               other content is overwritten only when romlift owns it (the manifest or the journal lists
//               it) or it lies under a generated root; elsewhere E_PATH_NOT_OWNED and no op. A manifest
//               path the tree no longer has is deleted; without a manifest nothing is deleted.
//   scaffold    `write` only when absent (with its executable bits when the entry is executable), else `keep`, or a
//               `mode` op when an executable entry's file lacks its executable bits (a crash between the write and
//               the mode, or a checkout that lost them); never in the manifest.
//   reconciled  `edit` only while the file still has its baseSha1 (and its text hashes to it), else
//               E_STALE_EDIT and no op; an edit the journal shows done is a `keep`.
//   retained    a path under a `retained` prefix (a generated = false module) gets no op at all, and the
//               new manifest drops it: romlift no longer owns it, so it is never deleted later either.
//   unowned     a file under a generated root that is neither in the tree, the manifest nor the journal is
//               left in place with W_UNOWNED_FILE.
//   case rename a tree path that only the case separates from a path romlift owns (the manifest or the journal
//               lists it, the tree no longer has it: a module or function renamed by case) is the same file on a
//               case-insensitive file system, where the snapshot reads the old file for the new path. Its op is
//               always a `write`, and the old path's `delete` comes before every other op, so the delete
//               cannot remove the new file and a directory left empty is pruned before the new spelling is made.
//
// planEdits is the policy of a run that only edits (rename, phase 6): the reconciled entries alone, the manifest kept.
//
// A plan with an error diagnostic must not be applied: applyWrites (shell/project/apply-writes.ts) refuses
// it and touches nothing, and a caller sees it as `planHasErrors(plan)`. The plan still lists every op it
// could decide, so `--dry-run --json` shows the whole picture.
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { compareCodeUnits, compareNumbers, sortedKeys } from '../../foundation/util/sorted.ts';
import type { FileEntry, TextEdit, WriterId } from '../emit/tree.ts';
import { WritePlanCodes } from './codes.ts';
import type { WritePlanCode } from './codes.ts';
import type { Journal, JournalOp } from './journal.ts';
import { isProjectPath } from './manifest.ts';
import type { DiskFileState, Manifest, WriteOp, WritePlan, WritePlanInputs } from './types.ts';
import { underGeneratedRoot } from './types.ts';

/** The writer of the staleness stamp (modules.mk's ROMLIFT_TOML_SHA1, D82 a), whose write is the plan's last op. */
const STAMP_WRITER: WriterId = 'modules-mk';

type ManifestFile = Manifest['files'][string];

/** The version stamped on a manifest when neither the inputs nor the old manifest name one. */
export const UNKNOWN_ROMLIFT_VERSION = 'unknown';

/** Whether a plan holds an error diagnostic, in which case it must not be applied. */
export function planHasErrors(plan: Pick<WritePlan, 'diagnostics'>): boolean {
  return plan.diagnostics.some((d) => d.severity === 'error');
}

/**
 * `text` with `edits` applied. Offsets are UTF-16 offsets of `text`; edits must lie inside it and must not
 * overlap (two insertions at one offset apply in their given order). A violation is a bug in the planner
 * of the edits, never a property of the input.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const order = edits.map((edit, index) => ({ edit, index }));
  order.sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index);
  let out = '';
  let at = 0;
  for (const { edit } of order) {
    if (!(Number.isInteger(edit.start) && Number.isInteger(edit.end) && edit.start >= 0 && edit.start <= edit.end && edit.end <= text.length)) {
      throw new RomliftInvariantError(`text edit [${edit.start}, ${edit.end}) lies outside a ${text.length}-unit text`);
    }
    if (edit.start < at) throw new RomliftInvariantError(`text edit [${edit.start}, ${edit.end}) overlaps the previous edit, which ends at ${at}`);
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}

function underRetained(path: string, retained: readonly string[]): boolean {
  return retained.some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix));
}

/** The journal's ops by path; the last op of a path wins. */
function journalByPath(journal: Journal | null | undefined): ReadonlyMap<string, JournalOp> {
  const out = new Map<string, JournalOp>();
  for (const op of journal?.ops ?? []) out.set(op.path, op);
  return out;
}

class Planner {
  readonly ops: WriteOp[] = [];
  readonly files = new Map<string, ManifestFile>();
  readonly diagnostics: Diagnostic<WritePlanCode>[] = [];
  readonly seen = new Set<string>();
  readonly inputs: WritePlanInputs;
  readonly journal: ReadonlyMap<string, JournalOp>;
  /** The paths romlift owns (the manifest's and the journal's), by folded key. */
  readonly ownedFolds = new Map<string, string[]>();
  /** The owned paths a tree path renames by case only: deleted before every other op. */
  readonly caseRenamed = new Set<string>();

  constructor(inputs: WritePlanInputs) {
    this.inputs = inputs;
    this.journal = journalByPath(inputs.journal);
    for (const path of [...Object.keys(inputs.manifest?.files ?? {}), ...sortedKeys(this.journal)]) {
      const key = foldPath(path);
      const list = this.ownedFolds.get(key);
      if (list === undefined) this.ownedFolds.set(key, [path]);
      else if (!list.includes(path)) list.push(path);
    }
  }

  /** The owned paths other than `path` that fold to it (a case-only rename of `path`). */
  caseVariants(path: string): readonly string[] {
    return (this.ownedFolds.get(foldPath(path)) ?? []).filter((p) => p !== path);
  }

  raise(code: WritePlanCode, path: string, message: string): void {
    this.diagnostics.push(diagnostic(WritePlanCodes, code, message, { path }));
  }

  owned(path: string): boolean {
    return this.inputs.manifest?.files[path] !== undefined || this.journal.has(path);
  }

  /** What the disk holds at a tree path; the snapshot must hold every tree path. */
  diskOf(path: string): DiskFileState {
    const state = this.inputs.disk.get(path);
    if (state === undefined) throw new RomliftInvariantError(`the disk snapshot has no entry for the tree path ${path}`);
    return state;
  }

  entry(entry: FileEntry): void {
    const path = entry.path;
    if (!isProjectPath(path)) throw new RomliftInvariantError(`the tree path ${JSON.stringify(path)} is not a project path`);
    if (this.seen.has(path)) throw new RomliftInvariantError(`the tree holds ${path} twice`);
    this.seen.add(path);
    if (underRetained(path, this.inputs.retained)) return;
    switch (entry.ownership) {
      case 'generated':
        this.generated(path, entry.text, entry.writer);
        return;
      case 'scaffold':
        this.scaffold(path, entry.text, entry.writer, entry.executable === true);
        return;
      case 'reconciled':
        this.reconciled(path, entry.baseSha1, entry.edits);
        return;
    }
  }

  generated(path: string, text: string, writer: WriterId): void {
    const sha1 = this.inputs.hash(text);
    const disk = this.diskOf(path);
    const variants = this.caseVariants(path);
    if (variants.length > 0) {
      // The old spelling is deleted first (finish, plan); on a case-insensitive file system that removes this
      // file too, whatever the snapshot read for it, so it is written again.
      for (const v of variants) this.caseRenamed.add(v);
      this.ops.push({ op: 'write', path, text, sha1, writer });
    } else if (disk.kind === 'present' && disk.sha1 === sha1) {
      this.ops.push({ op: 'keep', path, sha1 });
    } else if (disk.kind === 'absent' || this.owned(path) || underGeneratedRoot(path)) {
      this.ops.push({ op: 'write', path, text, sha1, writer });
    } else {
      this.raise('E_PATH_NOT_OWNED', path, `${path} exists with other content and is not romlift's: it lies outside the generated roots and the manifest does not list it`);
      return;
    }
    this.files.set(path, { sha1, writer });
  }

  scaffold(path: string, text: string, writer: WriterId, executable: boolean): void {
    const disk = this.diskOf(path);
    if (disk.kind === 'absent') this.ops.push({ op: 'write', path, text, sha1: this.inputs.hash(text), writer, ...(executable ? { executable: true as const } : {}) });
    else if (executable && !(this.inputs.executables?.has(path) ?? false)) this.ops.push({ op: 'mode', path, executable: true });
    else this.ops.push({ op: 'keep', path, sha1: disk.sha1 });
  }

  reconciled(path: string, baseSha1: string, edits: readonly TextEdit[]): void {
    const disk = this.diskOf(path);
    const done = this.journal.get(path);
    if (done?.op === 'edit' && done.baseSha1 === baseSha1 && disk.kind === 'present' && done.resultSha1 === disk.sha1) {
      this.ops.push({ op: 'keep', path, sha1: disk.sha1 });
      return;
    }
    const text = this.inputs.reconciledTexts.get(path);
    // The disk first: an absent file is absent whether or not its text was read.
    const now: EditedFileState = disk.kind === 'absent' ? { kind: 'absent' } : text === undefined || this.inputs.hash(text) !== baseSha1 ? { kind: 'unread' } : { kind: 'sha1', sha1: disk.sha1 };
    const stale = staleEdit({ path, baseSha1 }, now, 'planned');
    if (stale !== undefined || text === undefined) {
      if (stale !== undefined) this.diagnostics.push(stale);
      return;
    }
    const result = applyTextEdits(text, edits);
    if (result === text) {
      this.ops.push({ op: 'keep', path, sha1: baseSha1 });
      return;
    }
    this.ops.push({ op: 'edit', path, baseSha1, resultSha1: this.inputs.hash(result), text: result });
  }

  /** After the stream: deletions of owned generated paths the tree dropped, and the unowned warnings. */
  finish(): void {
    const { manifest, disk, retained } = this.inputs;
    const deletable = new Set<string>(manifest === null ? [] : Object.keys(manifest.files));
    for (const path of sortedKeys(this.journal)) {
      if (this.journal.get(path)?.op !== 'edit' && underGeneratedRoot(path)) deletable.add(path);
    }
    for (const path of sortedKeys(deletable)) {
      if (this.seen.has(path) || underRetained(path, retained)) continue;
      if (disk.get(path)?.kind !== 'absent') this.ops.push({ op: 'delete', path });
      else this.caseRenamed.delete(path);
    }
    for (const path of sortedKeys(disk)) {
      if (disk.get(path)?.kind === 'absent' || !underGeneratedRoot(path) || this.seen.has(path) || deletable.has(path)) continue;
      if (underRetained(path, retained) || this.owned(path)) continue;
      const why = manifest === null ? 'there is no manifest, so nothing is deleted' : 'the manifest does not list it';
      this.raise('W_UNOWNED_FILE', path, `${path} lies under a generated root but is not in the tree; ${why}, and it is left in place`);
    }
  }

  /**
   * The plan of edits alone (planEdits): the ops by path, and the manifest as it was, since an edit is no generated
   * file and nothing else is planned.
   */
  editsPlan(): WritePlan {
    const ops = [...this.ops].sort((a, b) => compareCodeUnits(a.path, b.path));
    const manifest = this.inputs.manifest ?? { schema: 1, romlift: this.inputs.romlift ?? UNKNOWN_ROMLIFT_VERSION, files: {} };
    const diagnostics = [...this.diagnostics].sort((a, b) => compareCodeUnits(a.path ?? '', b.path ?? '') || compareCodeUnits(a.code, b.code));
    return { ops, manifest, diagnostics };
  }

  plan(): WritePlan {
    // The deletes of case-renamed paths first, then every op by path, and the write of modules.mk last (fix round 7,
    // correctness-b2-2): it records romlift.toml's SHA-1, the stamp the scaffold's Makefile and setup.sh trust as "the
    // tree is current", so a run that stops part-way (E_IO_WRITE, the write-time E_STALE_EDIT, a kill) leaves the old
    // stamp and make still asks for `romlift generate`.
    const rank = (op: WriteOp): number => (op.op === 'delete' && this.caseRenamed.has(op.path) ? 0 : op.op === 'write' && op.writer === STAMP_WRITER ? 2 : 1);
    const ops = [...this.ops].sort((a, b) => compareNumbers(rank(a), rank(b)) || compareCodeUnits(a.path, b.path));
    const files: Record<string, ManifestFile> = {};
    for (const path of sortedKeys(this.files)) {
      const file = this.files.get(path);
      if (file !== undefined) files[path] = file;
    }
    const romlift = this.inputs.romlift ?? this.inputs.manifest?.romlift ?? UNKNOWN_ROMLIFT_VERSION;
    const diagnostics = [...this.diagnostics].sort(
      (a, b) => compareCodeUnits(a.path ?? '', b.path ?? '') || compareCodeUnits(a.code, b.code),
    );
    return { ops, manifest: { schema: 1, romlift, files }, diagnostics };
  }
}

/**
 * What an edited file is now, as the staleness rule reads it: its sha1, absent, or unread (the text the plan holds
 * is not the one the edits were planned on).
 */
export type EditedFileState = { readonly kind: 'sha1'; readonly sha1: string } | { readonly kind: 'absent' } | { readonly kind: 'unread' };

/**
 * The one staleness rule of an edit (architecture §6.4, D80 b; fix round 5, architecture-b0-1): an edit is applied
 * only to the text it was planned on, so a file whose state `now` is not the edit's base sha1 is E_STALE_EDIT.
 * planWrites asks it at plan time (`when` 'planned'), and the shell's applyWrites again right before the write, over
 * the sha1 it has just read ('written'), so a save that landed since the plan is never overwritten.
 */
export function staleEdit(op: { readonly path: string; readonly baseSha1: string }, now: EditedFileState, when: 'planned' | 'written'): Diagnostic<WritePlanCode> | undefined {
  if (now.kind === 'sha1' && now.sha1 === op.baseSha1) return undefined;
  const state = now.kind === 'absent' ? 'is absent' : now.kind === 'unread' ? 'is not the text its edits were planned on' : `has sha1 ${now.sha1}`;
  const message =
    when === 'planned'
      ? `${op.path} changed since its edits were planned: it ${state}, the edits expect ${op.baseSha1}`
      : `${op.path} changed while its edits were being written: it ${state}, the edits expect ${op.baseSha1}; it is left as it is, and the next run plans again`;
  return diagnostic(WritePlanCodes, 'E_STALE_EDIT', message, { path: op.path });
}

/**
 * The write plan of one run (architecture §6.4 step 3): the ops sorted by path (the deletes of case-only renames
 * first), the manifest to write after them (sorted by path), and the diagnostics. Reads `inputs.entries` once, as a stream. An error diagnostic
 * (E_PATH_NOT_OWNED, E_STALE_EDIT) means the plan must not be applied (`planHasErrors`). Throws only
 * RomliftInvariantError, for a broken caller contract: a tree path twice, a path that is not a project
 * path, a tree path missing from the disk snapshot, or overlapping text edits.
 */
export function planWrites(inputs: WritePlanInputs): WritePlan {
  const planner = new Planner(inputs);
  for (const entry of inputs.entries) planner.entry(entry);
  planner.finish();
  return planner.plan();
}

/** What planEdits reads: reconciled entries and what planWrites reads of the directory they edit. */
export interface EditPlanInputs extends Pick<WritePlanInputs, 'manifest' | 'disk' | 'reconciledTexts' | 'hash' | 'journal' | 'romlift'> {
  readonly entries: Iterable<Extract<FileEntry, { readonly ownership: 'reconciled' }>>;
}

/**
 * The write plan of a run that only edits files (`rename`'s identifier edits, phase 6, D92): each reconciled entry by
 * the `reconciled` policy of planWrites (an `edit` while its file still has its base sha1, else E_STALE_EDIT; `keep`
 * when the edits change nothing), and nothing else: no generated path is deleted or reported, and the manifest is the
 * one on disk, unchanged (or an empty one when there is none, which a later generate reads as it reads none: it lists
 * nothing to delete). The same invariants as planWrites: a path twice, a path that is no project path or one missing
 * from the disk snapshot throws RomliftInvariantError.
 */
export function planEdits(inputs: EditPlanInputs): WritePlan {
  const planner = new Planner({ ...inputs, entries: [], retained: [] });
  for (const entry of inputs.entries) planner.entry(entry);
  return planner.editsPlan();
}
