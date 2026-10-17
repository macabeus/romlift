// `romlift doctor` (architecture §2.1, roadmap 1.C): what the user's toolchain can do for romlift. Five
// checks, always in this order: the binutils and their versions; the round-trip corpus re-assembled
// with the user's `as` (§5); the R_ARM_THM_JUMP11 probe, a Thumb `b` resolved by `ld` across two
// objects; and whether agbcc and old_agbcc are installed. It assembles this report and decides
// nothing else: the exit code is the CLI's. It reads no stdin, and every temporary file it makes is
// under os.tmpdir() and removed.
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { armCoverage, compareCorpusFile, CORPUS_ISA, corpusFiles, DEFAULT_CORPUS_OPTIONS, summarizeCorpus } from '../../foundation/isa/corpus.ts';
import type { CorpusComparison } from '../../foundation/isa/corpus-compare.ts';
import type { CorpusFile, CorpusOptions, CorpusSectionSummary, CorpusSummary } from '../../foundation/isa/corpus.ts';
import { RAW_REASONS } from '../../foundation/isa/types.ts';
import type { RawReason } from '../../foundation/isa/types.ts';
import { hex } from '../../foundation/util/hex.ts';
import { ShellCodes } from '../codes.ts';
import { sha256Of } from '../hash.ts';
import { assembleWithBinutils, binutilsVersions, findBinutils, findExecutable, linkWithBinutils } from './binutils.ts';
import type { Binutils } from './binutils.ts';

export type DoctorCheckId = 'binutils' | 'corpus' | 'thumb-jump11' | 'agbcc' | 'old_agbcc';
export type DoctorStatus = 'ok' | 'missing' | 'fail';

export interface DoctorCheck {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export interface DoctorReport {
  /** One check per id, in the order of DOCTOR_CHECK_IDS. */
  readonly checks: readonly DoctorCheck[];
  readonly diagnostics: readonly Diagnostic[];
  /** Whether binutils, corpus and thumb-jump11 are all ok; agbcc and old_agbcc are only reported. */
  readonly ok: boolean;
}

export interface DoctorOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where `tools/agbcc/bin/{agbcc,old_agbcc}` is looked for when the compilers are not on the PATH. */
  readonly cwd: string;
  /** The CI-size corpus (an ARM sample of 2^20 words) instead of the default 65,536. */
  readonly full?: boolean;
  /** Overrides the ARM sample size of the corpus (tests use a small one). */
  readonly armSample?: number;
}

/** The checks of every report, in report order. */
export const DOCTOR_CHECK_IDS: readonly DoctorCheckId[] = ['binutils', 'corpus', 'thumb-jump11', 'agbcc', 'old_agbcc'];

/** The checks that must be ok for the toolchain to build a romlift project. */
export const DOCTOR_REQUIRED: readonly DoctorCheckId[] = ['binutils', 'corpus', 'thumb-jump11'];

/** The ARM sample of the default corpus; `full` uses the CI size, DEFAULT_CORPUS_OPTIONS.armSample. */
export const DOCTOR_ARM_SAMPLE = 65_536;

interface Outcome {
  readonly check: DoctorCheck;
  readonly diagnostics: readonly Diagnostic[];
}

function outcome(id: DoctorCheckId, status: DoctorStatus, detail: string, diagnostics: readonly Diagnostic[] = []): Outcome {
  return { check: { id, status, detail }, diagnostics };
}

// ---------------------------------------------------------------------------------------------------
// binutils

async function binutilsCheck(tools: Binutils | Diagnostic): Promise<Outcome & { readonly as: string }> {
  if ('code' in tools) return { ...outcome('binutils', 'missing', tools.message, [tools]), as: '' };
  const versions = await binutilsVersions(tools);
  const names = ['as', 'ld', 'objcopy'] as const;
  const silent = names.filter((name) => versions[name] === '');
  const detail = names.map((name) => `${name} ${tools[name]}: ${versions[name] === '' ? '(no version)' : versions[name]}`).join('; ');
  if (silent.length === 0) return { ...outcome('binutils', 'ok', detail), as: versions.as };
  const message = `--version failed for ${silent.map((name) => `arm-none-eabi-${name}`).join(', ')}`;
  return { ...outcome('binutils', 'fail', detail, [diagnostic(ShellCodes, 'E_TOOLCHAIN_FAILED', message)]), as: versions.as };
}

// ---------------------------------------------------------------------------------------------------
// corpus

/** Assembles and compares the files with at most `limit` assemblers running, keeping file order. */
async function compareAll(files: Iterable<CorpusFile>, tools: Binutils, limit: number): Promise<CorpusComparison[]> {
  const results: CorpusComparison[] = [];
  const running = new Set<Promise<void>>();
  let index = 0;
  for (const file of files) {
    const at = index++;
    const task = assembleWithBinutils(file.text, { mode: file.mode, tools, files: { 'include/macros.inc': DIALECT.macrosInc } }).then((result) => {
      const stderr = result.ok ? '' : result.stderr === '' ? result.diagnostics.map((d) => d.message).join('\n') : result.stderr;
      results[at] = compareCorpusFile(file, result.ok ? { ok: true, bytes: result.bytes } : { ok: false, stderr });
    });
    const tracked: Promise<void> = task.finally(() => running.delete(tracked));
    running.add(tracked);
    if (running.size >= limit) await Promise.race(running);
  }
  await Promise.all(running);
  return results;
}

function rawCounts(sections: readonly CorpusSectionSummary[]): Record<RawReason, number> {
  const out: Record<RawReason, number> = { undefined: 0, unpredictable: 0, 'sbz-set': 0, 'as-alias': 0, 'no-roundtrip': 0 };
  for (const s of sections) for (const r of RAW_REASONS) out[r] += s.rawByReason[r];
  return out;
}

/** `N cases (thumb …, bl …, arm …); disagreements: as N, encoder N, context N; raw: <reason> N, …`. */
export function corpusDetail(summary: CorpusSummary): string {
  const { thumb, bl, arm } = summary.sections;
  const sections = [thumb, bl, arm];
  const cases = sections.reduce((n, s) => n + s.cases, 0);
  const asDisagree = sections.reduce((n, s) => n + s.disagree, 0);
  const raw = rawCounts(sections);
  const parts = [
    `${cases} cases (thumb ${thumb.cases}, bl ${bl.cases}, arm ${arm.cases}; ARM sample ${summary.options.armSample})`,
    `disagreements: as ${asDisagree}, encoder ${summary.encoderAgrees.disagree}, context ${summary.context.disagree}`,
    `raw: ${RAW_REASONS.map((r) => `${r} ${raw[r]}`).join(', ')}`,
  ];
  const first = [...thumb.examples, ...bl.examples, ...arm.examples, ...summary.encoderAgrees.examples, ...summary.context.examples][0];
  if (first !== undefined) parts.push(`first: ${first.text} (${first.word}) expected ${first.expected}, got ${first.got}`);
  return parts.join('; ');
}

/** The corpus options of a run: the default ARM sample, the CI size with `full`, or the override. */
export function doctorCorpusOptions(options: Pick<DoctorOptions, 'full' | 'armSample'>): CorpusOptions {
  const armSample = options.armSample ?? (options.full === true ? DEFAULT_CORPUS_OPTIONS.armSample : DOCTOR_ARM_SAMPLE);
  return { ...DEFAULT_CORPUS_OPTIONS, armSample };
}

async function corpusCheck(tools: Binutils, asVersion: string, options: CorpusOptions): Promise<Outcome> {
  const comparisons = await compareAll(corpusFiles(CORPUS_ISA, options), tools, Math.max(2, availableParallelism()));
  const summary = summarizeCorpus(comparisons, {
    inputsDigest: sha256Of(`${asVersion}\0${JSON.stringify(options)}`),
    as: asVersion,
    options,
    coverage: armCoverage(CORPUS_ISA),
    armRows: CORPUS_ISA.specs('arm').map((s) => s.id),
  });
  return outcome('corpus', summary.ok ? 'ok' : 'fail', corpusDetail(summary));
}

// ---------------------------------------------------------------------------------------------------
// thumb-jump11: a Thumb `b` to a global of another object, resolved by ld through R_ARM_THM_JUMP11.

/** The linked address of the probe's `.text`. */
const PROBE_BASE = 0x0800_0000;
/** The forward distance from the branch's PC (its address + 4) to the target: the largest JUMP11 reaches. */
const PROBE_DISTANCE = 2046;
/** Where the target lies: the branch is the first halfword at PROBE_BASE. */
const PROBE_TARGET = PROBE_BASE + 4 + PROBE_DISTANCE;
/** The size of the first object's `.text`: the branch, then a pad that keeps the second object word aligned. */
const PROBE_BRANCH_SIZE = 4;

/** The Thumb `b` (format 18) encoding of a branch at `from` to `to`. */
export function thumbBranch(from: number, to: number): number {
  return 0xe000 | (((to - (from + 4)) >> 1) & 0x7ff);
}

const PROBE_SOURCES = [
  { name: 'branch', mode: 'thumb', text: '.syntax unified\n.thumb\n.text\n\t.global _start\n_start:\n\tb probe_target\n\tmov r8, r8\n' },
  {
    name: 'target',
    mode: 'thumb',
    text: `.syntax unified\n.thumb\n.text\n\t.space ${PROBE_TARGET - PROBE_BASE - PROBE_BRANCH_SIZE}\n\t.global probe_target\nprobe_target:\n\tbx lr\n`,
  },
] as const;

const PROBE_SCRIPT = [
  'SECTIONS',
  '{',
  `  . = 0x${hex(PROBE_BASE, 8)};`,
  '  .text : { branch.o(.text) target.o(.text) }',
  '  /DISCARD/ : { *(*) }',
  '}',
  '',
].join('\n');

async function jump11Check(tools: Binutils): Promise<Outcome> {
  const expected = thumbBranch(PROBE_BASE, PROBE_TARGET);
  const size = PROBE_TARGET - PROBE_BASE + 2;
  const what = `b at 0x${hex(PROBE_BASE, 8)} to a global of another object at 0x${hex(PROBE_TARGET, 8)}`;
  const linked = await linkWithBinutils(PROBE_SOURCES, { script: PROBE_SCRIPT, tools });
  if (!linked.ok) {
    const reason = linked.stderr.trim().split('\n')[0] ?? '';
    return outcome('thumb-jump11', 'fail', `${what}: ${linked.diagnostics[0]?.message ?? 'failed'}${reason === '' ? '' : `: ${reason}`}`, linked.diagnostics);
  }
  if (linked.bytes.length !== size) {
    return outcome('thumb-jump11', 'fail', `${what}: linked .text is ${linked.bytes.length} bytes, expected ${size}`);
  }
  const got = (linked.bytes[0] ?? 0) | ((linked.bytes[1] ?? 0) << 8);
  const status = got === expected ? 'ok' : 'fail';
  return outcome('thumb-jump11', status, `${what}: expected 0x${hex(expected, 4)}, got 0x${hex(got, 4)}`);
}

// ---------------------------------------------------------------------------------------------------
// agbcc and old_agbcc: reported, never required in phase 1.

function compilerCheck(id: 'agbcc' | 'old_agbcc', env: Readonly<Record<string, string | undefined>>, cwd: string): Outcome {
  const onPath = findExecutable(id, env);
  if (onPath !== undefined) return outcome(id, 'ok', `${onPath} (PATH)`);
  const bin = join(cwd, 'tools', 'agbcc', 'bin');
  const inTree = findExecutable(id, { PATH: bin });
  if (inTree !== undefined) return outcome(id, 'ok', inTree);
  return outcome(id, 'missing', `not on the PATH nor at ${join(bin, id)}`);
}

// ---------------------------------------------------------------------------------------------------

function needsBinutils(id: DoctorCheckId): Outcome {
  return outcome(id, 'missing', 'needs arm-none-eabi binutils');
}

/** Runs every check and returns the report; never throws for a missing or failing tool. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const tools = findBinutils(options.env);
  const binutils = await binutilsCheck(tools);
  const usable = !('code' in tools) && binutils.check.status === 'ok';
  const corpus = usable ? await corpusCheck(tools, binutils.as, doctorCorpusOptions(options)) : needsBinutils('corpus');
  const jump11 = usable ? await jump11Check(tools) : needsBinutils('thumb-jump11');
  const outcomes = [binutils, corpus, jump11, compilerCheck('agbcc', options.env, options.cwd), compilerCheck('old_agbcc', options.env, options.cwd)];
  const checks = outcomes.map((o) => o.check);
  return {
    checks,
    diagnostics: outcomes.flatMap((o) => o.diagnostics),
    ok: checks.every((c) => !DOCTOR_REQUIRED.includes(c.id) || c.status === 'ok'),
  };
}
