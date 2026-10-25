// The refusal text of a signature file or spec that fails its zod schema (schema.ts, spec.ts; D95 d): the first issue,
// `<root><path>: <what>`, the path spelled `.key` and `[index]` (`file.versions[0].functions[1].mask`). A key the input
// lacks is `missing key '<key>'` at its object, a key the schema does not know `unknown key '<key>'`, any other issue
// the schema's own message. Pure; never throws.
import type { z } from 'zod';

/** `path` spelled from `root`: `.key` per property, `[i]` per index. */
function pathText(root: string, path: readonly PropertyKey[]): string {
  return `${root}${path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('')}`;
}

/** The value at `path` of `input`, or undefined when a step is missing. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let at: unknown = input;
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Readonly<Record<PropertyKey, unknown>>)[key];
  }
  return at;
}

/** Whether two paths are the same. */
function samePath(a: readonly PropertyKey[], b: readonly PropertyKey[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/**
 * The refusal text of `error` on `input`, whose top level is called `root` ('file', 'spec'): its first issue, except that
 * an unknown key of an object is named before a key that object lacks (a renamed key reads as the rename).
 */
export function firstIssue(error: z.ZodError, input: unknown, root: string): string {
  const first = error.issues[0];
  if (first === undefined) return `${root}: refused`;
  const unknown = error.issues.find((i) => i.code === 'unrecognized_keys' && first.path.length > 0 && samePath(i.path, first.path.slice(0, -1)));
  const issue = unknown ?? first;
  const path = issue.path;
  if (issue.code === 'unrecognized_keys') return `${pathText(root, path)}: unknown key '${issue.keys[0] ?? ''}'`;
  if (issue.code === 'invalid_type' && path.length > 0 && valueAt(input, path) === undefined) {
    return `${pathText(root, path.slice(0, -1))}: missing key '${String(path[path.length - 1])}'`;
  }
  return `${pathText(root, path)}: ${issue.message}`;
}
