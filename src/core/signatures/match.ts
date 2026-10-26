// The signature matcher (architecture §7.2, roadmap 6.B): where each member of each library version fits on a ROM,
// and which placement rule placed it. A port of the PoC's applyVersion (romlift-poc/src/signatures/apply.ts) onto
// schema 3: per version, decode the members' bytes and masks, find each member's anchor (its first fully unmasked
// 4-byte word at a halfword offset), index the anchors and scan the ROM once at halfword steps for candidates (at most
// policy.candidateCap per member; functions only inside the analysis' code range, Thumb at 2, ARM at 4, tables at 4
// or 2 by their reference address), build the chains (per reference and kind, in reference address order), then run
// the stages of policy.stages. Overlaps between versions are resolve.ts's; signatures propose and the TOML decides
// (D9), so nothing here knows the config.
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { insnUnit } from '../../foundation/rom/span.ts';
import { hexAddr, hexSize } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { SignatureCodes } from './codes.ts';
import type { SignatureCode } from './codes.ts';
import { SIGNATURE_POLICY } from './policy.ts';
import type { SignaturePolicy, SignatureStage } from './policy.ts';
import { PLACEMENT_RULES } from './rules/index.ts';
import { fits } from './rules/state.ts';
import { le32 } from '../../foundation/util/bytes.ts';
import { bytesOfHex } from '../../foundation/util/hex.ts';
import type { Chain, ChainLink, Member, Placed, SignatureRule, SignatureSweep, VersionState } from './rules/state.ts';
import type { LibraryVersion, MemberId, SignatureFile, SignaturePlacement } from './schema.ts';

/** A placed table, named by its library version and member: the tables whose words name members (`names`). */
export interface PlacedMemberRef {
  readonly library: string;
  readonly version: string;
  readonly member: MemberId;
}

/** What matchSignatures returns: every version's placements, before overlaps between versions are settled. */
export interface SignatureMatch {
  /** Sorted by `library@version` (code units), then address, then member id. */
  readonly placements: readonly SignaturePlacement[];
  /** The tables among them whose words name members (a proposal's type 'pointers'), in the same order. */
  readonly pointerTables: readonly PlacedMemberRef[];
  /** W_SIGNATURE_CONSTANT, W_SIGNATURE_POINTERS, W_SIGNATURE_AMBIGUOUS, per version in the same order. */
  readonly diagnostics: readonly Diagnostic<SignatureCode>[];
}

/** `library@version`, the key every order of the matcher and the resolver uses. */
export function versionKey(library: string, version: string): string {
  return `${library}@${version}`;
}

/** The first offset, at halfword steps, whose four mask bytes are all 0xFF, or -1. */
function anchorOf(mask: Uint8Array): number {
  for (let k = 0; k + 4 <= mask.length; k += 2) {
    if (mask[k] === 0xff && mask[k + 1] === 0xff && mask[k + 2] === 0xff && mask[k + 3] === 0xff) return k;
  }
  return -1;
}

/** Every reference address the version's link orders give a member. */
function referenceAddresses(version: LibraryVersion): ReadonlyMap<MemberId, readonly Addr[]> {
  const out = new Map<MemberId, Addr[]>();
  for (const order of version.linkOrder) {
    for (const m of order.members) {
      const list = out.get(m.id);
      if (list === undefined) out.set(m.id, [m.addr]);
      else list.push(m.addr);
    }
  }
  return out;
}

interface Scanned extends Member {
  readonly candidates: Addr[];
}

/** The members of a version, decoded, with empty candidate lists. */
function membersOf(version: LibraryVersion, policy: SignaturePolicy): Scanned[] {
  const refs = referenceAddresses(version);
  const out: Scanned[] = [];
  const decode = (
    id: MemberId,
    name: string,
    kind: 'function' | 'table',
    size: number,
    hexBytes: string,
    hexMask: string,
    align: 2 | 4,
    extra: Partial<Pick<Member, 'mode' | 'names'>>,
  ): void => {
    const mask = bytesOfHex(hexMask);
    let unmasked = 0;
    for (const m of mask) if (m === 0xff) unmasked++;
    const anchor = anchorOf(mask);
    out.push({ index: out.length, id, name, kind, size, bytes: bytesOfHex(hexBytes), mask, align, unmasked, anchor, free: anchor >= 0 && unmasked >= policy.minUnmaskedBytes, candidates: [], ...extra });
  };
  for (const f of version.functions) decode(f.id, f.name, 'function', f.size, f.bytes, f.mask, insnUnit(f.mode), { mode: f.mode });
  for (const t of version.tables) {
    // A table keeps the alignment its references gave it: 4 when every reference placed it on a word, else 2.
    const at = refs.get(t.id) ?? [];
    const align = at.length > 0 && at.every((a) => a % 4 === 0) ? 4 : 2;
    decode(t.id, t.name, 'table', t.size, t.bytes, t.mask, align, t.names === undefined ? {} : { names: t.names });
  }
  return out;
}

/** The version's chains: per kind (functions first), per link order in file order, members by reference address. */
function chainsOf(version: LibraryVersion, byId: ReadonlyMap<MemberId, Member>): Chain[] {
  const chains: Chain[] = [];
  for (const kind of ['function', 'table'] as const) {
    for (const order of version.linkOrder) {
      const links: ChainLink[] = [];
      for (const m of order.members) {
        const member = byId.get(m.id);
        if (member !== undefined && member.kind === kind) links.push({ member, refAddr: m.addr });
      }
      links.sort((x, y) => compareNumbers(x.refAddr, y.refAddr) || compareNumbers(x.member.index, y.member.index));
      if (links.length > 0) chains.push({ reference: order.reference, kind, links });
    }
  }
  return chains;
}

/** The analysis' code range, as the PoC's codeRange: the lowest entry to the highest extent end; empty without functions. */
function codeRange(analysis: AnalysisResult): { readonly lo: Addr; readonly hi: Addr } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of analysis.functions) {
    lo = Math.min(lo, f.entry);
    hi = Math.max(hi, f.extent.end);
  }
  return { lo, hi };
}

/** One pass over the ROM at halfword steps: every anchored member's candidates, ascending, capped. */
function scanCandidates(rom: Rom, members: readonly Scanned[], range: { readonly lo: Addr; readonly hi: Addr }, policy: SignaturePolicy): void {
  const index = new Map<number, Scanned[]>();
  for (const m of members) {
    if (m.anchor < 0) continue;
    const key = le32(m.bytes, m.anchor);
    const list = index.get(key);
    if (list === undefined) index.set(key, [m]);
    else list.push(m);
  }
  const b = rom.bytes;
  for (let off = 0; off + 4 <= b.length; off += 2) {
    const list = index.get(le32(b, off));
    if (list === undefined) continue;
    for (const m of list) {
      const start = rom.base + off - m.anchor;
      if (m.kind === 'function' && (start < range.lo || start >= range.hi)) continue;
      if (m.candidates.length < policy.candidateCap && fits(rom, m, start)) m.candidates.push(start);
    }
  }
}

/** The order a 'largest-first' or 'listed' sweep visits members in. */
function memberOrder(members: readonly Member[], sweep: 'largest-first' | 'listed'): readonly Member[] {
  if (sweep === 'listed') return members;
  return [...members].sort((x, y) => compareNumbers(y.size, x.size) || compareNumbers(x.index, y.index));
}

/** One sweep of a stage's rules over the version; whether anything was placed. */
function sweepOnce(state: VersionState, rules: readonly SignatureRule[], sweep: SignatureSweep): boolean {
  let changed = false;
  const unplaced = (m: Member): boolean => !state.placed.has(m.index);
  switch (sweep) {
    case 'largest-first':
    case 'listed':
      for (const member of memberOrder(state.members, sweep)) {
        if (!unplaced(member)) continue;
        for (const rule of rules) {
          if (rule.sweep !== 'largest-first' && rule.sweep !== 'listed') continue;
          if (rule.place(state, member)) {
            changed = true;
            break;
          }
        }
      }
      return changed;
    case 'chains':
      for (const rule of rules) if (rule.sweep === 'chains' && rule.place(state)) changed = true;
      return changed;
    case 'chain-member':
      for (const chain of state.chains) {
        chain.links.forEach((link, i) => {
          if (!unplaced(link.member)) return;
          for (const rule of rules) {
            if (rule.sweep !== 'chain-member') continue;
            if (rule.place(state, chain, i)) {
              changed = true;
              break;
            }
          }
        });
      }
      return changed;
  }
}

/** Runs one stage: its rules, which must share one sweep, once or, when it repeats, until it places nothing more. */
function runStage(state: VersionState, stage: SignatureStage): void {
  const rules = stage.rules.map((id) => PLACEMENT_RULES[id]);
  const sweep = rules[0]?.sweep;
  if (sweep === undefined) return;
  if (rules.some((r) => r.sweep !== sweep)) throw new RomliftInvariantError(`the stage ${stage.rules.join(', ')} mixes rules of different sweeps`);
  for (let changed = sweepOnce(state, rules, sweep); changed && stage.repeat; ) changed = sweepOnce(state, rules, sweep);
}

/** The diagnostics of one matched version: game constants, refused pointer tables, ambiguous members. */
function versionDiagnostics(state: VersionState): Diagnostic<SignatureCode>[] {
  const label = versionKey(state.library, state.version);
  const out: Diagnostic<SignatureCode>[] = [];
  for (const m of state.members) {
    const p = state.placed.get(m.index);
    if (p?.constants !== undefined) out.push(constantDiagnostic(placementOf(state, m, p)));
  }
  const ambiguous: { readonly name: string; readonly count: string }[] = [];
  for (const m of state.members) {
    if (state.placed.has(m.index)) continue;
    const refused = state.refusals.get(m.index);
    if (refused !== undefined) {
      out.push(diagnostic(SignatureCodes, 'W_SIGNATURE_POINTERS', `${label}: ${m.name} fits at ${hexAddr(refused)} but its pointers do not name the placed functions; not placed`, { addr: refused }));
    } else if (m.candidates.length > 1) {
      ambiguous.push({ name: m.name, count: m.candidates.length >= state.policy.candidateCap ? `${m.candidates.length} or more` : `${m.candidates.length}` });
    }
  }
  // One line per version (final-review clean-clone-6, end-to-end-user-16): a version that placed nothing at all is
  // most likely not linked, and its short members fit by chance, so the line says so instead of one warning each.
  const only = ambiguous.length === 1 ? ambiguous[0] : undefined;
  const none = state.placed.size === 0 ? `; nothing of ${label} is placed, so the ROM likely does not link it` : '';
  if (only !== undefined) {
    out.push(diagnostic(SignatureCodes, 'W_SIGNATURE_AMBIGUOUS', `${label}: ${only.name} fits at ${only.count} places and no neighbour settles it${none}`));
  } else if (ambiguous.length > 1) {
    const list = ambiguous.map((a) => `${a.name} (${a.count})`).join(', ');
    out.push(diagnostic(SignatureCodes, 'W_SIGNATURE_AMBIGUOUS', `${label}: ${ambiguous.length} members fit at several places and no neighbour settles them: ${list}${none}`));
  }
  return out;
}

/** W_SIGNATURE_CONSTANT for a placement sig.pinned-both-sides made: the words where the ROM differs from the reference. */
export function constantDiagnostic(p: SignaturePlacement): Diagnostic<SignatureCode> {
  const words = (p.constants ?? []).map((c) => `+${hexSize(c.offset)} ${hexAddr(c.reference)} -> ${hexAddr(c.rom)}`).join(', ');
  return diagnostic(SignatureCodes, 'W_SIGNATURE_CONSTANT', `${versionKey(p.library, p.version)}: ${p.name} differs from the reference in game constants: ${words}`, {
    addr: p.addr,
    span: { start: p.addr, end: p.addr + p.size },
    rule: p.rule,
  });
}

/** The public placement of member `m`, placed as `p`. */
function placementOf(state: VersionState, m: Member, p: Placed): SignaturePlacement {
  return {
    library: state.library,
    version: state.version,
    member: m.id,
    name: m.name,
    kind: m.kind,
    addr: p.addr,
    size: m.size,
    ...(m.mode === undefined ? {} : { mode: m.mode }),
    rule: p.rule,
    ...(p.constants === undefined ? {} : { constants: p.constants }),
  };
}

/** Orders placements by `library@version`, address, then member id. */
export function comparePlacements(x: SignaturePlacement, y: SignaturePlacement): number {
  return compareCodeUnits(versionKey(x.library, x.version), versionKey(y.library, y.version)) || compareNumbers(x.addr, y.addr) || compareCodeUnits(x.member, y.member);
}

/**
 * Matches every version of `files` on `rom` (architecture §7.2): the members each placement rule placed, with the
 * rule's id, and the version's diagnostics. `analysis` is a discover run of the same ROM; only its code range is read.
 * Versions are matched independently and in `library@version` order, so the order of `files` changes nothing.
 */
export function matchSignatures(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[], policy: SignaturePolicy = SIGNATURE_POLICY): SignatureMatch {
  const range = codeRange(analysis);
  const states: VersionState[] = [];
  const scanned: Scanned[] = [];
  for (const file of files) {
    for (const version of file.versions) {
      const members = membersOf(version, policy);
      const byId = new Map<MemberId, Member>();
      for (const m of members) if (!byId.has(m.id)) byId.set(m.id, m);
      states.push({ rom, policy, library: file.library, version: version.id, members, chains: chainsOf(version, byId), byId, placed: new Map(), refusals: new Map() });
      for (const m of members) scanned.push(m);
    }
  }
  states.sort((x, y) => compareCodeUnits(versionKey(x.library, x.version), versionKey(y.library, y.version)));
  scanCandidates(rom, scanned, range, policy);
  const placements: SignaturePlacement[] = [];
  const pointerTables: PlacedMemberRef[] = [];
  const diagnostics: Diagnostic<SignatureCode>[] = [];
  for (const state of states) {
    for (const stage of policy.stages) runStage(state, stage);
    const placed = state.members.flatMap((m) => {
      const p = state.placed.get(m.index);
      return p === undefined ? [] : [placementOf(state, m, p)];
    });
    placed.sort(comparePlacements);
    for (const p of placed) {
      placements.push(p);
      const m = state.byId.get(p.member);
      if (p.kind === 'table' && m?.names?.some((n) => n !== null) === true) pointerTables.push({ library: p.library, version: p.version, member: p.member });
    }
    for (const d of versionDiagnostics(state)) diagnostics.push(d);
  }
  return { placements, pointerTables, diagnostics };
}
