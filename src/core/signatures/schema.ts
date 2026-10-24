// Library signature files, schema 3 (architecture §7.1, D31, D40, D93): the masked byte patterns of a library's
// members, per version, with the references they were built from and each reference's link order; and the placement
// the matcher reports for one member on a ROM. Frozen by the phase-6 lead (D93); `extract.ts` (p6-signatures-build)
// writes these files and `match.ts` (p6-signatures-match) reads them. Plain readonly data (D19).
//
// `parseSignatureFile` is a hand-written validator, because core/signatures may not import zod (architecture §2). It
// accepts exactly the shape below and never throws: bytes and masks are lower-case hex, two digits per byte of the
// member; a table's `names` holds one entry per whole aligned word of the table (Math.floor(size / 4)), the member a
// pointer word names or null. Unknown keys are refused, so a file of another schema never half-decodes.
import type { Addr, Mode } from '../../foundation/rom/span.ts';

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

/** A decoding failure: the path of the offending member and what is wrong. */
class Refusal {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

type Json = Readonly<Record<string, unknown>>;

function refuse(path: string, what: string): never {
  throw new Refusal(`${path}: ${what}`);
}

/** A JSON object with any keys. */
function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse(path, 'must be an object');
  return value as Json;
}

/** A JSON object with exactly `keys`, plus any of `optional`. */
function record(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Json {
  const json = object(value, path);
  for (const key of Object.keys(json)) if (!keys.includes(key) && !optional.includes(key)) refuse(path, `unknown key '${key}'`);
  for (const key of keys) if (!(key in json)) refuse(path, `missing key '${key}'`);
  return json;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) refuse(path, 'must be an array');
  return value;
}

function text(value: unknown, path: string, nonEmpty = true): string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) refuse(path, nonEmpty ? 'must be a non-empty string' : 'must be a string');
  return value;
}

function count(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 0xffff_ffff) refuse(path, `must be an integer from ${min} to 0xFFFFFFFF`);
  return value;
}

function memberId(value: unknown, path: string): MemberId {
  const id = text(value, path);
  if (!isMemberId(id)) refuse(path, `'${id}' is not a member id (<symbol>@<object>.o)`);
  return id;
}

function hexOf(value: unknown, path: string, size: number): string {
  const hex = text(value, path, false);
  if (!HEX.test(hex)) refuse(path, 'must be lower-case hex, two digits per byte');
  if (hex.length !== size * 2) refuse(path, `holds ${hex.length / 2} bytes, the member's size is ${size}`);
  return hex;
}

function reference(value: unknown, path: string): SignatureReference {
  const json = record(value, path, ['dataset', 'commit', 'romSha1']);
  const romSha1 = text(json['romSha1'], `${path}.romSha1`);
  if (!SHA1.test(romSha1)) refuse(`${path}.romSha1`, 'must be a lower-case hex SHA-1');
  return { dataset: text(json['dataset'], `${path}.dataset`), commit: text(json['commit'], `${path}.commit`), romSha1 };
}

function linkOrder(value: unknown, path: string): LibraryVersion['linkOrder'][number] {
  const json = record(value, path, ['reference', 'members']);
  const members = list(json['members'], `${path}.members`).map((m, i): LinkOrderMember => {
    const member = record(m, `${path}.members[${i}]`, ['id', 'addr']);
    return { id: memberId(member['id'], `${path}.members[${i}].id`), addr: count(member['addr'], `${path}.members[${i}].addr`, 0) };
  });
  return { reference: text(json['reference'], `${path}.reference`), members };
}

function signatureFunction(value: unknown, path: string): SignatureFunction {
  const json = record(value, path, ['id', 'name', 'mode', 'size', 'bytes', 'mask']);
  const mode = json['mode'];
  if (mode !== 'thumb' && mode !== 'arm') refuse(`${path}.mode`, "must be 'thumb' or 'arm'");
  const size = count(json['size'], `${path}.size`, 1);
  return {
    id: memberId(json['id'], `${path}.id`),
    name: text(json['name'], `${path}.name`),
    mode,
    size,
    bytes: hexOf(json['bytes'], `${path}.bytes`, size),
    mask: hexOf(json['mask'], `${path}.mask`, size),
  };
}

function signatureTable(value: unknown, path: string): SignatureTable {
  const json = record(value, path, ['id', 'name', 'size', 'bytes', 'mask'], ['names']);
  const size = count(json['size'], `${path}.size`, 1);
  const table = {
    id: memberId(json['id'], `${path}.id`),
    name: text(json['name'], `${path}.name`),
    size,
    bytes: hexOf(json['bytes'], `${path}.bytes`, size),
    mask: hexOf(json['mask'], `${path}.mask`, size),
  };
  if (json['names'] === undefined) return table;
  const names = list(json['names'], `${path}.names`).map((n, i) => (n === null ? null : memberId(n, `${path}.names[${i}]`)));
  if (names.length !== Math.floor(size / 4)) refuse(`${path}.names`, `holds ${names.length} entries, the table has ${Math.floor(size / 4)} aligned words`);
  return { ...table, names };
}

function libraryVersion(value: unknown, path: string): LibraryVersion {
  const json = record(value, path, ['id', 'idNote', 'references', 'linkOrder', 'functions', 'tables']);
  return {
    id: text(json['id'], `${path}.id`),
    idNote: text(json['idNote'], `${path}.idNote`, false),
    references: list(json['references'], `${path}.references`).map((r, i) => reference(r, `${path}.references[${i}]`)),
    linkOrder: list(json['linkOrder'], `${path}.linkOrder`).map((l, i) => linkOrder(l, `${path}.linkOrder[${i}]`)),
    functions: list(json['functions'], `${path}.functions`).map((f, i) => signatureFunction(f, `${path}.functions[${i}]`)),
    tables: list(json['tables'], `${path}.tables`).map((t, i) => signatureTable(t, `${path}.tables[${i}]`)),
  };
}

/** Decodes a parsed signature file (JSON.parse output); every refusal names the member at fault. Never throws. */
export function parseSignatureFile(json: unknown): SignatureFileParse {
  try {
    const root = record(json, 'file', ['schema', 'library', 'builtWith', 'versions']);
    if (root['schema'] !== 3) refuse('file.schema', `is ${JSON.stringify(root['schema'])}, not 3`);
    const value: SignatureFile = {
      schema: 3,
      library: text(root['library'], 'file.library'),
      builtWith: text(root['builtWith'], 'file.builtWith', false),
      versions: list(root['versions'], 'file.versions').map((v, i) => libraryVersion(v, `file.versions[${i}]`)),
    };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
}

/** Internal to core/signatures: the decoding helpers spec.ts shares (one way to refuse a member). */
export const decodeHelpers = { object, record, list, text, memberId, refuse, isRefusal: (error: unknown): error is Refusal => error instanceof Refusal } as const;
