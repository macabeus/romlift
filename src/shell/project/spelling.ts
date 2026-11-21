// The spelling a write op gives its path, carried out on a case-insensitive file system (macOS and Windows by
// default). There `asm/nonmatchings/main/` already is `asm/nonmatchings/Main/`, so writing a file under the new
// spelling would leave the directory, and every file in it, under the old one; a rename onto a case variant of an
// existing file keeps the old name too. Before an op writes `path`, every component of it that exists on disk
// under another case is renamed to the op's spelling, through a temporary name. What the directory holds moves
// with it, a file romlift does not own included: on such a file system the two spellings were always one
// directory. On a case-sensitive file system the other spelling is another directory, nothing is renamed, and
// the op makes the new one. Mechanical: the plan chose the spelling (core/write-plan/plan-writes.ts).
//
// A crash between the two renames of renameCase leaves the entry under its temporary name
// (`.romlift-case-<pid>-<old name>`) and the journal of the interrupted run in place (apply-writes.ts writes it before
// the first op). The next run puts every such entry that a component of a journalled write or edit path names back
// under its old name (restoreCaseRenames), so that run's own ops make the case rename again, from the start: the
// journal records the op, and the temporary name records the old name, so no journal field is needed.
import type { Stats } from 'node:fs';
import { lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';

import type { Journal } from '../../core/write-plan/journal.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { ShellCodes } from '../codes.ts';
import { errorReason, isAbsentError, listDir } from '../fs.ts';

/** One directory's entries, by name and by folded name, as one applyWrites call has listed them. */
interface Listing {
  readonly names: Set<string>;
  readonly folded: Map<string, string>;
}

/** The listings one applyWrites call has made; cleared when a delete may have pruned a directory. */
export type Listings = Map<string, Listing>;

async function listingOf(at: string, listings: Listings): Promise<Listing | Diagnostic> {
  const known = listings.get(at);
  if (known !== undefined) return known;
  const listed = await listDir(at);
  if (!listed.ok) return listed.diagnostic;
  const listing: Listing = { names: new Set(listed.value), folded: new Map() };
  for (const name of listed.value) if (!listing.folded.has(foldPath(name))) listing.folded.set(foldPath(name), name);
  listings.set(at, listing);
  return listing;
}

async function statOf(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isAbsentError(error)) return undefined;
    throw error;
  }
}

/** Whether `a` and `b` are one directory entry (one inode on one device): two spellings of a case-insensitive name. */
async function sameEntry(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([statOf(a), statOf(b)]);
  return x !== undefined && y !== undefined && x.dev === y.dev && x.ino === y.ino;
}

const CASE_TEMPORARY_PREFIX = '.romlift-case-';
const CASE_TEMPORARY = /^\.romlift-case-\d+-(.+)$/;

/** The temporary name renameCase moves the entry `from` through: `.romlift-case-<pid>-<from>`. */
export function caseTemporaryName(from: string, pid: number = process.pid): string {
  return `${CASE_TEMPORARY_PREFIX}${pid}-${from}`;
}

/** The old name a case rename's temporary name keeps, or undefined when `name` is not such a name. */
export function caseRenameOrigin(name: string): string | undefined {
  return CASE_TEMPORARY.exec(name)?.[1];
}

/** A case rename's outcome: done, or the error and where the entry is now (its old name, or the temporary one). */
export type CaseRename = { readonly ok: true } | { readonly ok: false; readonly error: unknown; readonly at: string };

/** The one file-system call renameCase makes; a test passes a failing one. */
export type RenameFn = (from: string, to: string) => Promise<void>;

/**
 * Renames `from` to `to`, a case variant of it, through a temporary name (a direct rename may keep the old
 * name). When the second rename fails the entry is renamed back to `from`; the result names where it is.
 */
export async function renameCase(at: string, from: string, to: string, move: RenameFn = rename): Promise<CaseRename> {
  const temporary = join(at, caseTemporaryName(from));
  try {
    await move(join(at, from), temporary);
  } catch (error) {
    return { ok: false, error, at: join(at, from) };
  }
  try {
    await move(temporary, join(at, to));
    return { ok: true };
  } catch (error) {
    try {
      await move(temporary, join(at, from));
      return { ok: false, error, at: join(at, from) };
    } catch {
      return { ok: false, error, at: temporary };
    }
  }
}

/**
 * Gives every component of the project path `path` under `dir` that exists under another case the spelling
 * `path` gives it. Stops at the first component that does not exist: the write makes the rest. E_IO_WRITE when a
 * listing or a rename fails.
 */
export async function respell(dir: string, path: string, listings: Listings): Promise<Diagnostic | undefined> {
  let at = dir;
  for (const part of path.split('/')) {
    const listing = await listingOf(at, listings);
    if (!('names' in listing)) return listing;
    if (!listing.names.has(part)) {
      const other = listing.folded.get(foldPath(part));
      if (other === undefined) return undefined;
      try {
        if (!(await sameEntry(join(at, other), join(at, part)))) return undefined;
      } catch (error) {
        return diagnostic(
          ShellCodes,
          'E_IO_WRITE',
          `cannot rename ${join(at, other)} to ${part}: ${errorReason(error)}`,
          { path: join(at, other) },
        );
      }
      const renamed = await renameCase(at, other, part);
      if (!renamed.ok) {
        return diagnostic(
          ShellCodes,
          'E_IO_WRITE',
          `cannot rename ${join(at, other)} to ${part}: ${errorReason(renamed.error)}; it is at ${renamed.at}`,
          { path: renamed.at },
        );
      }
      listing.names.delete(other);
      listing.names.add(part);
      listing.folded.set(foldPath(part), part);
      listings.delete(join(at, other));
    }
    at = join(at, part);
  }
  return undefined;
}

/** The paths whose spelling an interrupted run's ops gave (respell runs for writes and edits only). */
function respelledPaths(journal: Journal): string[] {
  return journal.ops.filter((op) => op.op === 'write' || op.op === 'edit').map((op) => op.path);
}

/**
 * Finishes the case renames an interrupted run left half done (architecture-r2-4): below `dir`, every entry under a
 * renameCase temporary name whose old name folds to a component of a write or edit path of `journal` is renamed back
 * to that old name, where the interrupted op found it; the next op on that path renames it to its new spelling again
 * (respell). An entry is put back only when its directory holds nothing under a name that folds to it, so nothing is
 * overwritten; an entry no journalled path names is left alone. Walks only directories that exist; E_IO_WRITE when a
 * listing or a rename fails. Idempotent: a second call finds nothing to do.
 */
export async function restoreCaseRenames(dir: string, journal: Journal): Promise<Diagnostic | undefined> {
  const listings = new Map<string, string[]>();
  const listingAt = async (at: string): Promise<string[] | Diagnostic> => {
    const known = listings.get(at);
    if (known !== undefined) return known;
    const listed = await listDir(at);
    if (!listed.ok) return listed.diagnostic;
    const names = [...listed.value];
    listings.set(at, names);
    return names;
  };
  for (const path of respelledPaths(journal)) {
    const parts = path.split('/');
    let at = dir;
    for (const [i, part] of parts.entries()) {
      const names = await listingAt(at);
      if (!Array.isArray(names)) return names;
      const key = foldPath(part);
      const present = (): string | undefined => names.find((n) => n === part) ?? names.find((n) => foldPath(n) === key);
      if (present() === undefined) {
        const stranded = names.find((n) => {
          const origin = caseRenameOrigin(n);
          return origin !== undefined && foldPath(origin) === key;
        });
        const origin = stranded === undefined ? undefined : caseRenameOrigin(stranded);
        if (stranded !== undefined && origin !== undefined) {
          try {
            await rename(join(at, stranded), join(at, origin));
          } catch (error) {
            return diagnostic(
              ShellCodes,
              'E_IO_WRITE',
              `cannot rename ${join(at, stranded)} back to ${origin}: ${errorReason(error)}`,
              { path: join(at, stranded) },
            );
          }
          names.splice(names.indexOf(stranded), 1, origin);
          listings.delete(join(at, stranded));
        }
      }
      const entry = present();
      if (entry === undefined || i === parts.length - 1) break;
      let stats: Stats | undefined;
      try {
        stats = await statOf(join(at, entry));
      } catch (error) {
        return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot stat ${join(at, entry)}: ${errorReason(error)}`, {
          path: join(at, entry),
        });
      }
      if (stats === undefined || !stats.isDirectory()) break;
      at = join(at, entry);
    }
  }
  return undefined;
}
