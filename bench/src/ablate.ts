// `bench ablate <rule> [--only <name>] [--tier synthetic|real] [--json]` (architecture §4.1, §8.5,
// g2.rule-coverage): runs each target twice, once as analyze runs it with a 'decisions' trail and once
// with the rule disabled, and reports where the rule was decisive (the trail holds an accept, reject,
// verdict, claim or absorb event citing it) and where disabling it changes the outcome (the entries
// with their modes, the extents or the code end). The synthetic tier runs the committed fixtures of
// bench/dataset/synthetic (each directory with build/<name>.gba), and also says which expect.json stops
// holding; the real tier runs the tuning datasets, never a sealed one.
import { join } from 'node:path';

import { compareCodeUnits, isRuleId, parseHexAddr, romFromBytes, type AnalysisResult, type CompilerProfile, type Pipeline, type Rom, type RuleId, type TrailEvent, type TrailKind, type TrailSink } from 'romlift';
import { RULES } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

import { analysisTuning, benchProfile, DEFAULT_RUN_TUNING, discoverOptions, readRealInputs, type AnalysisRunner } from './analysis-run.ts';
import type { BenchContext } from './context.ts';
import { loadDatasets, tuningDatasets } from './dataset.ts';
import { BenchError, exists, isRecord, listFiles, readFileBytes, readJson } from './files.ts';

export const ABLATE_SCHEMA = 'romlift/bench-ablate@1';
export type AblationTier = 'synthetic' | 'real';

/** The --json line (frozen by test/gates/g2.rule-coverage.test.ts). */
export interface AblationReport {
  readonly schema: typeof ABLATE_SCHEMA;
  readonly rule: RuleId;
  readonly tier: AblationTier;
  /** Targets whose trail cites the rule in a decision. */
  readonly decisiveIn: readonly string[];
  /** Targets whose entries, extents or code end move with the rule disabled. */
  readonly changed: readonly string[];
}

/** The trail kinds that make a rule decisive (a proposal or a wait decides nothing). */
export const DECISIVE_KINDS: ReadonlySet<TrailKind> = new Set<TrailKind>(['accept', 'reject', 'verdict', 'claim', 'absorb']);

/** A sink that remembers only whether some decision cited `rule`. */
export function decisionSink(rule: RuleId): TrailSink & { readonly decisive: () => boolean } {
  let hit = false;
  return {
    event(e: TrailEvent): void {
      if (!hit && e.rule === rule && DECISIVE_KINDS.has(e.kind)) hit = true;
    },
    decisive: () => hit,
  };
}

/** What ablation compares: every entry with its mode and extent, and the code end. */
export function outcomeOf(result: Pick<AnalysisResult, 'functions' | 'codeEnd'>): string {
  return JSON.stringify({ functions: result.functions.map((f) => [f.entry, f.mode, f.extent.start, f.extent.end]), codeEnd: result.codeEnd });
}

/** Every rule id the profile's pipeline names. */
export function pipelineIds(p: Pipeline): RuleId[] {
  const g = p.gap;
  return [...p.seed, ...p.harvest, ...p.queue, ...p.walk, ...p.bl, ...p.validity, ...p.accept, ...p.claim, g.absorb, g.head, g.forward.thumb, g.forward.arm, ...g.forward.after, g.prefer, g.skip, g.endAnchor, g.backward, ...p.region];
}

/** Whether `rule` is one ablation can disable: a registered rule or one the profile's pipeline names. */
export function isAblatable(rule: string, profile: CompilerProfile): rule is RuleId {
  return isRuleId(rule) && (Object.hasOwn(RULES, rule) || pipelineIds(profile.pipeline).includes(rule));
}

// ---------------------------------------------------------------- the fixtures' expect.json

interface ExpectEntry {
  readonly addr: number;
  readonly mode: 'thumb' | 'arm';
  readonly extent?: { readonly start: number; readonly end: number };
}

export interface FixtureExpect {
  readonly negative: boolean;
  readonly entries: readonly ExpectEntry[];
  readonly codeEnd?: number;
}

function expectAddr(value: unknown, where: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseHexAddr(value) : undefined;
  if (n === undefined || !Number.isInteger(n) || n < 0) throw new BenchError(`${where}: '${String(value)}' is not an address`);
  return n;
}

/** Reads a fixture's expect.json (the shape g2.synthetic-analysis freezes). */
export function parseFixtureExpect(value: unknown, where: string): FixtureExpect {
  if (!isRecord(value) || !Array.isArray(value['entries'])) throw new BenchError(`${where}: expected {entries: [...]}`);
  const entries = value['entries'].map((e: unknown, i: number): ExpectEntry => {
    const at = `${where}: entries[${i}]`;
    const mode = isRecord(e) ? e['mode'] : undefined;
    if (!isRecord(e) || (mode !== 'thumb' && mode !== 'arm')) throw new BenchError(`${at} needs an addr and a mode`);
    const extent = e['extent'];
    const base: ExpectEntry = { addr: expectAddr(e['addr'], `${at}.addr`), mode };
    if (!isRecord(extent)) return base;
    return { ...base, extent: { start: expectAddr(extent['start'], `${at}.extent.start`), end: expectAddr(extent['end'], `${at}.extent.end`) } };
  });
  const codeEnd = value['codeEnd'];
  return { negative: value['negative'] === true, entries, ...(codeEnd === undefined ? {} : { codeEnd: expectAddr(codeEnd, `${where}: codeEnd`) }) };
}

/** Whether a result meets a fixture's expectation (as g2.synthetic-analysis judges it). */
export function expectHolds(expect: FixtureExpect, result: Pick<AnalysisResult, 'functions' | 'codeEnd'>): boolean {
  const found = new Map(result.functions.map((f) => [f.entry, f]));
  for (const e of expect.entries) {
    const f = found.get(e.addr);
    if (f === undefined || f.mode !== e.mode) return false;
    if (e.extent !== undefined && (f.extent.start !== e.extent.start || f.extent.end !== e.extent.end)) return false;
  }
  if (expect.codeEnd !== undefined && result.codeEnd !== expect.codeEnd) return false;
  if (expect.negative) {
    const expected = new Set(expect.entries.map((e) => e.addr));
    if (result.functions.some((f) => !expected.has(f.entry))) return false;
  }
  return true;
}

/** A committed fixture: bench/dataset/synthetic/<name>/ with build/<name>.gba (common/ never is one). */
export interface SyntheticFixture {
  readonly name: string;
  readonly rom: string;
  readonly expect: string;
}

export const syntheticRoot = (cx: BenchContext): string => join(cx.repoRoot, 'bench', 'dataset', 'synthetic');

/** The committed fixtures, sorted by name. */
export async function listFixtures(cx: BenchContext): Promise<SyntheticFixture[]> {
  const root = syntheticRoot(cx);
  if (!(await exists(root))) return [];
  const out: SyntheticFixture[] = [];
  for (const path of await listFiles(root)) {
    const m = /^([^/]+)\/build\/([^/]+)\.gba$/.exec(path);
    const name = m?.[1];
    if (name === undefined || m?.[2] !== name) continue;
    out.push({ name, rom: join(root, path), expect: join(root, name, 'expect.json') });
  }
  return out.sort((a, b) => compareCodeUnits(a.name, b.name));
}

// ---------------------------------------------------------------- ablation

export interface AblateOptions {
  readonly tier: AblationTier;
  readonly only?: string;
  readonly runner: AnalysisRunner;
  readonly log?: (line: string) => void;
}

interface Target {
  readonly name: string;
  readonly rom: () => Promise<Rom>;
  readonly expect?: () => Promise<FixtureExpect>;
}

async function targets(cx: BenchContext, options: AblateOptions): Promise<Target[]> {
  if (options.tier === 'synthetic') {
    return (await listFixtures(cx))
      .filter((f) => options.only === undefined || f.name === options.only)
      .map((f) => ({
        name: f.name,
        rom: async () => {
          const bytes = await readFileBytes(f.rom);
          return romFromBytes(bytes, sha1Of(bytes));
        },
        expect: async () => parseFixtureExpect(await readJson(f.expect), `${f.name}/expect.json`),
      }));
  }
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  return tuningDatasets(datasets, options.only).map((d) => ({ name: d.name, rom: async () => (await readRealInputs(cx, d)).rom }));
}

/** Runs every target with and without `rule`. */
export async function ablate(cx: BenchContext, rule: RuleId, options: AblateOptions): Promise<AblationReport> {
  const log = options.log ?? (() => {});
  const profile = benchProfile();
  const all = await targets(cx, options);
  if (all.length === 0) throw new BenchError(options.only === undefined ? `no ${options.tier} target to ablate` : `no ${options.tier} target named ${options.only}`);
  const on = analysisTuning(DEFAULT_RUN_TUNING);
  const off = analysisTuning({ ...DEFAULT_RUN_TUNING, disabled: [rule] });
  const decisiveIn: string[] = [];
  const changed: string[] = [];
  for (const t of all) {
    const rom = await t.rom();
    const sink = decisionSink(rule);
    let withRule: AnalysisResult;
    let without: AnalysisResult;
    try {
      withRule = options.runner.analyze(rom, profile, discoverOptions('decisions'), on, sink);
      without = options.runner.analyze(rom, profile, discoverOptions('off'), off);
    } catch (error) {
      throw new BenchError(`${t.name}: the analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const decisive = sink.decisive();
    const moves = outcomeOf(withRule) !== outcomeOf(without);
    if (decisive) decisiveIn.push(t.name);
    if (moves) changed.push(t.name);
    let expectNote = '';
    if (t.expect !== undefined) {
      const expect = await t.expect();
      const before = expectHolds(expect, withRule);
      const after = expectHolds(expect, without);
      expectNote = before === after ? `, expect.json ${before ? 'holds' : 'fails'} either way` : `, expect.json ${before ? 'holds' : 'fails'} with the rule and ${after ? 'holds' : 'fails'} without`;
    }
    log(`${t.name.padEnd(32)} ${decisive ? 'decisive' : 'not decisive'}, ${moves ? 'outcome moves' : 'outcome unchanged'}${expectNote}`);
  }
  return { schema: ABLATE_SCHEMA, rule, tier: options.tier, decisiveIn, changed };
}
