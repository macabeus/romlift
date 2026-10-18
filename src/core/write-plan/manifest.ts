// The manifest codec (architecture §6.4, D17, D19): `.romlift/manifest.json` as canonical JSON, and its
// strict reader. Pure: the shell reads and writes the file. A text that is not a manifest decodes to an
// error value, never a throw, so a damaged manifest is reported, not fatal.
import { canonicalJson } from '../../foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../foundation/formats/types.ts';
import { WRITER_IDS } from '../emit/tree.ts';
import type { WriterId } from '../emit/tree.ts';
import type { Manifest } from './types.ts';

export type DecodedManifest = { readonly ok: true; readonly manifest: Manifest } | { readonly ok: false; readonly error: string };

const SHA1 = /^[0-9a-f]{40}$/;

/**
 * Whether `path` is a normalised project-relative path: '/'-separated, not absolute, no empty, '.' or '..'
 * segment, no backslash or NUL. Every path a manifest or journal names must be one, so no op can leave the
 * project directory.
 */
export function isProjectPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Whether `sha1` is forty lower-case hex digits. */
export function isSha1(sha1: unknown): sha1 is string {
  return typeof sha1 === 'string' && SHA1.test(sha1);
}

function isWriterId(value: unknown): value is WriterId {
  return typeof value === 'string' && (WRITER_IDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys of `value` that are not in `allowed`. */
export function extraKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): readonly string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/** The manifest as canonical JSON chunks (sorted keys), followed by a newline. */
export function* encodeManifest(manifest: Manifest): Generator<string> {
  yield* canonicalJson(manifest as unknown as JsonValue);
  yield '\n';
}

/** Reads a manifest text strictly: schema 1, a romlift version, and well-formed files only. */
export function decodeManifest(text: string): DecodedManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!isRecord(json)) return { ok: false, error: 'not a JSON object' };
  const extra = extraKeys(json, ['schema', 'romlift', 'files']);
  if (extra.length > 0) return { ok: false, error: `unknown member ${JSON.stringify(extra[0])}` };
  if (json['schema'] !== 1) return { ok: false, error: `schema ${JSON.stringify(json['schema'])}, expected 1` };
  const romlift = json['romlift'];
  if (typeof romlift !== 'string' || romlift.length === 0) return { ok: false, error: 'romlift is not a version string' };
  const files = json['files'];
  if (!isRecord(files)) return { ok: false, error: 'files is not an object' };
  // Object.fromEntries defines every key as an own member, '__proto__' included.
  const out: [string, { readonly sha1: string; readonly writer: WriterId }][] = [];
  for (const path of Object.keys(files)) {
    const entry = files[path];
    if (!isProjectPath(path)) return { ok: false, error: `files: ${JSON.stringify(path)} is not a project path` };
    if (!isRecord(entry)) return { ok: false, error: `files[${JSON.stringify(path)}] is not an object` };
    const unknown = extraKeys(entry, ['sha1', 'writer']);
    if (unknown.length > 0) return { ok: false, error: `files[${JSON.stringify(path)}]: unknown member ${JSON.stringify(unknown[0])}` };
    const sha1 = entry['sha1'];
    const writer = entry['writer'];
    if (!isSha1(sha1)) return { ok: false, error: `files[${JSON.stringify(path)}].sha1 is not a lower-case hex SHA-1` };
    if (!isWriterId(writer)) return { ok: false, error: `files[${JSON.stringify(path)}].writer ${JSON.stringify(writer)} is not a writer id` };
    out.push([path, { sha1, writer }]);
  }
  return { ok: true, manifest: { schema: 1, romlift, files: Object.fromEntries(out) } };
}
