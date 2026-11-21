// The synthetic-tier analysis and tree digests of one CI job (architecture §8.6, §13 g3.tree-determinism,
// D30), and their comparison across jobs:
//
//   node --conditions=source bench/tools/ci-digests.ts
//     prints one line {schema: 'romlift-bench/ci-digests@2', node, os, digests: {<fixture>: sha256},
//     trees: {<fixture>: sha256}}: for each committed fixture (bench/dataset/synthetic/<name>/build/<name>.gba),
//     `digests` holds the sha256 of encodeAnalysis of romlift's seedless discover analysis with
//     profileById('agbcc'), and `trees` the digest g3.tree-determinism computes of the tree emitted from it
//     (configFromDiscover, buildModel, emitTree with the readable printer and an empty DecompState): the
//     sha256 over path, NUL, content (a reconciled entry's edits as JSON), NUL, per entry in stream order.
//     Both depend on nothing but the sources and the fixtures, so the line is the same from any working
//     directory, time zone or locale on one machine (ci.yml's determinism run compares two).
//   node --conditions=source bench/tools/ci-digests.ts --compare <file>... [--expect <n>]
//     exit 0 when the files (one per job) hold the same fixtures with the same analysis and tree digests,
//     and there are exactly n of them when --expect is given; exit 1 naming every disagreement otherwise.
import { readFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  type AnalysisResult,
  type CompilerProfile,
  type FileEntry,
  type Rom,
  analyze,
  buildModel,
  compareCodeUnits,
  configFromDiscover,
  emitTree,
  encodeAnalysis,
  profileById,
  romFromBytes,
} from 'romlift';
import { sha1Of, sha256Stream } from 'romlift/node';

import { listFixtures } from '../src/ablate.ts';
import { discoverOptions } from '../src/analysis-run.ts';
import { UsageError, parseArgs } from '../src/args.ts';
import { type BenchContext, contextFromEnv } from '../src/context.ts';
import { BenchError, isRecord, readFileBytes } from '../src/files.ts';

export const CI_DIGESTS_SCHEMA = 'romlift-bench/ci-digests@2';

/** What one job uploads. */
export interface CiDigests {
  readonly schema: typeof CI_DIGESTS_SCHEMA;
  /** process.version of the job, e.g. v24.10.0. */
  readonly node: string;
  /** The job's platform and architecture, e.g. linux-x64. */
  readonly os: string;
  /** sha256 of the encoded analysis, per fixture, in fixture-name order. */
  readonly digests: Readonly<Record<string, string>>;
  /** The g3.tree-determinism digest of the emitted tree, per fixture, in fixture-name order. */
  readonly trees: Readonly<Record<string, string>>;
}

export interface Machine {
  readonly node: string;
  readonly os: string;
}

/** This process's Node version and platform. */
export function thisMachine(): Machine {
  return { node: process.version, os: `${platform()}-${arch()}` };
}

function agbcc(): CompilerProfile {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new BenchError("romlift has no 'agbcc' profile");
  return profile;
}

/** The sha256 of encodeAnalysis of the seedless discover analysis of `bytes` (D24). */
export function fixtureDigest(bytes: Uint8Array, profile: CompilerProfile = agbcc()): string {
  return fixtureDigests(bytes, profile).analysis;
}

function* treeParts(entries: Iterable<FileEntry>): Generator<string> {
  for (const entry of entries)
    yield `${entry.path}\0${entry.ownership === 'reconciled' ? JSON.stringify(entry.edits) : entry.text}\0`;
}

/**
 * The g3.tree-determinism digest of the tree emitted from `analysis`: configFromDiscover, buildModel and
 * emitTree with the readable printer and an empty DecompState, hashed as the sha256 over path, NUL, content
 * (a reconciled entry's edits as JSON), NUL, per entry in stream order.
 */
export function treeDigest(rom: Rom, analysis: AnalysisResult): string {
  const model = buildModel(rom, analysis, configFromDiscover(rom, analysis));
  return sha256Stream(treeParts(emitTree(rom, model, { decomp: { defined: [] } })));
}

/** The analysis digest of `bytes` and the tree digest emitted from the same analysis. */
export function fixtureDigests(
  bytes: Uint8Array,
  profile: CompilerProfile = agbcc(),
): { readonly analysis: string; readonly tree: string } {
  const rom = romFromBytes(bytes, sha1Of(bytes));
  const result = analyze(rom, profile, discoverOptions());
  return { analysis: sha256Stream(encodeAnalysis(result)), tree: treeDigest(rom, result) };
}

/** The digests of every committed fixture of `cx`; refuses a checkout without fixtures. */
export async function collectCiDigests(cx: BenchContext, machine: Machine): Promise<CiDigests> {
  const fixtures = await listFixtures(cx);
  if (fixtures.length === 0) throw new BenchError('no committed fixture under bench/dataset/synthetic');
  const profile = agbcc();
  const digests: Record<string, string> = {};
  const trees: Record<string, string> = {};
  for (const f of fixtures) {
    const both = fixtureDigests(await readFileBytes(f.rom), profile);
    digests[f.name] = both.analysis;
    trees[f.name] = both.tree;
  }
  return { schema: CI_DIGESTS_SCHEMA, node: machine.node, os: machine.os, digests, trees };
}

const SHA256 = /^[0-9a-f]{64}$/;

/** One `{<fixture>: sha256}` member, keys sorted; throws a BenchError naming `where.key`. */
function digestMap(value: unknown, where: string, key: string): Record<string, string> {
  if (!isRecord(value)) throw new BenchError(`${where}: ${key} is not an object`);
  const out: Record<string, string> = {};
  for (const name of Object.keys(value).sort(compareCodeUnits)) {
    const digest = value[name];
    if (typeof digest !== 'string' || !SHA256.test(digest))
      throw new BenchError(`${where}: ${key}.${name} is not a sha256`);
    out[name] = digest;
  }
  if (Object.keys(out).length === 0) throw new BenchError(`${where}: ${key} is empty`);
  return out;
}

/** Reads one uploaded file's JSON; throws a BenchError naming `where` and the first problem. */
export function parseCiDigests(value: unknown, where: string): CiDigests {
  if (!isRecord(value)) throw new BenchError(`${where}: not a JSON object`);
  if (value['schema'] !== CI_DIGESTS_SCHEMA)
    throw new BenchError(`${where}: schema is ${JSON.stringify(value['schema'])}, expected ${CI_DIGESTS_SCHEMA}`);
  const { node, os } = value;
  if (typeof node !== 'string' || node === '') throw new BenchError(`${where}: node is not a non-empty string`);
  if (typeof os !== 'string' || os === '') throw new BenchError(`${where}: os is not a non-empty string`);
  return {
    schema: CI_DIGESTS_SCHEMA,
    node,
    os,
    digests: digestMap(value['digests'], where, 'digests'),
    trees: digestMap(value['trees'], where, 'trees'),
  };
}

export interface JobDigests {
  /** Where the job's digests came from (the uploaded file). */
  readonly source: string;
  readonly report: CiDigests;
}

const jobName = (j: JobDigests): string => `${j.report.os} Node ${j.report.node} (${j.source})`;

/** The two digest kinds a job reports, with the words a disagreement is named by. */
const KINDS: readonly { readonly key: 'digests' | 'trees'; readonly what: string; readonly missing: string }[] = [
  { key: 'digests', what: 'the analysis digests differ', missing: 'missing' },
  { key: 'trees', what: 'the tree digests differ', missing: 'tree digest missing' },
];

/**
 * Every way the jobs disagree: a count other than `expect`, a fixture some job lacks, a fixture whose
 * analysis digest or tree digest differs between jobs. Empty when they all agree.
 */
export function compareCiDigests(jobs: readonly JobDigests[], expect?: number): string[] {
  const problems: string[] = [];
  if (expect !== undefined && jobs.length !== expect)
    problems.push(`${jobs.length} digest file(s), expected ${expect}`);
  if (jobs.length === 0) return problems.length > 0 ? problems : ['no digest file to compare'];
  const names = [
    ...new Set(jobs.flatMap((j) => [...Object.keys(j.report.digests), ...Object.keys(j.report.trees)])),
  ].sort(compareCodeUnits);
  for (const name of names) {
    for (const kind of KINDS) {
      const lacking = jobs.filter((j) => j.report[kind.key][name] === undefined);
      if (lacking.length > 0) problems.push(`${name}: ${kind.missing} on ${lacking.map(jobName).join(', ')}`);
      const seen = new Map<string, JobDigests[]>();
      for (const j of jobs) {
        const digest = j.report[kind.key][name];
        if (digest !== undefined) seen.set(digest, [...(seen.get(digest) ?? []), j]);
      }
      if (seen.size > 1) {
        const groups = [...seen.keys()]
          .sort(compareCodeUnits)
          .map((digest) => `${digest} on ${(seen.get(digest) ?? []).map(jobName).join(', ')}`);
        problems.push(`${name}: ${kind.what}: ${groups.join('; ')}`);
      }
    }
  }
  return problems;
}

async function compareFiles(files: readonly string[], expect: number | undefined): Promise<number> {
  const jobs: JobDigests[] = [];
  for (const file of files) {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(file, 'utf8')) as unknown;
    } catch (error) {
      throw new BenchError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    jobs.push({ source: file, report: parseCiDigests(value, file) });
  }
  const problems = compareCiDigests(jobs, expect);
  if (problems.length > 0) {
    for (const p of problems) process.stdout.write(`${p}\n`);
    return 1;
  }
  const fixtures = Object.keys(jobs[0]?.report.digests ?? {}).length;
  process.stdout.write(
    `${fixtures} fixture analysis and tree digest(s) agree across ${jobs.length} job(s): ${jobs.map((j) => `${j.report.os} Node ${j.report.node}`).join(', ')}\n`,
  );
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['expect'], flags: ['compare'], maxPositionals: Number.MAX_SAFE_INTEGER });
  if (!args.flags.has('compare')) {
    if (args.positionals.length > 0 || args.options['expect'] !== undefined)
      throw new UsageError('files and --expect go with --compare');
    process.stdout.write(`${JSON.stringify(await collectCiDigests(contextFromEnv(process.env), thisMachine()))}\n`);
    return 0;
  }
  const expectText = args.options['expect'];
  const expect = expectText === undefined ? undefined : Number(expectText);
  if (expect !== undefined && (!Number.isInteger(expect) || expect < 1))
    throw new UsageError('--expect takes a positive integer');
  if (args.positionals.length === 0) throw new UsageError('--compare needs the digest files');
  return compareFiles(args.positionals, expect);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    },
  );
}
