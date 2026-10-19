// The spelling a write op gives its path, carried out on a case-insensitive file system (macOS and Windows by
// default). There `asm/nonmatchings/main/` already is `asm/nonmatchings/Main/`, so writing a file under the new
// spelling would leave the directory, and every file in it, under the old one; a rename onto a case variant of an
// existing file keeps the old name too. Before an op writes `path`, every component of it that exists on disk
// under another case is renamed to the op's spelling, through a temporary name. What the directory holds moves
// with it, a file romlift does not own included: on such a file system the two spellings were always one
// directory. On a case-sensitive file system the other spelling is another directory, nothing is renamed, and
// the op makes the new one. Mechanical: the plan chose the spelling (core/write-plan/plan-writes.ts).
import { lstat, rename } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { foldPath } from '../../foundation/util/fold.ts';
import { ShellCodes } from '../codes.ts';
import { errnoOf, errorReason, listDir } from '../fs.ts';

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
    if (errnoOf(error) === 'ENOENT' || errnoOf(error) === 'ENOTDIR') return undefined;
    throw error;
  }
}

/** Whether `a` and `b` are one directory entry (one inode on one device): two spellings of a case-insensitive name. */
async function sameEntry(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([statOf(a), statOf(b)]);
  return x !== undefined && y !== undefined && x.dev === y.dev && x.ino === y.ino;
}

/** Renames `from` to `to`, a case variant of it, through a temporary name (a direct rename may keep the old name). */
async function renameCase(at: string, from: string, to: string): Promise<void> {
  const temporary = join(at, `.romlift-case-${process.pid}-${from}`);
  await rename(join(at, from), temporary);
  await rename(temporary, join(at, to));
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
        await renameCase(at, other, part);
      } catch (error) {
        return diagnostic(ShellCodes, 'E_IO_WRITE', `cannot rename ${join(at, other)} to ${part}: ${errorReason(error)}`, { path: join(at, other) });
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
