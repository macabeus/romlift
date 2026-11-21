// The journal (architecture §6.4, D17): `.romlift/journal.json`, written by the shell before the first op
// of a plan and deleted after the manifest. A run that finds one finishes the interrupted plan: generated
// paths it lists count as owned, an edit whose file has its result sha1 is done, one whose file still has
// its base sha1 is re-applied. Pure codec and derivation; the shell does the file work.
import { canonicalJson } from '../../foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../foundation/formats/types.ts';
import { extraKeys, isProjectPath, isSha1 } from './manifest.ts';
import type { WriteOp } from './types.ts';

/** One journalled op: a write carries its result sha1, an edit its base and result sha1, a delete and a mode neither. */
export interface JournalOp {
  readonly op: 'write' | 'edit' | 'delete' | 'mode';
  readonly path: string;
  readonly baseSha1?: string;
  readonly resultSha1?: string;
}

export interface Journal {
  readonly schema: 1;
  /** In the order the plan applies them. */
  readonly ops: readonly JournalOp[];
}

export type DecodedJournal =
  | { readonly ok: true; readonly journal: Journal }
  | { readonly ok: false; readonly error: string };

/** The journal of a plan: every op that changes a file, in plan order (a keep changes nothing and is left out). */
export function journalOf(ops: readonly WriteOp[]): Journal {
  const out: JournalOp[] = [];
  for (const op of ops) {
    if (op.op === 'write') out.push({ op: 'write', path: op.path, resultSha1: op.sha1 });
    else if (op.op === 'edit')
      out.push({ op: 'edit', path: op.path, baseSha1: op.baseSha1, resultSha1: op.resultSha1 });
    else if (op.op === 'delete') out.push({ op: 'delete', path: op.path });
    else if (op.op === 'mode') out.push({ op: 'mode', path: op.path });
  }
  return { schema: 1, ops: out };
}

/** The journal as canonical JSON chunks, followed by a newline. */
export function* encodeJournal(journal: Journal): Generator<string> {
  yield* canonicalJson(journal as unknown as JsonValue);
  yield '\n';
}

const OPS: readonly JournalOp['op'][] = ['write', 'edit', 'delete', 'mode'];

function decodeOp(value: unknown, at: string): JournalOp | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at} is not an object`;
  const record = value as Readonly<Record<string, unknown>>;
  const unknown = extraKeys(record, ['op', 'path', 'baseSha1', 'resultSha1']);
  if (unknown.length > 0) return `${at}: unknown member ${JSON.stringify(unknown[0])}`;
  const op = record['op'];
  const path = record['path'];
  const base = record['baseSha1'];
  const result = record['resultSha1'];
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op))
    return `${at}.op ${JSON.stringify(op)} is not write, edit, delete or mode`;
  if (typeof path !== 'string' || !isProjectPath(path))
    return `${at}.path ${JSON.stringify(path)} is not a project path`;
  if (base !== undefined && !isSha1(base)) return `${at}.baseSha1 is not a lower-case hex SHA-1`;
  if (result !== undefined && !isSha1(result)) return `${at}.resultSha1 is not a lower-case hex SHA-1`;
  const kind = op as JournalOp['op'];
  if (kind === 'write' && (result === undefined || base !== undefined)) return `${at}: a write carries resultSha1 only`;
  if (kind === 'edit' && (result === undefined || base === undefined))
    return `${at}: an edit carries baseSha1 and resultSha1`;
  if ((kind === 'delete' || kind === 'mode') && (result !== undefined || base !== undefined))
    return `${at}: a ${kind} carries no sha1`;
  return {
    op: kind,
    path,
    ...(base === undefined ? {} : { baseSha1: base }),
    ...(result === undefined ? {} : { resultSha1: result }),
  };
}

/** Reads a journal text strictly; an error value for anything that is not one. */
export function decodeJournal(text: string): DecodedJournal {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return { ok: false, error: 'not a JSON object' };
  const record = json as Readonly<Record<string, unknown>>;
  const extra = extraKeys(record, ['schema', 'ops']);
  if (extra.length > 0) return { ok: false, error: `unknown member ${JSON.stringify(extra[0])}` };
  if (record['schema'] !== 1) return { ok: false, error: `schema ${JSON.stringify(record['schema'])}, expected 1` };
  const ops = record['ops'];
  if (!Array.isArray(ops)) return { ok: false, error: 'ops is not an array' };
  const out: JournalOp[] = [];
  for (const [i, value] of ops.entries()) {
    const op = decodeOp(value, `ops[${i}]`);
    if (typeof op === 'string') return { ok: false, error: op };
    out.push(op);
  }
  return { ok: true, journal: { schema: 1, ops: out } };
}
