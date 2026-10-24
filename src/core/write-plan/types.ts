// The write plan's data (architecture §3.4, §6.4, D17, D44, D62): what planWrites (plan-writes.ts) reads
// and returns, the manifest and journal it shares with the shell, and the project paths romlift owns.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { FileEntry, WriterId } from '../emit/tree.ts';
import type { Journal } from './journal.ts';

/** `.romlift/manifest.json`: every generated path romlift wrote, with its sha1 and writer. */
export interface Manifest {
  readonly schema: 1;
  /** The romlift version that wrote it. */
  readonly romlift: string;
  /** Keyed by project path. */
  readonly files: Readonly<Record<string, { readonly sha1: string; readonly writer: WriterId }>>;
}

export type WriteOp =
  | { readonly op: 'write'; readonly path: string; readonly text: string; readonly sha1: string; readonly writer: WriterId; readonly executable?: true }
  /** A scaffold file that must be executable (setup.sh) and is not on disk: its executable bits are set. */
  | { readonly op: 'mode'; readonly path: string; readonly executable: true }
  | { readonly op: 'edit'; readonly path: string; readonly baseSha1: string; readonly resultSha1: string; readonly text: string }
  | { readonly op: 'delete'; readonly path: string }
  | { readonly op: 'keep'; readonly path: string; readonly sha1: string };

export interface WritePlanInputs {
  /** The emission stream, consumed once. */
  readonly entries: Iterable<FileEntry>;
  readonly manifest: Manifest | null;
  /** The sha1 of every path under the generated roots and of every tree path, or 'absent'. */
  readonly disk: ReadonlyMap<string, string | 'absent'>;
  /** The current text of each reconciled file. */
  readonly reconciledTexts: ReadonlyMap<string, string>;
  /** sha1 of a text, injected by the shell (D44). */
  readonly hash: (text: string) => string;
  /**
   * The path prefixes of the generated = false modules (e.g. 'asm/nonmatchings/m4a/', 'asm/m4a.s'): a path
   * under one is never written and never deleted, whatever the manifest says (D62).
   */
  readonly retained: readonly string[];
  /**
   * The journal an interrupted run left (`.romlift/journal.json`), or null/absent when there is none. Its
   * paths count as owned, and a reconciled edit it lists whose file already has the edit's result sha1 is
   * done (§6.4 step 4). Added by p3-write-plan: the policy is planWrites', so the journal is an input.
   */
  readonly journal?: Journal | null;
  /** The romlift version stamped on the new manifest; default the old manifest's, else 'unknown'. */
  readonly romlift?: string;
  /**
   * The tree paths of executable scaffold entries whose file on disk has the executable bits; such an entry whose
   * file exists without them gets a `mode` op. Default: none.
   */
  readonly executables?: ReadonlySet<string>;
}

export interface WritePlan {
  readonly ops: readonly WriteOp[];
  /** The manifest to write last, after every op (§6.4 step 4). */
  readonly manifest: Manifest;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The tool-owned roots (§6.4): a path absent from the manifest that exists on disk with other content is
 * overwritten only under one of them. A root ending in '/' is a directory; the others are files.
 */
export const GENERATED_ROOTS: readonly string[] = ['asm/', 'data/', 'expected/', 'ldscript.txt', 'symbols.ld', 'modules.mk', 'objdiff.json'];

/** romlift's own state directory in a project (gitignored). */
export const ROMLIFT_DIR = '.romlift';
export const MANIFEST_PATH = '.romlift/manifest.json';
export const JOURNAL_PATH = '.romlift/journal.json';
/** Taken with O_EXCL by the shell; holds the pid and host (§6.4). */
export const LOCK_PATH = '.romlift/lock';

/** Whether `path` lies under one of GENERATED_ROOTS. */
export function underGeneratedRoot(path: string): boolean {
  return GENERATED_ROOTS.some((root) => (root.endsWith('/') ? path.startsWith(root) : path === root));
}
