// The round-trip corpus driver (architecture §5, `npm run corpus`):
//
//   npm run corpus [-- --json] [--out <dir>] [--arm-sample <n>] [--reuse]
//
// Generates the corpus files of src/foundation/isa/corpus.ts into bench/.local/corpus/ (gitignored;
// corpus text is never committed), assembles each with the PATH's arm-none-eabi-as through
// assembleWithBinutils, compares the bytes case by case, writes summary.json (the frozen
// `romlift/corpus-summary@1` contract) and prints a human summary, or the JSON with --json. Exits 0
// only when the summary is ok. --reuse prints the cached summary instead when its inputsDigest still
// matches: sha256 over the path-sorted contents of src/foundation/isa/**, src/foundation/asm/dialect.ts
// and test/corpus/**, the first line of `as --version`, and the options.
import { availableParallelism } from 'node:os';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { armCoverage, compareCorpusFile, CORPUS_ISA, corpusFiles, DEFAULT_CORPUS_OPTIONS, summarizeCorpus } from '../../src/foundation/isa/corpus.ts';
import type { CorpusComparison } from '../../src/foundation/isa/corpus-compare.ts';
import type { CorpusFile, CorpusOptions, CorpusSectionSummary, CorpusSummary } from '../../src/foundation/isa/corpus.ts';
import { DIALECT } from '../../src/foundation/asm/dialect.ts';
import { RAW_REASONS } from '../../src/foundation/isa/types.ts';
import { compareCodeUnits } from '../../src/foundation/util/sorted.ts';
import { listDir } from '../../src/shell/fs.ts';
import { sha256Stream } from '../../src/shell/hash.ts';
import { assembleWithBinutils, binutilsVersions, findBinutils } from '../../src/shell/toolchain/binutils.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DIGEST_INPUTS: readonly string[] = ['src/foundation/isa', 'src/foundation/asm/dialect.ts', 'test/corpus'];

/** Every file under `rel` (or `rel` itself), repository-relative with '/' separators. */
async function filesUnder(rel: string): Promise<string[]> {
  const absolute = path.join(REPO, rel);
  const info = await stat(absolute);
  if (info.isFile()) return [rel];
  const listed = await listDir(absolute);
  if (!listed.ok) throw new Error(listed.diagnostic.message);
  const out: string[] = [];
  for (const name of listed.value) out.push(...(await filesUnder(`${rel}/${name}`)));
  return out;
}

async function inputsDigest(asVersion: string, options: CorpusOptions): Promise<string> {
  const files = (await Promise.all(DIGEST_INPUTS.map(filesUnder))).flat().sort(compareCodeUnits);
  const chunks: (string | Uint8Array)[] = [];
  for (const file of files) chunks.push(`${file}\0`, await readFile(path.join(REPO, file)), '\0');
  chunks.push(`as\0${asVersion}\0options\0${JSON.stringify(options)}\0`);
  return sha256Stream(chunks);
}

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(2)}%`;
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

function sectionLine(name: string, s: CorpusSectionSummary): string {
  const reasons = RAW_REASONS.map((r) => `${r} ${count(s.rawByReason[r])}`).join(', ');
  return [
    `${name.padEnd(6)}${count(s.cases).padStart(10)} cases: ${count(s.mnemonic)} mnemonic, ${count(s.raw)} raw; ${count(s.agree)} agree (${percent(s.agree, s.cases)}), ${count(s.disagree)} disagree`,
    `      raw by reason: ${reasons}`,
    ...s.examples.slice(0, 5).map((e) => `      disagrees at +0x${e.offset.toString(16)}: ${e.text} (${e.word}): expected ${e.expected}, got ${e.got}`),
  ].join('\n');
}

function human(summary: CorpusSummary, seconds: number | undefined): string {
  const { thumb, bl, arm } = summary.sections;
  const printed = (s: CorpusSectionSummary): string => percent(s.mnemonic - Math.min(s.mnemonic, s.disagree), s.mnemonic);
  return [
    `corpus (${summary.as}; seed ${summary.options.seed}, ARM sample ${count(summary.options.armSample)}, bl sample ${count(summary.options.blSample)})`,
    sectionLine('thumb', thumb),
    sectionLine('bl', bl),
    sectionLine('arm', arm),
    `printed mnemonics round-tripping through as: thumb ${printed(thumb)}, bl ${printed(bl)}, arm ${printed(arm)}`,
    `encoder agrees with as: ${count(summary.encoderAgrees.checked)} checked, ${count(summary.encoderAgrees.disagree)} disagree`,
    `context: ${count(summary.context.checked)} address-dependent cases at ${summary.context.alignments.join(' and ')}, ${count(summary.context.extremes)} at offset extremes, ${count(summary.context.disagree)} disagree`,
    ...summary.encoderAgrees.examples.slice(0, 5).map((e) => `      encoder: ${e.text}: expected ${e.expected}, got ${e.got}`),
    ...summary.context.examples.slice(0, 5).map((e) => `      context: ${e.text}: expected ${e.expected}, got ${e.got}`),
    `ARM rows with coverage: ${Object.keys(arm.coverage).length}`,
    `${summary.ok ? 'ok' : 'FAILED'}${seconds === undefined ? ' (cached)' : ` in ${seconds.toFixed(1)} s`}`,
  ].join('\n');
}

async function readCached(file: string): Promise<CorpusSummary | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as CorpusSummary;
  } catch {
    return undefined;
  }
}

/** Assembles and compares the files with at most `limit` assemblers running, keeping file order. */
async function compareAll(files: Iterable<CorpusFile>, out: string, limit: number): Promise<CorpusComparison[]> {
  const results: CorpusComparison[] = [];
  const running = new Set<Promise<void>>();
  let index = 0;
  for (const file of files) {
    const at = index++;
    await writeFile(path.join(out, file.name), file.text);
    const task = assembleWithBinutils(file.text, { mode: file.mode, files: { 'include/macros.inc': DIALECT.macrosInc } }).then((result) => {
      results[at] = compareCorpusFile(file, result.ok ? { ok: true, bytes: result.bytes } : { ok: false, stderr: result.stderr || result.diagnostics.map((d) => d.message).join('\n') });
    });
    const tracked: Promise<void> = task.finally(() => running.delete(tracked));
    running.add(tracked);
    if (running.size >= limit) await Promise.race(running);
  }
  await Promise.all(running);
  return results;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string', default: path.join(REPO, 'bench/.local/corpus') },
      'arm-sample': { type: 'string' },
      reuse: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const armSample = values['arm-sample'] === undefined ? DEFAULT_CORPUS_OPTIONS.armSample : Number(values['arm-sample']);
  if (!Number.isInteger(armSample) || armSample < 0) {
    process.stderr.write(`--arm-sample must be a non-negative integer, got ${values['arm-sample'] ?? ''}\n`);
    return 2;
  }
  const options: CorpusOptions = { ...DEFAULT_CORPUS_OPTIONS, armSample };
  const tools = findBinutils(process.env);
  if ('code' in tools) {
    process.stderr.write(`${tools.code}: ${tools.message}\n`);
    return 1;
  }
  const asVersion = (await binutilsVersions(tools)).as;
  const digest = await inputsDigest(asVersion, options);
  const out = path.resolve(values.out);
  const summaryFile = path.join(out, 'summary.json');

  if (values.reuse) {
    const cached = await readCached(summaryFile);
    if (cached !== undefined && cached.inputsDigest === digest) {
      process.stdout.write(`${values.json ? JSON.stringify(cached, null, 2) : human(cached, undefined)}\n`);
      return cached.ok ? 0 : 1;
    }
  }

  // Clear only what an earlier run wrote: the corpus files and the summary.
  await mkdir(out, { recursive: true });
  const old = await listDir(out);
  for (const name of old.ok ? old.value : []) {
    if (name.endsWith('.s') || name === 'summary.json') await rm(path.join(out, name), { force: true });
  }
  const started = performance.now();
  const comparisons = await compareAll(corpusFiles(CORPUS_ISA, options), out, Math.max(2, availableParallelism()));
  const summary = summarizeCorpus(comparisons, {
    inputsDigest: digest,
    as: asVersion,
    options,
    coverage: armCoverage(CORPUS_ISA),
    armRows: CORPUS_ISA.specs('arm').map((s) => s.id),
  });
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  const seconds = (performance.now() - started) / 1000;
  process.stdout.write(`${values.json ? JSON.stringify(summary, null, 2) : human(summary, seconds)}\n`);
  return summary.ok ? 0 : 1;
}

process.exitCode = await main();
