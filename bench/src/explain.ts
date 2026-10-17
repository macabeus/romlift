// `bench explain <rom> <addr> [--json]` (architecture §8.5, §9.2, D35): what romlift's seedless discover
// run decided about one address of a tuning ROM or a committed fixture. A first run finds the extents
// that cover the address; the second re-runs the analysis with trail 'full' and trailFilter set to
// explainFilter (the 256-byte bucket around the address and those extents), collects the events, and
// explainAnalysis (romlift/internal) composes them with the rules' metadata. A sealed dataset is never
// explained: an explanation is made of addresses (D25).
import { Claim, hexAddr, parseHexAddr, romFromBytes, type ClaimKind, type Rom, type TrailEvent } from 'romlift';
import { explainAnalysis, explainFilter, RULES, type AnalysisExplanation } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import { listFixtures } from './ablate.ts';
import { analysisTuning, benchProfile, DEFAULT_RUN_TUNING, readRealInputs, type AnalysisRunner } from './analysis-run.ts';
import type { BenchContext } from './context.ts';
import { isSealed, loadDatasets } from './dataset.ts';
import { BenchError, readFileBytes } from './files.ts';

export const EXPLAIN_SCHEMA = 'romlift/bench-explain@1';

export interface ExplainReport {
  readonly schema: typeof EXPLAIN_SCHEMA;
  /** The dataset or fixture name. */
  readonly rom: string;
  readonly explanation: AnalysisExplanation;
}

/** The address argument: 0x and hex digits, or decimal. */
export function parseExplainAddr(text: string): number | undefined {
  if (/^0x[0-9a-fA-F]+$/.test(text)) return parseHexAddr(text);
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : undefined;
}

/** The ROM of a tuning dataset or a committed fixture; a sealed dataset is refused. */
async function romNamed(cx: BenchContext, name: string): Promise<Rom> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const dataset = datasets.find((d) => d.name === name);
  if (dataset !== undefined) {
    if (isSealed(dataset)) throw new BenchError(`${name} is sealed: an explanation prints addresses, so it is never explained; reveal it first with bench run --reveal ${name} --reason <text>`);
    return (await readRealInputs(cx, dataset)).rom;
  }
  const fixture = (await listFixtures(cx)).find((f) => f.name === name);
  if (fixture === undefined) throw new BenchError(`no tuning dataset or fixture named ${name}`);
  const bytes = await readFileBytes(fixture.rom);
  return romFromBytes(bytes, sha1Of(bytes));
}

/** Explains `addr` in the discover run of `name`. */
export async function benchExplain(cx: BenchContext, name: string, addr: number, runner: AnalysisRunner): Promise<ExplainReport> {
  const rom = await romNamed(cx, name);
  const profile = benchProfile();
  const tuning = analysisTuning(DEFAULT_RUN_TUNING);
  try {
    const first = runner.analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' }, tuning);
    const events: TrailEvent[] = [];
    const filter = explainFilter(addr, first);
    const result = runner.analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'full', trailFilter: filter }, tuning, { event: (e) => events.push(e) });
    const metas = Object.values(RULES).map((rule) => rule.meta);
    return { schema: EXPLAIN_SCHEMA, rom: name, explanation: explainAnalysis(result, events, addr, metas) };
  } catch (error) {
    if (error instanceof BenchError) throw error;
    throw new BenchError(`${name}: the analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const CLAIM_NAMES: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(Claim).map(([name, kind]) => [kind, name]));

export function claimName(kind: ClaimKind): string {
  return CLAIM_NAMES[kind] ?? String(kind);
}

/** The explanation as text lines. */
export function explainText(report: ExplainReport): string[] {
  const x = report.explanation;
  const cites = (list: readonly number[]): string => (list.length === 0 ? '' : ` cites ${list.map(hexAddr).join(', ')}`);
  const lines = [`${hexAddr(x.addr)} in ${report.rom}: ${claimName(x.claim)}`];
  if (x.owner === undefined) lines.push('  no function extent covers it');
  else {
    lines.push(`  owner ${hexAddr(x.owner.entry)} (origin ${x.owner.origin})`);
    for (const p of x.owner.provenance) lines.push(`    ${p.rule} round ${p.round}${cites(p.cites)}${p.note === undefined ? '' : `: ${p.note}`}`);
  }
  lines.push(`  ${x.events.length} trail event(s)`);
  for (const e of x.events) lines.push(`    ${e.kind.padEnd(7)} ${hexAddr(e.at)} ${e.rule} round ${e.round}${cites(e.cites)}${e.detail === undefined ? '' : `: ${e.detail}`}`);
  if (x.rules.length > 0) lines.push('  rules');
  for (const r of x.rules) lines.push(`    ${r.id}: ${r.summary} (rests on ${r.restsOn})`);
  return lines;
}
