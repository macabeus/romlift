// Library signature files, schema 3 (architecture §7.1, D31, D40, D93): the masked byte patterns of a library's
// members, per version, with the references they were built from and each reference's link order; and the placement
// the matcher reports for one member on a ROM. Frozen by the phase-6 lead (D93); `extract.ts` (p6-signatures-build)
// writes these files and `match.ts` (p6-signatures-match) reads them. Plain readonly data (D19).
//
// `parseSignatureFile` validates with zod, as core/config validates romlift.toml (architecture §2, D95 d; it was a
// hand-written, exception-driven decoder until architecture-3). It accepts exactly the shape below and never throws:
// bytes and masks are lower-case hex, two digits per byte of the member; a table's `names` holds one entry per whole
// aligned word of the table (Math.floor(size / 4)), the member a pointer word names or null. Unknown keys are refused,
// so a file of another schema never half-decodes. The first issue is the refusal, spelled by issues.ts.
import { z } from 'zod';

import type { Addr, Mode } from '../../foundation/rom/span.ts';
import { firstIssue } from './issues.ts';

/** A member's object-qualified id, unique across a library's objects: `_fpadd_parts@dp-bit.o` (D31). */
export type MemberId = `${string}@${string}.o`;

/** The five placement rules of the matcher, strongest first (architecture §7.2); their files live in rules/. */
export type SignatureRuleId = 'sig.unique-fit' | 'sig.link-order-run' | 'sig.neighbour-spacing' | 'sig.pinned-both-sides' | 'sig.short-member-window';

/** The rule ids in strength order, the order the matcher tries them. */
export const SIGNATURE_RULE_IDS: readonly SignatureRuleId[] = ['sig.unique-fit', 'sig.link-order-run', 'sig.neighbour-spacing', 'sig.pinned-both-sides', 'sig.short-member-window'];

/** A reference build a version was extracted from: provenance only, never read by the matcher. */
export interface SignatureReference {
  /** The bench dataset name the spec gave (bench/dataset/real/<dataset>.json); never a sealed one (D32). */
  readonly dataset: string;
  /** The reference checkout's commit. */
  readonly commit: string;
  /** The SHA-1 of the ROM that reference's ELF rebuilds (lower-case hex). */
  readonly romSha1: string;
}

/** One member in a reference's link order, at its address in that reference: the address fixes the spacing. */
export interface LinkOrderMember {
  readonly id: MemberId;
  readonly addr: Addr;
}

/** A function member: its masked bytes. */
export interface SignatureFunction {
  readonly id: MemberId;
  /** The display name: the spec's reviewed name, else the reference's symbol (the id's part before '@'). */
  readonly name: string;
  readonly mode: Mode;
  readonly size: number;
  /** Lower-case hex, two digits per byte. */
  readonly bytes: string;
  /** Lower-case hex, as long as `bytes`: `ff` where a byte must equal, `00` where it is masked. */
  readonly mask: string;
}

/** A table member (a named data object of the library). */
export interface SignatureTable {
  readonly id: MemberId;
  readonly name: string;
  readonly size: number;
  readonly bytes: string;
  readonly mask: string;
  /** Per whole aligned word (Math.floor(size / 4) entries): the member a pointer word names, or null. */
  readonly names?: readonly (MemberId | null)[];
}

/** One version of a library: the earliest known release that ships these bytes (D31). */
export interface LibraryVersion {
  readonly id: string;
  /** What the id rests on. */
  readonly idNote: string;
  readonly references: readonly SignatureReference[];
  /** Per reference (its dataset name), the members it links, in link order with their addresses. */
  readonly linkOrder: readonly { readonly reference: string; readonly members: readonly LinkOrderMember[] }[];
  readonly functions: readonly SignatureFunction[];
  readonly tables: readonly SignatureTable[];
}

/** A built signature file (`signatures/<library>.json`, local and gitignored, D40). */
export interface SignatureFile {
  readonly schema: 3;
  readonly library: string;
  /** The romlift version that built it; every comparison of two builds leaves it out (g6.signatures-rebuild). */
  readonly builtWith: string;
  readonly versions: readonly LibraryVersion[];
}

/** One member the matcher placed on a ROM, with the rule that placed it (architecture §7.2, §7.3). */
export interface SignaturePlacement {
  readonly library: string;
  readonly version: string;
  readonly member: MemberId;
  /** The member's display name. */
  readonly name: string;
  readonly kind: 'function' | 'table';
  /** The load address on the ROM. */
  readonly addr: Addr;
  readonly size: number;
  /** Functions only. */
  readonly mode?: Mode;
  readonly rule: SignatureRuleId;
  /** sig.pinned-both-sides: the differing words, the game's constants (W_SIGNATURE_CONSTANT). */
  readonly constants?: readonly { readonly offset: number; readonly reference: number; readonly rom: number }[];
}

export type SignatureFileParse = { readonly ok: true; readonly value: SignatureFile } | { readonly ok: false; readonly error: string };

const MEMBER_ID = /^[^@\s]+@[^@\s]+\.o$/;
const HEX = /^(?:[0-9a-f]{2})*$/;
const SHA1 = /^[0-9a-f]{40}$/;

/** Whether `text` is a MemberId: `<symbol>@<object>.o`, no blank, exactly one '@'. */
export function isMemberId(text: string): text is MemberId {
  return MEMBER_ID.test(text);
}

// ---------------------------------------------------------------------------------------------------
// The zod schema (the messages are the refusal texts, path first: `file.versions[0].functions[1].mask: …`).

const NON_EMPTY = 'must be a non-empty string';

/** A non-empty string. */
export const nonEmptyText = z.string({ error: NON_EMPTY }).min(1, { error: NON_EMPTY });
/** Any string. */
export const anyText = z.string({ error: 'must be a string' });
/** An array of `item`. */
export function listOf<T extends z.ZodType>(item: T): z.ZodArray<T> {
  return z.array(item, { error: 'must be an array' });
}
/** An object with exactly `shape`'s keys (unknown keys refused). */
export function exactObject<T extends z.core.$ZodLooseShape>(shape: T): z.ZodObject<T, z.core.$strict> {
  return z.strictObject(shape, { error: 'must be an object' });
}

function integerFrom(min: number): z.ZodNumber {
  const message = `must be an integer from ${min} to 0xFFFFFFFF`;
  return z.number({ error: message }).int({ error: message }).min(min, { error: message }).max(0xffff_ffff, { error: message });
}

/** A MemberId (`<symbol>@<object>.o`). */
export const memberIdText = nonEmptyText.refine(isMemberId, { error: (issue) => `'${String(issue.input)}' is not a member id (<symbol>@<object>.o)` }).transform((id) => id as MemberId);

const hexText = anyText.regex(HEX, { error: 'must be lower-case hex, two digits per byte' });

/** The issue of a `bytes` or `mask` that does not hold exactly `size` bytes. */
function sizedHex(member: { readonly size: number; readonly bytes: string; readonly mask: string }, ctx: z.core.$RefinementCtx): void {
  for (const key of ['bytes', 'mask'] as const) {
    const hex = member[key];
    if (hex.length !== member.size * 2) ctx.addIssue({ code: 'custom', path: [key], message: `holds ${hex.length / 2} bytes, the member's size is ${member.size}` });
  }
}

const referenceSchema = exactObject({ dataset: nonEmptyText, commit: nonEmptyText, romSha1: nonEmptyText.regex(SHA1, { error: 'must be a lower-case hex SHA-1' }) });

const linkOrderSchema = exactObject({ reference: nonEmptyText, members: listOf(exactObject({ id: memberIdText, addr: integerFrom(0) })) });

const functionSchema = exactObject({
  id: memberIdText,
  name: nonEmptyText,
  mode: z.enum(['thumb', 'arm'], { error: "must be 'thumb' or 'arm'" }),
  size: integerFrom(1),
  bytes: hexText,
  mask: hexText,
}).superRefine(sizedHex);

const tableSchema = exactObject({
  id: memberIdText,
  name: nonEmptyText,
  size: integerFrom(1),
  bytes: hexText,
  mask: hexText,
  names: listOf(memberIdText.nullable()).exactOptional(),
})
  .superRefine(sizedHex)
  .superRefine((table, ctx) => {
    const words = Math.floor(table.size / 4);
    if (table.names !== undefined && table.names.length !== words) ctx.addIssue({ code: 'custom', path: ['names'], message: `holds ${table.names.length} entries, the table has ${words} aligned words` });
  });

const versionSchema = exactObject({
  id: nonEmptyText,
  idNote: anyText,
  references: listOf(referenceSchema),
  linkOrder: listOf(linkOrderSchema),
  functions: listOf(functionSchema),
  tables: listOf(tableSchema),
});

const fileSchema = exactObject({
  schema: z.literal(3, { error: (issue) => `is ${JSON.stringify(issue.input)}, not 3` }),
  library: nonEmptyText,
  builtWith: anyText,
  versions: listOf(versionSchema),
});

/** Decodes a parsed signature file (JSON.parse output); the refusal names the member at fault. Never throws. */
export function parseSignatureFile(json: unknown): SignatureFileParse {
  const parsed = fileSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: firstIssue(parsed.error, json, 'file') };
}
