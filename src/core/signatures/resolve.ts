// Overlap resolution (architecture §7.2, roadmap 6.B): the matched versions' placements settled into one set, and
// the library regions module inference reads. A port of the PoC's applySignatures after applyVersion
// (romlift-poc/src/signatures/apply.ts): versions take the ROM in order of how many members they placed (ties by
// `library@version` in code-unit order); a placement that overlaps bytes an earlier version took is dropped. A region
// is a run of one library's placements of one kind (functions or tables) within policy.moduleNear bytes of each other,
// named by the version that placed most there; two regions may not interleave, and the one with fewer placements
// yields, its placements dropped. Each drop is W_SIGNATURE_DROPPED with its counts.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import type { LibraryRegion } from '../proposals/types.ts';
import { SignatureCodes } from './codes.ts';
import type { SignatureCode } from './codes.ts';
import { constantDiagnostic, versionKey } from './match.ts';
import type { PlacedMemberRef, SignatureMatch } from './match.ts';
import { SIGNATURE_POLICY } from './policy.ts';
import type { SignaturePolicy } from './policy.ts';
import type { SignaturePlacement } from './schema.ts';

/** The settled placements of every version, with the library regions they form. */
export interface ResolvedSignatures {
  /** Sorted by address, then `library@version`, then member id; no two overlap. */
  readonly placements: readonly SignaturePlacement[];
  /** Sorted by start, then library. */
  readonly regions: readonly LibraryRegion[];
  /** The kept tables whose words name members. */
  readonly pointerTables: readonly PlacedMemberRef[];
  /** The matcher's diagnostics that still hold (W_SIGNATURE_CONSTANT only for kept placements), then the drops. */
  readonly diagnostics: readonly Diagnostic<SignatureCode>[];
}

function byAddress(x: SignaturePlacement, y: SignaturePlacement): number {
  return compareNumbers(x.addr, y.addr) || compareCodeUnits(versionKey(x.library, x.version), versionKey(y.library, y.version)) || compareCodeUnits(x.member, y.member);
}

/** Drops every placement overlapping bytes a version that placed more took first. */
function settleOverlaps(rom: Rom, placements: readonly SignaturePlacement[], drops: Diagnostic<SignatureCode>[]): SignaturePlacement[] {
  const groups = new Map<string, SignaturePlacement[]>();
  for (const p of placements) {
    const key = versionKey(p.library, p.version);
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [p]);
    else list.push(p);
  }
  const ordered = sortedEntries(groups).sort((x, y) => compareNumbers(y[1].length, x[1].length) || compareCodeUnits(x[0], y[0]));
  const taken = new Uint8Array(rom.bytes.length);
  const kept: SignaturePlacement[] = [];
  for (const [key, list] of ordered) {
    let clashes = 0;
    for (const p of [...list].sort(byAddress)) {
      const off = p.addr - rom.base;
      let clash = off < 0 || off + p.size > taken.length;
      for (let i = 0; i < p.size && !clash; i++) if (taken[off + i] !== 0) clash = true;
      if (clash) {
        clashes++;
        continue;
      }
      taken.fill(1, off, off + p.size);
      kept.push(p);
    }
    // A version all of whose placements another version of its library took first is that library's other version:
    // the ROM links the winner, and the drop is no news (final-review clean-clone-6). Any other drop is reported.
    const superseded = clashes === list.length && kept.some((k) => k.library === list[0]?.library);
    if (clashes > 0 && !superseded) drops.push(diagnostic(SignatureCodes, 'W_SIGNATURE_DROPPED', `${key}: ${clashes} of its ${list.length} placements overlap a version that placed more; dropped`));
  }
  return kept.sort(byAddress);
}

interface Region {
  readonly library: string;
  readonly kind: SignaturePlacement['kind'];
  readonly version: string;
  readonly start: Addr;
  readonly end: Addr;
  readonly count: number;
}

/** The regions of `placements` (sorted by address): runs of one library and kind within `near` bytes. */
function regionsOf(placements: readonly SignaturePlacement[], near: number): Region[] {
  const pieces: { library: string; kind: SignaturePlacement['kind']; items: SignaturePlacement[]; end: Addr }[] = [];
  for (const p of placements) {
    const piece = pieces.find((q) => q.library === p.library && q.kind === p.kind && p.addr - q.end <= near);
    if (piece === undefined) pieces.push({ library: p.library, kind: p.kind, items: [p], end: p.addr + p.size });
    else {
      piece.items.push(p);
      piece.end = Math.max(piece.end, p.addr + p.size);
    }
  }
  const regions = pieces.map((piece): Region => {
    const counts = new Map<string, number>();
    for (const p of piece.items) counts.set(p.version, (counts.get(p.version) ?? 0) + 1);
    let version = '';
    let most = 0;
    for (const [v, n] of sortedEntries(counts)) {
      if (n > most) {
        version = v;
        most = n;
      }
    }
    // The items arrive in address order, so the first starts the region.
    const start = piece.items[0]?.addr ?? piece.end;
    return { library: piece.library, kind: piece.kind, version, start, end: piece.end, count: piece.items.length };
  });
  return regions.sort((x, y) => compareNumbers(x.start, y.start) || compareCodeUnits(x.library, y.library) || compareCodeUnits(x.kind, y.kind));
}

/**
 * Settles the matcher's placements (architecture §7.2): overlaps between versions, then interleaving regions. The
 * result's placements never overlap, and its regions are the library ranges module inference receives (§7.3).
 */
export function resolvePlacements(rom: Rom, matched: SignatureMatch, policy: SignaturePolicy = SIGNATURE_POLICY): ResolvedSignatures {
  const drops: Diagnostic<SignatureCode>[] = [];
  let chosen = settleOverlaps(rom, matched.placements, drops);
  let regions = regionsOf(chosen, policy.moduleNear);
  for (;;) {
    const i = regions.findIndex((r, k) => {
      const next = regions[k + 1];
      return next !== undefined && next.start < r.end;
    });
    const a = regions[i];
    const b = regions[i + 1];
    if (a === undefined || b === undefined) break;
    const loser = a.count <= b.count ? a : b;
    const winner = loser === a ? b : a;
    drops.push(
      diagnostic(
        SignatureCodes,
        'W_SIGNATURE_DROPPED',
        `${versionKey(loser.library, loser.version)}: its ${loser.count} placements from ${hexAddr(loser.start)} interleave with ${versionKey(winner.library, winner.version)}'s ${winner.count}; dropped`,
        { addr: loser.start, span: { start: loser.start, end: loser.end } },
      ),
    );
    chosen = chosen.filter((p) => !(p.library === loser.library && p.kind === loser.kind && p.addr >= loser.start && p.addr < loser.end));
    regions = regionsOf(chosen, policy.moduleNear);
  }
  const keptKeys = new Set(chosen.map((p) => `${versionKey(p.library, p.version)}:${p.member}`));
  const pointerTables = matched.pointerTables.filter((t) => keptKeys.has(`${versionKey(t.library, t.version)}:${t.member}`));
  // A refused pointer table of a version that kept nothing while another version of its library kept placements is that
  // library's other version, which the ROM does not link: not reported (final-review end-to-end-user-r1-4, as
  // settleOverlaps treats its drops). versionDiagnostics starts each message with the version's key.
  const keptVersions = new Set(chosen.map((p) => versionKey(p.library, p.version)));
  const keptLibraries = new Set(chosen.map((p) => p.library));
  const otherVersion = (d: Diagnostic<SignatureCode>): boolean => {
    const key = d.message.slice(0, d.message.indexOf(': '));
    const library = key.slice(0, key.lastIndexOf('@'));
    return key.includes('@') && !keptVersions.has(key) && keptLibraries.has(library);
  };
  const diagnostics: Diagnostic<SignatureCode>[] = matched.diagnostics.filter((d) => d.code !== 'W_SIGNATURE_CONSTANT' && !(d.code === 'W_SIGNATURE_POINTERS' && otherVersion(d)));
  for (const p of chosen) if (p.constants !== undefined) diagnostics.push(constantDiagnostic(p));
  for (const d of drops) diagnostics.push(d);
  return {
    placements: chosen,
    regions: regions.map((r) => ({ span: { start: r.start, end: r.end }, library: r.library, version: r.version })),
    pointerTables,
    diagnostics,
  };
}
