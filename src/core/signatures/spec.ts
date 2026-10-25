// A signature spec (`signatures/specs/<library>.json`, committed; architecture §7.1, D31, D32, D40, D93): which
// reference datasets and objects each version of a library is built from, and the display names a reviewer chose.
// It holds no bytes, so it is committed and published; `romlift signatures build <spec>` turns it into a signature
// file (schema.ts) by reading each reference's ELF, map and ROM. A reference names a bench dataset, never a sealed
// one (g6.no-heldout-references). Frozen by the phase-6 lead (D93).
//
// `parseSignatureSpec` validates with zod, like parseSignatureFile (D95 d), refuses unknown keys and never throws.
import { z } from 'zod';

import { firstIssue } from './issues.ts';
import { anyText, exactObject, isMemberId, listOf, nonEmptyText } from './schema.ts';
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

/** What a library name is: it names the built file `signatures/<library>.json`. */
const LIBRARY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** Whether `name` can be a library's name (LIBRARY_NAME): one file name, no path. */
export function isLibraryName(name: string): boolean {
  return LIBRARY_NAME.test(name);
}

/**
 * Whether a dataset (its JSON fields as the bench records them: `heldout`, `revealed`) is sealed: held out and never
 * revealed (D25). A sealed dataset is never a signature reference (D32); the shell's builder and the bench read this
 * one definition (architecture-6).
 */
export function isSealedDataset(fields: { readonly heldout?: unknown; readonly revealed?: unknown }): boolean {
  return fields.heldout === true && (!Array.isArray(fields.revealed) || fields.revealed.length === 0);
}

const referenceSchema = exactObject({
  dataset: nonEmptyText,
  objects: listOf(nonEmptyText).min(1, { error: 'names no object' }),
  tables: listOf(nonEmptyText).exactOptional(),
});

const versionSchema = exactObject({ id: nonEmptyText, idNote: anyText, references: listOf(referenceSchema).min(1, { error: 'names no reference' }) });

const reviewedSchema = z
  .record(z.string(), exactObject({ name: nonEmptyText, reason: nonEmptyText }), { error: 'must be an object' })
  .superRefine((names, ctx) => {
    for (const key of Object.keys(names)) if (!isMemberId(key)) ctx.addIssue({ code: 'custom', path: [key], message: `'${key}' is not a member id (<symbol>@<object>.o)` });
  })
  .transform((names) => {
    const out: Record<MemberId, { readonly name: string; readonly reason: string }> = {};
    for (const key of Object.keys(names).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const entry = names[key];
      if (entry !== undefined && isMemberId(key)) out[key] = entry;
    }
    return out;
  });

const specSchema = exactObject({ library: nonEmptyText.refine(isLibraryName, { error: (issue) => `'${String(issue.input)}' is no file name (letters, digits, '_', '.' and '-', not starting with '.' or '-')` }), versions: listOf(versionSchema).min(1, { error: 'names no version' }), reviewedNames: reviewedSchema });

/** Decodes a parsed spec (JSON.parse output); the refusal names the member at fault. Never throws. */
export function parseSignatureSpec(json: unknown): SignatureSpecParse {
  const parsed = specSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error, json, 'spec') };
}
