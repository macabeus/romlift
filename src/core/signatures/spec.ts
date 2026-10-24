// A signature spec (`signatures/specs/<library>.json`, committed; architecture §7.1, D31, D32, D40, D93): which
// reference datasets and objects each version of a library is built from, and the display names a reviewer chose.
// It holds no bytes, so it is committed and published; `romlift signatures build <spec>` turns it into a signature
// file (schema.ts) by reading each reference's ELF, map and ROM. A reference names a bench dataset, never a sealed
// one (g6.no-heldout-references). Frozen by the phase-6 lead (D93).
//
// `parseSignatureSpec` validates by hand, like parseSignatureFile (core/signatures may not import zod), refuses
// unknown keys and never throws.
import { decodeHelpers } from './schema.ts';
import type { MemberId } from './schema.ts';

/** One reference of a version: a dataset, the objects whose FUNC symbols become function members, and named tables. */
export interface SignatureSpecReference {
  /** A bench dataset name (bench/dataset/real/<dataset>.json). */
  readonly dataset: string;
  /** Object paths as the reference's map names them (`src/lib/m4a/m4a0.o`). */
  readonly objects: readonly string[];
  /** Data symbols of those objects that become table members. */
  readonly tables?: readonly string[];
}

export interface SignatureSpecVersion {
  readonly id: string;
  readonly idNote: string;
  readonly references: readonly SignatureSpecReference[];
}

export interface SignatureSpec {
  readonly library: string;
  readonly versions: readonly SignatureSpecVersion[];
  /** A member's reviewed display name and why it differs from the reference's symbol. */
  readonly reviewedNames: Readonly<Record<MemberId, { readonly name: string; readonly reason: string }>>;
}

export type SignatureSpecParse = { readonly ok: true; readonly value: SignatureSpec } | { readonly ok: false; readonly error: string };

const { object, record, list, text, memberId, refuse, isRefusal } = decodeHelpers;

function strings(value: unknown, path: string): readonly string[] {
  return list(value, path).map((s, i) => text(s, `${path}[${i}]`));
}

function specReference(value: unknown, path: string): SignatureSpecReference {
  const json = record(value, path, ['dataset', 'objects'], ['tables']);
  const objects = strings(json['objects'], `${path}.objects`);
  if (objects.length === 0) refuse(`${path}.objects`, 'names no object');
  const base = { dataset: text(json['dataset'], `${path}.dataset`), objects };
  return json['tables'] === undefined ? base : { ...base, tables: strings(json['tables'], `${path}.tables`) };
}

function specVersion(value: unknown, path: string): SignatureSpecVersion {
  const json = record(value, path, ['id', 'idNote', 'references']);
  const references = list(json['references'], `${path}.references`).map((r, i) => specReference(r, `${path}.references[${i}]`));
  if (references.length === 0) refuse(`${path}.references`, 'names no reference');
  return { id: text(json['id'], `${path}.id`), idNote: text(json['idNote'], `${path}.idNote`, false), references };
}

function reviewedNames(value: unknown, path: string): SignatureSpec['reviewedNames'] {
  const json = object(value, path);
  const out: Record<MemberId, { readonly name: string; readonly reason: string }> = {};
  for (const key of Object.keys(json).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const id = memberId(key, `${path}.${key}`);
    const entry = record(json[key], `${path}.${key}`, ['name', 'reason']);
    out[id] = { name: text(entry['name'], `${path}.${key}.name`), reason: text(entry['reason'], `${path}.${key}.reason`) };
  }
  return out;
}

/** Decodes a parsed spec (JSON.parse output); every refusal names the member at fault. Never throws. */
export function parseSignatureSpec(json: unknown): SignatureSpecParse {
  try {
    const root = record(json, 'spec', ['library', 'versions', 'reviewedNames']);
    const versions = list(root['versions'], 'spec.versions').map((v, i) => specVersion(v, `spec.versions[${i}]`));
    if (versions.length === 0) refuse('spec.versions', 'names no version');
    return { ok: true, value: { library: text(root['library'], 'spec.library'), versions, reviewedNames: reviewedNames(root['reviewedNames'], 'spec.reviewedNames') } };
  } catch (error) {
    if (isRefusal(error)) return { ok: false, error: error.message };
    throw error;
  }
}
