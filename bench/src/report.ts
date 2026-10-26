// Human-readable views of rows and artifacts: the one-line summary per ROM (with the phase-3 readability
// shares and objdiff summary when the row has them), the rows that moved
// between two artifacts (newly missed and newly false first), and the text of `bench baseline`.
import type { Results } from './artifact.ts';
import type { BenchRow } from './row.ts';

const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;

export function summaryLine(r: BenchRow): string {
  const unlistedMisses = r.misses.filter((m) => !m.listed).length;
  const unlistedFalse = r.falseEntries.filter((f) => !f.listed).length;
  return (
    `${r.name.padEnd(12)} truth ${String(r.elfFunctions).padStart(5)}  found ${String(r.entries).padStart(5)}` +
    `  precision ${pct(r.precision)}  recall ${pct(r.recall)}` +
    `  misses ${r.misses.length} (${unlistedMisses} unlisted)  false ${r.falseEntries.length} (${unlistedFalse} unlisted)` +
    `  extents ${r.extents.agree}/${r.extents.sized}  code end ${r.codeEnd.delta >= 0 ? '+' : ''}${r.codeEnd.delta}` +
    `${r.deterministic ? '' : '  NOT DETERMINISTIC'}  make ${r.scaffold === undefined ? 'n/a' : r.scaffold.ok ? 'OK' : 'FAILED'}` +
    `${r.readability === undefined ? '' : `  readability ${pct(r.readability.mnemonicShare)}/${pct(r.readability.symbolicBranchShare)}/${pct(r.readability.symbolicPoolShare)}`}` +
    `${r.objdiff === undefined ? '' : `  objdiff ${objdiffText(r.objdiff)}`}`
  );
}

/** The objdiff member in one phrase: not linked, or the scored count, the differences by kind and what D34 as amended gates (D102). */
export function objdiffText(o: NonNullable<BenchRow['objdiff']>): string {
  if (!o.linked) return 'not linked';
  const kinds = Object.entries(o.differences).map(([kind, n]) => `${n} ${kind}`);
  const gated = o.classes === undefined ? '' : `; gated ${o.classes.gated}, uncompared ${o.classes.uncompared}`;
  return `${o.scored} scored, ${kinds.length === 0 ? 'no difference' : kinds.join(', ')}${gated}`;
}

export interface RomDiff {
  readonly name: string;
  readonly newMisses: readonly string[];
  readonly newFalse: readonly string[];
  readonly resolvedMisses: readonly string[];
  readonly resolvedFalse: readonly string[];
  readonly newMismatches: readonly string[];
  readonly resolvedMismatches: readonly string[];
  readonly tp: readonly [number, number];
  readonly precision: readonly [number, number];
  readonly recall: readonly [number, number];
  readonly extents: readonly [string, string];
  readonly codeEnd: readonly [number, number];
}

/** Per ROM present in both artifacts, what moved from `base` to `fresh`. */
export function diffResults(fresh: Results, base: Results): RomDiff[] {
  const out: RomDiff[] = [];
  for (const r of fresh.roms) {
    const b = base.roms.find((x) => x.name === r.name);
    if (b === undefined) continue;
    const bm = new Set(b.misses.map((m) => m.addr));
    const rm = new Set(r.misses.map((m) => m.addr));
    const bf = new Set(b.falseEntries.map((f) => f.addr));
    const rf = new Set(r.falseEntries.map((f) => f.addr));
    const bx = new Set(b.extents.mismatches.map((m) => m.addr));
    const rx = new Set(r.extents.mismatches.map((m) => m.addr));
    out.push({
      name: r.name,
      newMisses: r.misses.filter((m) => !bm.has(m.addr)).map((m) => `${m.addr} ${m.name} (${m.reason})`),
      newFalse: r.falseEntries.filter((f) => !bf.has(f.addr)).map((f) => `${f.addr} via ${f.origin}`),
      resolvedMisses: b.misses.filter((m) => !rm.has(m.addr)).map((m) => `${m.addr} ${m.name}`),
      resolvedFalse: b.falseEntries.filter((f) => !rf.has(f.addr)).map((f) => `${f.addr} via ${f.origin}`),
      newMismatches: r.extents.mismatches.filter((m) => !bx.has(m.addr)).map((m) => `${m.addr} ${m.name}: ELF ${m.elf}, found ${m.found}`),
      resolvedMismatches: b.extents.mismatches.filter((m) => !rx.has(m.addr)).map((m) => `${m.addr} ${m.name}`),
      tp: [b.tp, r.tp],
      precision: [b.precision, r.precision],
      recall: [b.recall, r.recall],
      extents: [`${b.extents.agree}/${b.extents.sized}`, `${r.extents.agree}/${r.extents.sized}`],
      codeEnd: [b.codeEnd.delta, r.codeEnd.delta],
    });
  }
  return out;
}

export function moved(d: RomDiff): boolean {
  return [d.newMisses, d.newFalse, d.resolvedMisses, d.resolvedFalse, d.newMismatches, d.resolvedMismatches].some((rows) => rows.length > 0);
}

export function formatDiff(d: RomDiff): string {
  const lines = [
    `${d.name}: true positives ${d.tp[0]} -> ${d.tp[1]}, precision ${pct(d.precision[0])} -> ${pct(d.precision[1])}, ` +
      `recall ${pct(d.recall[0])} -> ${pct(d.recall[1])}, extents ${d.extents[0]} -> ${d.extents[1]}, code end ${d.codeEnd[0]} -> ${d.codeEnd[1]}`,
  ];
  const groups: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['newly missed', d.newMisses],
    ['newly false', d.newFalse],
    ['new extent mismatches', d.newMismatches],
    ['resolved misses', d.resolvedMisses],
    ['resolved false entries', d.resolvedFalse],
    ['resolved extent mismatches', d.resolvedMismatches],
  ];
  for (const [label, rows] of groups) if (rows.length > 0) lines.push(`  ${label}: ${rows.length}`, ...rows.map((x) => `    ${x}`));
  return lines.join('\n');
}

/** What an artifact says about one ROM, for `bench baseline <rom>`. */
export function baselineText(artifact: Results, rom: string, where: string): string | undefined {
  const r = artifact.roms.find((x) => x.name === rom);
  if (r === undefined) return undefined;
  const m = artifact.meta;
  return [
    summaryLine(r),
    `baseline: ${where}, commit ${m.commit ?? 'none'}${m.dirty ? ' (dirty tree)' : ''}, source digest ${m.sourceDigest}, Node ${m.nodeMajor}, rows from ${m.source}`,
  ].join('\n');
}
