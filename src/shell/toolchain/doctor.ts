// `romlift doctor` (architecture §2.1, roadmap 1.C): what the user's toolchain can do for romlift. Five
// checks, always in this order: the binutils and their versions; the round-trip corpus re-assembled
// with the user's `as` (§5, runCorpus); the R_ARM_THM_JUMP11 probe, a Thumb `b` resolved by `ld`
// across two objects; and whether agbcc and old_agbcc are installed. It runs the tools and reports
// what they did; which checks count, the corpus threshold and the verdict are core/workflow/doctor.ts's
// (D55). It reads no stdin, and every temporary file it makes is under os.tmpdir() and removed.
import { join } from 'node:path';

import { DIALECT } from '../../foundation/asm/dialect.ts';
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { DEFAULT_CORPUS_OPTIONS, mergeSections } from '../../foundation/corpus/corpus.ts';
import type { CorpusCounts, CorpusOptions } from '../../foundation/corpus/corpus.ts';
import { encode } from '../../foundation/isa/encode.ts';
import { branchOffset, pcOf } from '../../foundation/isa/pc-relative.ts';
import { specOf } from '../../foundation/isa/rows.ts';
import { RAW_REASONS } from '../../foundation/isa/types.ts';
import { hex } from '../../foundation/util/hex.ts';
import { doctorVerdict } from '../../core/workflow/doctor.ts';
import type { DoctorCheck, DoctorCheckId, DoctorStatus, DoctorVerdict } from '../../core/workflow/doctor.ts';
import { ShellCodes } from '../codes.ts';
import { binutilsVersions, findBinutils, findExecutable, linkWithBinutils } from './binutils.ts';
import type { Binutils } from './binutils.ts';
import { runCorpus } from './corpus.ts';

export interface DoctorReport {
  /** One check per id, in the order of DOCTOR_CHECK_IDS. */
  readonly checks: readonly DoctorCheck[];
  readonly diagnostics: readonly Diagnostic[];
  /** doctorVerdict(checks). */
  readonly verdict: DoctorVerdict;
}

export interface DoctorOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where `tools/agbcc/bin/{agbcc,old_agbcc}` is looked for when the compilers are not on the PATH. */
  readonly cwd: string;
  /** The CI-size corpus (an ARM sample of 2^20 words) instead of the default 65,536. */
  readonly full?: boolean;
}

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

/** `N cases (thumb …, bl …, arm …); disagreements: as N, encoder N, context N; raw: <reason> N, …`. */
export function corpusDetail(counts: CorpusCounts, options: CorpusOptions): string {
  const { thumb, bl, arm } = counts.sections;
  const total = mergeSections([thumb, bl, arm]);
  const parts = [
    `${total.cases} cases (thumb ${thumb.cases}, bl ${bl.cases}, arm ${arm.cases}; ARM sample ${options.armSample})`,
    `disagreements: as ${total.disagree}, encoder ${counts.encoderAgrees.disagree}, context ${counts.context.disagree}`,
    `raw: ${RAW_REASONS.map((r) => `${r} ${total.rawByReason[r]}`).join(', ')}`,
  ];
  const first = [...thumb.examples, ...bl.examples, ...arm.examples, ...counts.encoderAgrees.examples, ...counts.context.examples][0];
  if (first !== undefined) parts.push(`first: ${first.text} (${first.word}) expected ${first.expected}, got ${first.got}`);
  return parts.join('; ');
}

/** The corpus options of a run: the default ARM sample, or the CI size with `full`. */
export function doctorCorpusOptions(full: boolean): CorpusOptions {
  return { ...DEFAULT_CORPUS_OPTIONS, armSample: full ? DEFAULT_CORPUS_OPTIONS.armSample : DOCTOR_ARM_SAMPLE };
}

async function corpusCheck(tools: Binutils, options: CorpusOptions): Promise<Outcome> {
  const run = await runCorpus({ options, tools });
  return outcome('corpus', run.ok ? 'ok' : 'fail', corpusDetail(run.counts, options));
}

// ---------------------------------------------------------------------------------------------------
// thumb-jump11: a Thumb `b` to a global of another object, resolved by ld through R_ARM_THM_JUMP11.
// Both sources are written as the writers write them: DIALECT.preamble and the macros.inc function
// starts.

/** The linked address of the probe's `.text`. */
const PROBE_BASE = 0x0800_0000;
/** The forward distance from the branch's PC (its address + 4) to the target: the largest JUMP11 reaches. */
const PROBE_DISTANCE = 2046;
/** Where the target lies: the branch is the first halfword at PROBE_BASE. */
const PROBE_TARGET = pcOf(PROBE_BASE, 'thumb') + PROBE_DISTANCE;
/** The size of the first object's `.text`: the branch, then a pad that keeps the second object word aligned. */
const PROBE_BRANCH_SIZE = 4;

/** The word the probe's `b` must link to: the table's Thumb `b` with the offset to PROBE_TARGET. */
export const JUMP11_EXPECTED: number = (() => {
  const imm = branchOffset(pcOf(PROBE_BASE, 'thumb'), PROBE_TARGET, 11, 2);
  if (imm === undefined) throw new RomliftInvariantError('the JUMP11 probe target is out of b range');
  return encode(specOf('thumb.b'), { imm });
})();

const PROBE_SOURCES = [
  { name: 'branch', mode: 'thumb', text: `${DIALECT.preamble('thumb')}\t.text\n\tthumb_func_start _start\n_start:\n\tb probe_target\n\tmov r8, r8\n` },
  {
    name: 'target',
    mode: 'thumb',
    text: `${DIALECT.preamble('thumb')}\t.text\n\t.space ${PROBE_TARGET - PROBE_BASE - PROBE_BRANCH_SIZE}\n\tnon_word_aligned_thumb_func_start probe_target\nprobe_target:\n\tbx lr\n`,
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
  const expected = JUMP11_EXPECTED;
  const size = PROBE_TARGET - PROBE_BASE + 2;
  const what = `b at 0x${hex(PROBE_BASE, 8)} to a global of another object at 0x${hex(PROBE_TARGET, 8)}`;
  const linked = await linkWithBinutils(PROBE_SOURCES, { script: PROBE_SCRIPT, tools, files: { 'include/macros.inc': DIALECT.macrosInc } });
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

/** Runs every check with the corpus `options` (doctorCorpusOptions) and returns the report; never throws for a missing or failing tool. */
export async function runDoctorWith(options: Omit<DoctorOptions, 'full'>, corpus: CorpusOptions): Promise<DoctorReport> {
  const tools = findBinutils(options.env);
  const binutils = await binutilsCheck(tools);
  const usable = !('code' in tools) && binutils.check.status === 'ok';
  const corpusOutcome = usable ? await corpusCheck(tools, corpus) : needsBinutils('corpus');
  const jump11 = usable ? await jump11Check(tools) : needsBinutils('thumb-jump11');
  const outcomes = [binutils, corpusOutcome, jump11, compilerCheck('agbcc', options.env, options.cwd), compilerCheck('old_agbcc', options.env, options.cwd)];
  const checks = outcomes.map((o) => o.check);
  return { checks, diagnostics: outcomes.flatMap((o) => o.diagnostics), verdict: doctorVerdict(checks) };
}

/** Runs every check and returns the report; never throws for a missing or failing tool. */
export function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  return runDoctorWith(options, doctorCorpusOptions(options.full === true));
}
