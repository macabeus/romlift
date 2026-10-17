// The git facts the bench records or compares: the commit, whether the tree is dirty, a file at a ref,
// the merge-base, and the commit messages since a base (for Bench-Exception trailers).
import { runProcess } from './process.ts';

export async function gitHead(repo: string): Promise<string | null> {
  const run = await runProcess('git', ['-C', repo, 'rev-parse', 'HEAD']);
  return run.code === 0 ? run.stdout.trim() : null;
}

/**
 * True when `git status --porcelain` lists anything but bench/results.json (the artifact being
 * written), or when there is no git checkout.
 */
export async function gitDirty(repo: string): Promise<boolean> {
  const run = await runProcess('git', ['-C', repo, 'status', '--porcelain', '--', '.', ':(exclude)bench/results.json']);
  return run.code !== 0 || run.stdout.trim() !== '';
}

/** The text of `path` (repository-relative) at `ref`, or null when the ref or the file does not exist. */
export async function gitShow(repo: string, ref: string, path: string): Promise<string | null> {
  const run = await runProcess('git', ['-C', repo, 'show', `${ref}:${path}`]);
  return run.code === 0 ? run.stdout : null;
}

export async function gitMergeBase(repo: string, a: string, b: string): Promise<string | null> {
  const run = await runProcess('git', ['-C', repo, 'merge-base', a, b]);
  return run.code === 0 ? run.stdout.trim() : null;
}

/** The full messages of the commits in `base..HEAD`. */
export async function gitMessagesSince(repo: string, base: string): Promise<string[]> {
  const run = await runProcess('git', ['-C', repo, 'log', '--format=%B%x00', `${base}..HEAD`]);
  if (run.code !== 0) return [];
  return run.stdout
    .split('\0')
    .map((m) => m.trim())
    .filter((m) => m !== '');
}
