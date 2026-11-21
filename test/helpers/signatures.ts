// Builders for the signature matcher's tests (test/unit/signatures/match/**): schema-3 SignatureFile objects made in
// memory from byte snippets (thumb``/arm`` from test/helpers/thumb.ts and arm.ts, or `distinct` bytes), the link
// order of a reference laid out from given addresses, a ROM with the snippets placed (romWith), and the smallest
// discover AnalysisResult the matcher and the proposals read (its functions' entries and extents).
import type { AnalysisResult, FunctionFact } from '../../src/core/analysis/types.ts';
import type {
  LibraryVersion,
  MemberId,
  SignatureFile,
  SignatureFunction,
  SignatureTable,
} from '../../src/core/signatures/schema.ts';
import type { Addr, Mode } from '../../src/foundation/rom/span.ts';
import { prngSequence } from './prng.ts';

/** The object every test member belongs to unless it names another. */
export const TEST_OBJECT = 'lib';

/** A member's id: `<name>@<object>.o`. */
export function idOf(name: string, object = TEST_OBJECT): MemberId {
  return `${name}@${object}.o`;
}

interface MemberBase {
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Byte offsets the signature masks out (mask 0x00); every other byte must equal. */
  readonly masked?: readonly number[];
  /** The object it belongs to (its id's part after '@', without `.o`); default TEST_OBJECT. */
  readonly object?: string;
}

export interface FunctionSpec extends MemberBase {
  readonly kind?: 'function';
  readonly mode?: Mode;
}

export interface TableSpec extends MemberBase {
  readonly kind: 'table';
  /** Per whole aligned word: the member name a pointer word names, or null. */
  readonly names?: readonly (string | null)[];
}

export type MemberSpec = FunctionSpec | TableSpec;

/** One reference's link order: member names with their addresses in that reference. */
export interface LinkOrderSpec {
  readonly reference: string;
  readonly members: readonly { readonly name: string; readonly addr: Addr; readonly object?: string }[];
}

export interface VersionSpec {
  readonly id: string;
  readonly members: readonly MemberSpec[];
  /** Default: one reference 'ref' laying out every member contiguously, in listed order, from 0x0810_0000. */
  readonly linkOrder?: readonly LinkOrderSpec[];
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function maskOf(spec: MemberBase): string {
  const mask = new Uint8Array(spec.bytes.length).fill(0xff);
  for (const at of spec.masked ?? []) mask[at] = 0;
  return hexOf(mask);
}

function alignOf(spec: MemberSpec): number {
  return spec.kind === 'table' || spec.mode === 'arm' ? 4 : 2;
}

/**
 * A reference's link order with the members laid out contiguously from `start`, each aligned as it would be linked
 * (Thumb 2, ARM and tables 4), `gaps[name]` extra bytes before a member.
 */
export function contiguous(
  reference: string,
  members: readonly MemberSpec[],
  start: Addr = 0x0810_0000,
  gaps: Readonly<Record<string, number>> = {},
): LinkOrderSpec {
  let at = start;
  const out: { name: string; addr: Addr; object?: string }[] = [];
  for (const m of members) {
    at += gaps[m.name] ?? 0;
    const align = alignOf(m);
    at = Math.ceil(at / align) * align;
    out.push(m.object === undefined ? { name: m.name, addr: at } : { name: m.name, addr: at, object: m.object });
    at += m.bytes.length;
  }
  return { reference, members: out };
}

/** One library version from member snippets. */
export function libraryVersion(spec: VersionSpec): LibraryVersion {
  const functions: SignatureFunction[] = [];
  const tables: SignatureTable[] = [];
  for (const m of spec.members) {
    const common = {
      id: idOf(m.name, m.object),
      name: m.name,
      size: m.bytes.length,
      bytes: hexOf(m.bytes),
      mask: maskOf(m),
    };
    if (m.kind === 'table') {
      tables.push(
        m.names === undefined
          ? common
          : {
              ...common,
              names: m.names.map((n) => (n === null ? null : idOf(n, spec.members.find((x) => x.name === n)?.object))),
            },
      );
    } else functions.push({ ...common, mode: m.mode ?? 'thumb' });
  }
  const linkOrder = spec.linkOrder ?? [contiguous('ref', spec.members)];
  return {
    id: spec.id,
    idNote: 'a test version',
    references: linkOrder.map((l) => ({ dataset: l.reference, commit: 'test', romSha1: '0'.repeat(40) })),
    linkOrder: linkOrder.map((l) => ({
      reference: l.reference,
      members: l.members.map((m) => ({
        id: idOf(m.name, m.object ?? spec.members.find((x) => x.name === m.name)?.object),
        addr: m.addr,
      })),
    })),
    functions,
    tables,
  };
}

/** A schema-3 signature file of `library` with the given versions. */
export function signatureFile(library: string, ...versions: readonly VersionSpec[]): SignatureFile {
  return { schema: 3, library, builtWith: 'test', versions: versions.map(libraryVersion) };
}

/** `size` pseudo-random bytes from `seed`: a member no other snippet resembles. */
export function distinct(seed: number, size: number): Uint8Array {
  const words = prngSequence(seed, Math.ceil(size / 4));
  return new Uint8Array(words.buffer, 0, size).slice();
}

/** Little-endian bytes of 32-bit words. */
export function wordBytes(...values: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 * values.length);
  values.forEach((v, i) => new DataView(out.buffer).setUint32(4 * i, v >>> 0, true));
  return out;
}

/** `bytes` with the word at `offset` replaced by `value`. */
export function withWord(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const out = bytes.slice();
  new DataView(out.buffer).setUint32(offset, value >>> 0, true);
  return out;
}

/** Bytes laid end to end. */
export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A function fact with only an entry, a mode and an extent. */
export function factAt(entry: Addr, end: Addr, mode: Mode = 'thumb'): FunctionFact {
  return {
    entry,
    mode,
    extent: { start: entry, end },
    codeEnd: end,
    code: [{ start: entry, end }],
    dead: [],
    pools: [],
    farPools: [],
    tables: [],
    calls: [],
    blVerdicts: [],
    exits: [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: [],
    origin: 'gap-scan',
    accepted: { rule: 'seed.rom-entry', round: 0, cites: [] },
    also: [],
  };
}

/** A discover result whose only content is `functions` (sorted by entry here). */
export function analysisOf(functions: readonly FunctionFact[], end: Addr = 0x0900_0000): AnalysisResult {
  const sorted = [...functions].sort((x, y) => x.entry - y.entry);
  return {
    schema: 'romlift/analysis@1',
    mode: 'discover',
    rom: { sha1: 'test', end },
    profile: 'agbcc',
    options: { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    functions: sorted,
    claims: [],
    startup: { span: { start: 0x0800_0000, end: 0x0800_0000 }, entries: [] },
    codeEnd: sorted.reduce((n, f) => Math.max(n, f.extent.end), 0x0800_0000),
    rejections: [],
    diagnostics: [],
  };
}

/** A discover result whose code range is [start, end): one function covering it. */
export function codeRange(start: Addr, end: Addr): AnalysisResult {
  return analysisOf([factAt(start, end)]);
}
