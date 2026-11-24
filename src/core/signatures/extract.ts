// The signature builder's pure part (architecture §7.1, §7.2, D31, D40, roadmap 6.A): from a spec and, per version,
// its reference builds (a ROM, romlift's discover analysis of it, the ELF's symbols and the map's input placements),
// the signature file of schema 3. Ported from the PoC's signatures/build.ts, whose rules and numbers it keeps:
//
// - Members. A reference's function members are the FUNC symbols inside the `.text` placements of the map objects its
//   `objects` globs name (`*` spans '/', a glob matches the object as the map prints it, at a path-segment boundary:
//   `libgcc.a(*)`, `src/m4a.o`). Where several FUNC symbols share an address the first global one wins, else the last
//   local one (the PoC's choice). A member's size is the least of its ELF size (0: unbounded), the distance to the next
//   member of its placement and the distance to the placement's end. Its tables are the OBJECT symbols `tables` names,
//   sized by the least of the ELF size and the distance to the next OBJECT or FUNC symbol.
// - Identity. A member's id is `<symbol>@<object base name>` (`_udivsi3@_udivsi3.o` for `libgcc.a(_udivsi3.o)`,
//   `m4aSoundMain@m4a.o` for `src/m4a.o`). A later reference adds only the members whose identity the earlier ones
//   lack, where one identity is the same id or, for two global symbols of one kind, the same symbol: a global name is
//   one definition in any link, while the same library may sit in other objects (libagbsyscall is one object per stub
//   in Emerald's archive and one assembly file in Fire Emblem 7's). The PoC merged by symbol alone; statics such as
//   libgcc's `_fpadd_parts` of fp-bit.o and dp-bit.o stay two members.
// - Link order. Per reference, every member it contributed or matched, with its address there, in address order.
// - Masks (mask byte 00 ignores the byte, ff keeps it). Over the instructions the reference's discover analysis decoded
//   (its functions' `code` spans): a Thumb `bl` pair [00 f8 00 f8]; a Thumb `b` leaving the member [00 f8], a `bcc`
//   leaving it [00 ff]; an ARM `bl`, and an ARM `b` leaving the member, [00 00 00 ff]. Every aligned word outside
//   those instructions whose top byte is 0x02, 0x03 or 0x08 to 0x0D (a RAM or ROM address) is masked whole.
// - Names. A member's display name is its reviewed name (the spec's reviewedNames) or its symbol; two members of one
//   version with one display name are refused (E_SIGNATURE_NAME_DUPLICATE). A table that is word aligned and sized
//   carries `names` when at least one of its words, Thumb bit cleared, is the address of a function member the same
//   reference links.
//
// Pure: no I/O, never throws for content; the shell reads the files (shell/signatures/build-from-references.ts) and
// writes the canonical text signatureFileText gives.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { hexBytes } from '../../foundation/util/hex.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { canonicalJson } from '../../foundation/formats/canonical-json.ts';
import type { ElfSymbol, GnuMap, JsonValue } from '../../foundation/formats/types.ts';
import { isThumbBlPrefix, isThumbBlSuffix } from '@match-kit/isa/armv4t';
import { peek16, peek32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Mode, Span } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers, sortedKeys } from '../../foundation/util/sorted.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { SignatureCodes } from './codes.ts';
import type { SignatureCode } from './codes.ts';
import { isMemberId } from './schema.ts';
import type { LibraryVersion, LinkOrderMember, MemberId, SignatureFile, SignatureFunction, SignatureReference, SignatureTable } from './schema.ts';
import type { SignatureSpec, SignatureSpecReference, SignatureSpecVersion } from './spec.ts';

/** One input section of a reference's map: the object as the map prints it (`lib.a(member.o)`), its address and size. */
export interface MapPlacement {
  readonly object: string;
  readonly start: Addr;
  readonly size: number;
}

/** One reference build of a version, as the shell read it. */
export interface ReferenceInput {
  /** The spec's dataset name. */
  readonly dataset: string;
  /** The reference checkout's commit (a real dataset's elfCommit). */
  readonly commit: string;
  /** The SHA-1 of the reference ROM, lower-case hex. */
  readonly romSha1: string;
  readonly rom: Rom;
  /** romlift's discover analysis of `rom`: its functions' code spans are the instruction boundaries. */
  readonly analysis: AnalysisResult;
  /** Every defined symbol of the reference ELF, in symbol-table order. */
  readonly symbols: readonly ElfSymbol[];
  /** The map's `.text` input placements (the function members' objects). */
  readonly textPlacements: readonly MapPlacement[];
  /** Every other input placement of the map (the tables' objects: `.rodata`, `.data`, ...). */
  readonly dataPlacements: readonly MapPlacement[];
  /**
   * True for an image that links a whole library archive (a toolchain reference, D123): its members lie in the
   * archive's order, which is no program's link order, so the version takes its members but no link order from it.
   */
  readonly archive?: boolean;
}

export type SignatureDiagnostic = Diagnostic<SignatureCode>;

export type ExtractResult =
  | { readonly ok: true; readonly value: SignatureFile; readonly diagnostics: readonly SignatureDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly SignatureDiagnostic[] };

// ---------------------------------------------------------------------------------------------------
// The map and the object globs.

/** The object of a map input as ld prints it: `<archive>(<member>)` for an archive member, else the file. */
function printedObject(file: string, member: string | undefined): string {
  return member === undefined ? file : `${file}(${member})`;
}

/** The input placements of a map with a non-zero size: the `.text` ones and every other one, each in map order. */
export function mapPlacements(map: GnuMap): { readonly text: readonly MapPlacement[]; readonly data: readonly MapPlacement[] } {
  const text: MapPlacement[] = [];
  const data: MapPlacement[] = [];
  for (const section of map.sections) {
    for (const input of section.inputs) {
      if (input.size <= 0) continue;
      const placement = { object: printedObject(input.file, input.member), start: input.address, size: input.size };
      (input.section === '.text' ? text : data).push(placement);
    }
  }
  return { text, data };
}

/** Whether `text` matches `glob` whole: `*` any run of characters ('/' included), `?` one character. */
function wildcardMatches(glob: string, text: string): boolean {
  let g = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    const c = glob[g];
    if (c === '*') {
      star = g++;
      resume = t;
    } else if (c !== undefined && (c === '?' || c === text[t])) {
      g++;
      t++;
    } else if (star >= 0) {
      g = star + 1;
      t = ++resume;
    } else return false;
  }
  while (glob[g] === '*') g++;
  return g === glob.length;
}

/** Whether an object glob names `object`: the whole path or a suffix that starts after a '/' (the PoC's `(^|/)glob$`). */
export function objectGlobMatches(glob: string, object: string): boolean {
  if (wildcardMatches(glob, object)) return true;
  for (let i = object.indexOf('/'); i >= 0; i = object.indexOf('/', i + 1)) if (wildcardMatches(glob, object.slice(i + 1))) return true;
  return false;
}

/** The base name of a map object: an archive member's own name (`_udivsi3.o` of `libgcc.a(_udivsi3.o)`), else the file's. */
export function objectBaseName(object: string): string {
  const member = /\(([^()]+)\)$/.exec(object)?.[1];
  const path = member ?? object;
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The member id of `symbol` in `object`, or undefined when the two give none (a blank or '@' in the symbol, no `.o`). */
export function memberIdOf(symbol: string, object: string): MemberId | undefined {
  const id = `${symbol}@${objectBaseName(object)}`;
  return isMemberId(id) ? id : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Instruction boundaries and masks.

interface CodeRun {
  readonly start: Addr;
  readonly end: Addr;
  readonly mode: Mode;
}

/** The code spans of an analysis, sorted by start (then end, then mode), with the running maximum of their ends. */
interface CodeIndex {
  readonly runs: readonly CodeRun[];
  readonly maxEnd: readonly number[];
}

function codeIndex(analysis: AnalysisResult): CodeIndex {
  const runs: CodeRun[] = [];
  for (const f of analysis.functions) for (const span of f.code) runs.push({ start: span.start, end: span.end, mode: f.mode });
  runs.sort((a, b) => compareNumbers(a.start, b.start) || compareNumbers(a.end, b.end) || compareCodeUnits(a.mode, b.mode));
  const maxEnd: number[] = [];
  let max = -Infinity;
  for (const run of runs) {
    max = Math.max(max, run.end);
    maxEnd.push(max);
  }
  return { runs, maxEnd };
}

interface InsnAt {
  readonly size: 2 | 4;
  readonly mode: Mode;
}

/** The size of the Thumb instruction at `a`: 4 for a `bl` pair, else 2. */
function thumbSize(rom: Rom, a: Addr): 2 | 4 {
  return isThumbBlPrefix(peek16(rom, a)) && a + 4 <= rom.end && isThumbBlSuffix(peek16(rom, a + 2)) ? 4 : 2;
}

/**
 * The instructions the analysis decoded whose first byte lies in `span`, by address: each code run that reaches the
 * span is walked from its start, so the boundaries are the walk's. Where two runs disagree, the earlier run's wins.
 */
function instructionsIn(rom: Rom, index: CodeIndex, span: Span): ReadonlyMap<Addr, InsnAt> {
  const overlapping: CodeRun[] = [];
  for (let j = lowerBound(index.runs, span.end, (r) => r.start) - 1; j >= 0 && (index.maxEnd[j] ?? -Infinity) > span.start; j--) {
    const run = index.runs[j];
    if (run !== undefined && run.end > span.start) overlapping.push(run);
  }
  overlapping.reverse();
  const out = new Map<Addr, InsnAt>();
  for (const run of overlapping) {
    for (let a = run.start; a < run.end && a < span.end; ) {
      const size = run.mode === 'arm' ? 4 : thumbSize(rom, a);
      if (a >= span.start && !out.has(a)) out.set(a, { size, mode: run.mode });
      a += size;
    }
  }
  return out;
}

/** Whether a word reads as a RAM or ROM address: top byte 0x02, 0x03 or 0x08 to 0x0D. */
export function isAddressLike(word: number): boolean {
  const top = word >>> 24;
  return top === 0x02 || top === 0x03 || (top >= 0x08 && top <= 0x0d);
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & sign) !== 0 ? value - (sign << 1) : value;
}

const THUMB_BL_MASK = [0x00, 0xf8, 0x00, 0xf8] as const;
const THUMB_B_MASK = [0x00, 0xf8] as const;
const THUMB_BCC_MASK = [0x00, 0xff] as const;
const ARM_BRANCH_MASK = [0x00, 0x00, 0x00, 0xff] as const;
const WORD_MASK = [0x00, 0x00, 0x00, 0x00] as const;

/** The masked bytes of [start, end): the reference's bytes and the mask of what the link changes (see the header). */
export function maskMember(rom: Rom, insns: ReadonlyMap<Addr, InsnAt>, start: Addr, end: Addr): { readonly bytes: Uint8Array; readonly mask: Uint8Array } {
  const bytes = rom.bytes.slice(start - rom.base, end - rom.base);
  const mask = new Uint8Array(end - start).fill(0xff);
  const maskAt = (a: Addr, m: readonly number[]): void => {
    for (let i = 0; i < m.length && a - start + i < mask.length; i++) mask[a - start + i] = (mask[a - start + i] ?? 0) & (m[i] ?? 0);
  };
  const leaves = (target: Addr): boolean => target < start || target >= end;
  for (let a = start; a < end; ) {
    const insn = insns.get(a);
    if (insn !== undefined) {
      if (insn.mode === 'thumb') {
        const hw = peek16(rom, a);
        if (isThumbBlPrefix(hw) && a + 4 <= rom.end && isThumbBlSuffix(peek16(rom, a + 2))) maskAt(a, THUMB_BL_MASK);
        else if (hw >>> 11 === 0b11100) {
          if (leaves(a + 4 + signExtend(hw & 0x7ff, 11) * 2)) maskAt(a, THUMB_B_MASK);
        } else if (hw >>> 12 === 0b1101 && ((hw >>> 8) & 0xf) < 0xe) {
          if (leaves(a + 4 + signExtend(hw & 0xff, 8) * 2)) maskAt(a, THUMB_BCC_MASK);
        }
      } else {
        const w = peek32(rom, a);
        if (w >>> 28 !== 0xf && (w & 0x0e00_0000) === 0x0a00_0000) {
          const link = (w & 0x0100_0000) !== 0;
          if (link || leaves(a + 8 + signExtend(w & 0xff_ffff, 24) * 4)) maskAt(a, ARM_BRANCH_MASK);
        }
      }
      a += insn.size;
    } else if ((a & 3) === 0 && a + 4 <= end) {
      if (isAddressLike(peek32(rom, a))) maskAt(a, WORD_MASK);
      a += 4;
    } else a += 2;
  }
  return { bytes, mask };
}

// ---------------------------------------------------------------------------------------------------
// The members of one reference.

/** A member as one reference links it, before identities merge. */
interface Linked {
  readonly id: MemberId;
  readonly symbol: string;
  readonly global: boolean;
  readonly kind: 'function' | 'table';
  readonly addr: Addr;
  readonly size: number;
  readonly mode?: Mode;
  readonly bytes: Uint8Array;
  readonly mask: Uint8Array;
}

/** A member of the version being built. */
interface Member extends Linked {
  /** The index of the reference that contributed it. */
  readonly reference: number;
  readonly names?: readonly (MemberId | null)[];
}

/** What every reference of a version reads: its ROM-held symbols and its instruction index. */
interface ReferenceView {
  readonly input: ReferenceInput;
  readonly label: string;
  /** Symbols whose address lies in the ROM, in symbol-table order. */
  readonly romSymbols: readonly ElfSymbol[];
  /** The function symbol of each address (the first global, else the last local), by address. */
  readonly functionAt: ReadonlyMap<Addr, ElfSymbol>;
  /** The addresses of functionAt, ascending. */
  readonly functionAddrs: readonly Addr[];
  /** The addresses of every FUNC and OBJECT symbol in the ROM, ascending. */
  readonly typedAddrs: readonly Addr[];
  readonly code: CodeIndex;
}

function viewOf(input: ReferenceInput, label: string): ReferenceView {
  const { rom } = input;
  const romSymbols = input.symbols.filter((s) => s.addr >= rom.base && s.addr < rom.end);
  const functionAt = new Map<Addr, ElfSymbol>();
  for (const s of romSymbols) {
    if (s.type !== 'func') continue;
    const have = functionAt.get(s.addr);
    if (have === undefined || have.bind === 'local') functionAt.set(s.addr, s);
  }
  const typedAddrs = romSymbols.filter((s) => s.type === 'func' || s.type === 'object').map((s) => s.addr);
  typedAddrs.sort(compareNumbers);
  return { input, label, romSymbols, functionAt, functionAddrs: sortedKeys(functionAt), typedAddrs, code: codeIndex(input.analysis) };
}

type Problems = SignatureDiagnostic[];

function linkedOf(
  view: ReferenceView,
  symbol: ElfSymbol,
  object: string,
  kind: 'function' | 'table',
  size: number,
  problems: Problems,
): Linked | undefined {
  const { rom } = view.input;
  const id = memberIdOf(symbol.name, object);
  if (id === undefined) {
    problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_MEMBER_ID_INVALID', `${view.label}: ${symbol.name} in ${object} gives no member id`, { addr: symbol.addr }));
    return undefined;
  }
  const end = symbol.addr + size;
  if (end > rom.end) {
    problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_MEMBER_OUTSIDE_ROM', `${view.label}: ${id} (${size} bytes) runs past the ROM end ${hexAddr(rom.end)}`, { addr: symbol.addr }));
    return undefined;
  }
  const { bytes, mask } = maskMember(rom, instructionsIn(rom, view.code, { start: symbol.addr, end }), symbol.addr, end);
  const base = { id, symbol: symbol.name, global: symbol.bind !== 'local', kind, addr: symbol.addr, size, bytes, mask };
  return kind === 'function' ? { ...base, mode: symbol.thumb ? 'thumb' : 'arm' } : base;
}

/** The function members a reference links: the FUNC symbols of its matching `.text` placements, in address order. */
function functionMembers(view: ReferenceView, spec: SignatureSpecReference, problems: Problems): readonly Linked[] {
  const placements = view.input.textPlacements
    .filter((p) => spec.objects.some((glob) => objectGlobMatches(glob, p.object)))
    .sort((a, b) => compareNumbers(a.start, b.start) || compareCodeUnits(a.object, b.object));
  if (placements.length === 0) {
    problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_OBJECTS_UNMATCHED', `${view.label}: no .text placement matches ${spec.objects.join(', ')}`));
    return [];
  }
  const out: Linked[] = [];
  for (const placement of placements) {
    const end = placement.start + placement.size;
    const first = lowerBound(view.functionAddrs, placement.start, (a) => a);
    const last = lowerBound(view.functionAddrs, end, (a) => a);
    for (let i = first; i < last; i++) {
      const addr = view.functionAddrs[i];
      const symbol = addr === undefined ? undefined : view.functionAt.get(addr);
      if (addr === undefined || symbol === undefined) continue;
      const next = i + 1 < last ? (view.functionAddrs[i + 1] ?? end) : end;
      const size = Math.min(symbol.size === 0 ? Infinity : symbol.size, next - addr, end - addr);
      if (size <= 0) continue;
      const linked = linkedOf(view, symbol, placement.object, 'function', size, problems);
      if (linked !== undefined) out.push(linked);
    }
  }
  return out;
}

/** The input placement holding `addr` (a `.text` one first), or undefined. */
function placementAt(input: ReferenceInput, addr: Addr): MapPlacement | undefined {
  const holds = (p: MapPlacement): boolean => addr >= p.start && addr < p.start + p.size;
  return input.textPlacements.find(holds) ?? input.dataPlacements.find(holds);
}

/** One table the spec names: the first OBJECT symbol of that name in the ROM, sized by its ELF size and the next symbol. */
function tableMember(view: ReferenceView, name: string, problems: Problems): Linked | undefined {
  const symbol = view.romSymbols.find((s) => s.name === name && s.type === 'object');
  if (symbol === undefined) {
    problems.push(diagnostic(SignatureCodes, 'W_SIGNATURE_TABLE_MISSING', `${view.label}: no OBJECT symbol ${name}; skipped`));
    return undefined;
  }
  const after = view.typedAddrs[lowerBound(view.typedAddrs, symbol.addr + 1, (a) => a)];
  const size = Math.min(symbol.size === 0 ? Infinity : symbol.size, after === undefined ? Infinity : after - symbol.addr);
  if (!Number.isFinite(size) || size <= 0) {
    problems.push(diagnostic(SignatureCodes, 'W_SIGNATURE_TABLE_UNSIZED', `${view.label}: ${name} has no size; skipped`, { addr: symbol.addr }));
    return undefined;
  }
  const placement = placementAt(view.input, symbol.addr);
  if (placement === undefined) {
    problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_TABLE_UNPLACED', `${view.label}: ${name} at ${hexAddr(symbol.addr)} lies in no placement of the map`, { addr: symbol.addr }));
    return undefined;
  }
  return linkedOf(view, symbol, placement.object, 'table', size, problems);
}

/** Per whole word of a word-aligned table: the function member this reference links at the word's address, or null. */
function tableNames(rom: Rom, table: Linked, functionsHere: ReadonlyMap<Addr, MemberId>): readonly (MemberId | null)[] | undefined {
  if ((table.addr & 3) !== 0 || (table.size & 3) !== 0) return undefined;
  const names: (MemberId | null)[] = [];
  for (let a = table.addr; a < table.addr + table.size; a += 4) names.push(functionsHere.get((peek32(rom, a) & ~1) >>> 0) ?? null);
  return names.some((n) => n !== null) ? names : undefined;
}

// ---------------------------------------------------------------------------------------------------
// Versions.

/** Whether two members' bytes differ where both masks keep them, over the bytes both have. */
function bytesDiffer(a: Linked, b: Linked): boolean {
  const n = Math.min(a.bytes.length, b.bytes.length);
  for (let i = 0; i < n; i++) if ((((a.bytes[i] ?? 0) ^ (b.bytes[i] ?? 0)) & (a.mask[i] ?? 0) & (b.mask[i] ?? 0)) !== 0) return true;
  return false;
}

/** The version a spec version and its reference inputs give, or undefined when one of its problems is an error. */
function buildVersion(spec: SignatureSpec, version: SignatureSpecVersion, inputs: readonly ReferenceInput[], problems: Problems): LibraryVersion | undefined {
  const firstProblem = problems.length;
  const members: Member[] = [];
  const byId = new Map<MemberId, Member>();
  const byGlobal = new Map<string, Member>();
  const linkOrder: { readonly reference: string; readonly members: readonly LinkOrderMember[] }[] = [];

  version.references.forEach((specRef, r) => {
    const input = inputs[r];
    if (input === undefined) return;
    const view = viewOf(input, `${spec.library} ${version.id} ${input.dataset}`);
    const here: LinkOrderMember[] = [];
    const linkedIds = new Set<MemberId>();
    const functionsHere = new Map<Addr, MemberId>();
    const link = (linked: Linked, names?: readonly (MemberId | null)[]): void => {
      const key = `${linked.kind}:${linked.symbol}`;
      const existing = byId.get(linked.id) ?? (linked.global ? byGlobal.get(key) : undefined);
      const member = existing ?? { ...linked, reference: r, ...(names === undefined ? {} : { names }) };
      if (linkedIds.has(member.id)) {
        problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_MEMBER_DUPLICATE', `${view.label}: ${linked.id} at ${hexAddr(linked.addr)} is ${member.id} again`, { addr: linked.addr }));
        return;
      }
      linkedIds.add(member.id);
      if (existing === undefined) {
        members.push(member);
        byId.set(member.id, member);
        if (member.global && !byGlobal.has(key)) byGlobal.set(key, member);
      } else if (existing.reference !== r && bytesDiffer(existing, linked)) {
        const where = `${linked.id} at ${hexAddr(linked.addr)}`;
        problems.push(diagnostic(SignatureCodes, 'W_SIGNATURE_MEMBER_DIFFERS', `${view.label}: ${where} differs from ${member.id} of ${inputs[existing.reference]?.dataset ?? '?'}`, { addr: linked.addr }));
      }
      if (member.kind === 'function') functionsHere.set(linked.addr, member.id);
      here.push({ id: member.id, addr: linked.addr });
    };
    for (const f of functionMembers(view, specRef, problems)) link(f);
    for (const name of specRef.tables ?? []) {
      const table = tableMember(view, name, problems);
      if (table !== undefined) link(table, tableNames(input.rom, table, functionsHere));
    }
    here.sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.id, b.id));
    if (input.archive !== true) linkOrder.push({ reference: input.dataset, members: here });
  });

  const nameOf = (m: Member): string => spec.reviewedNames[m.id]?.name ?? m.symbol;
  const byName = new Map<string, MemberId[]>();
  for (const m of members) {
    const ids = byName.get(nameOf(m));
    if (ids === undefined) byName.set(nameOf(m), [m.id]);
    else ids.push(m.id);
  }
  for (const name of sortedKeys(byName)) {
    const ids = byName.get(name) ?? [];
    if (ids.length > 1) {
      problems.push(diagnostic(SignatureCodes, 'E_SIGNATURE_NAME_DUPLICATE', `${spec.library} ${version.id}: ${ids.join(', ')} all display as ${name}; review all but one in reviewedNames`));
    }
  }
  if (problems.slice(firstProblem).some((d) => d.severity === 'error')) return undefined;

  const functions: SignatureFunction[] = [];
  const tables: SignatureTable[] = [];
  for (const m of members) {
    const shared = { id: m.id, name: nameOf(m), size: m.size, bytes: hexBytes(m.bytes), mask: hexBytes(m.mask) };
    if (m.kind === 'function') functions.push({ ...shared, mode: m.mode ?? 'thumb' });
    else tables.push(m.names === undefined ? shared : { ...shared, names: m.names });
  }
  const references: SignatureReference[] = inputs.map((i) => ({ dataset: i.dataset, commit: i.commit, romSha1: i.romSha1 }));
  return { id: version.id, idNote: version.idNote, references, linkOrder, functions, tables };
}

/** Why the inputs are not one list per spec version, one input per spec reference, in the spec's order; undefined when they are. */
function inputsProblem(spec: SignatureSpec, references: readonly (readonly ReferenceInput[])[]): string | undefined {
  if (references.length !== spec.versions.length) return `${references.length} reference lists for ${spec.versions.length} versions`;
  for (const [v, version] of spec.versions.entries()) {
    const given = (references[v] ?? []).map((i) => i.dataset);
    const wanted = version.references.map((r) => r.dataset);
    if (given.length !== wanted.length || given.some((d, i) => d !== wanted[i])) return `version ${version.id}: inputs ${given.join(', ') || 'none'}, the spec names ${wanted.join(', ')}`;
  }
  return undefined;
}

/**
 * The signature file of `spec` from `references` (one list per spec version, in spec order, one input per spec
 * reference); `builtWith` is the romlift version. Refused (ok: false) when any diagnostic is an error.
 */
export function extractSignatures(spec: SignatureSpec, references: readonly (readonly ReferenceInput[])[], builtWith: string): ExtractResult {
  const mismatch = inputsProblem(spec, references);
  if (mismatch !== undefined) return { ok: false, diagnostics: [diagnostic(SignatureCodes, 'E_SIGNATURE_REFERENCES_MISMATCH', `${spec.library}: ${mismatch}`)] };
  const problems: Problems = [];
  const versions: LibraryVersion[] = [];
  spec.versions.forEach((version, v) => {
    const built = buildVersion(spec, version, references[v] ?? [], problems);
    if (built !== undefined) versions.push(built);
  });
  const known = new Set<string>();
  for (const v of versions) for (const m of [...v.functions, ...v.tables]) known.add(m.id);
  for (const id of Object.keys(spec.reviewedNames).sort(compareCodeUnits)) {
    if (!known.has(id)) problems.push(diagnostic(SignatureCodes, 'W_SIGNATURE_REVIEWED_UNUSED', `${spec.library}: reviewed name of ${id}, which no version has`));
  }
  if (problems.some((d) => d.severity === 'error') || versions.length !== spec.versions.length) return { ok: false, diagnostics: problems };
  return { ok: true, value: { schema: 3, library: spec.library, builtWith, versions }, diagnostics: problems };
}

// ---------------------------------------------------------------------------------------------------
// The file's text.

function memberJson(m: SignatureFunction | SignatureTable): { [key: string]: JsonValue } {
  const base: { [key: string]: JsonValue } = { id: m.id, name: m.name, size: m.size, bytes: m.bytes, mask: m.mask };
  if ('mode' in m) base['mode'] = m.mode;
  if ('names' in m && m.names !== undefined) base['names'] = [...m.names];
  return base;
}

/** A signature file as a JSON value (plain objects, every member written). */
export function signatureFileJson(file: SignatureFile): JsonValue {
  return {
    schema: file.schema,
    library: file.library,
    builtWith: file.builtWith,
    versions: file.versions.map((v) => ({
      id: v.id,
      idNote: v.idNote,
      references: v.references.map((r) => ({ dataset: r.dataset, commit: r.commit, romSha1: r.romSha1 })),
      linkOrder: v.linkOrder.map((l) => ({ reference: l.reference, members: l.members.map((m) => ({ id: m.id, addr: m.addr })) })),
      functions: v.functions.map(memberJson),
      tables: v.tables.map(memberJson),
    })),
  };
}

/** The file's text: canonical JSON (keys sorted by code unit, no whitespace) and a newline; two builds compare equal. */
export function signatureFileText(file: SignatureFile): string {
  return `${[...canonicalJson(signatureFileJson(file))].join('')}\n`;
}
