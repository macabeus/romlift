// The round-trip corpus driver (architecture §5, `npm run corpus`):
//
//   npm run corpus [-- --json] [--out <dir>] [--arm-sample <n>] [--reuse]
//
// Runs the corpus through romlift's runCorpus (the same run `romlift doctor` makes) with the PATH's
// arm-none-eabi-as, writing every corpus file into bench/.local/corpus/ (gitignored; corpus text is
// never committed), then writes summary.json (the frozen `romlift/corpus-summary@1` contract) and
// prints a human summary, or with --json the summary as one JSON line (§2.1: --json output parses
// line by line). Exits 0 only when the summary is ok. --reuse prints the cached summary instead when
// its inputsDigest is still current; the digest is romlift's corpusInputsDigest (D55), the one the
// bench checks before results.json carries the summary as its printer family.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { binutilsVersions, findBinutils, listDir } from 'romlift/node';
import { corpusInputsDigest, corpusSummary, DEFAULT_CORPUS_OPTIONS, parseCorpusSummary, runCorpus } from 'romlift/internal';
import type { CorpusOptions, CorpusSectionSummary, CorpusSummary } from 'romlift/internal';
import { RAW_REASONS } from 'romlift/isa';

import { parseArgs, UsageError } from '../../bench/src/args.ts';
import type { BenchArgs } from '../../bench/src/args.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${((100 * part) / whole).toFixed(2)}%`;
}

/** A count with a comma every three digits, independent of the locale. */
function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
  // Exact when nothing disagrees; otherwise a lower bound (every disagreeing case counted as a mnemonic).
  const printed = (s: CorpusSectionSummary): string =>
    `${s.disagree === 0 ? '' : 'at least '}${percent(s.mnemonic - Math.min(s.mnemonic, s.disagree), s.mnemonic)}`;
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
    `inputs digest ${summary.inputsDigest}`,
    `${summary.ok ? 'ok' : 'FAILED'}${seconds === undefined ? ' (cached)' : ` in ${seconds.toFixed(1)} s`}`,
  ].join('\n');
}

async function readCached(file: string): Promise<CorpusSummary | undefined> {
  try {
    const parsed = parseCorpusSummary(JSON.parse(await readFile(file, 'utf8')));
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

const USAGE = 'usage: npm run corpus [-- --json] [--out <dir>] [--arm-sample <n>] [--reuse]';

async function main(argv: readonly string[]): Promise<number> {
  let args: BenchArgs;
  try {
    args = parseArgs(argv, { options: ['out', 'arm-sample'], flags: ['json', 'reuse'] });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    return 2;
  }
  const json = args.flags.has('json');
  const sampleText = args.options['arm-sample'];
  const armSample = sampleText === undefined ? DEFAULT_CORPUS_OPTIONS.armSample : Number(sampleText);
  if (!Number.isInteger(armSample) || armSample < 0) {
    process.stderr.write(`--arm-sample must be a non-negative integer, got ${sampleText ?? ''}\n`);
    return 2;
  }
  const options: CorpusOptions = { ...DEFAULT_CORPUS_OPTIONS, armSample };
  const tools = findBinutils(process.env);
  if ('code' in tools) {
    process.stderr.write(`${tools.code}: ${tools.message}\n`);
    return 1;
  }
  const asVersion = (await binutilsVersions(tools)).as;
  const inputsDigest = await corpusInputsDigest(REPO, asVersion, options);
  const out = path.resolve(args.options['out'] ?? path.join(REPO, 'bench/.local/corpus'));
  const summaryFile = path.join(out, 'summary.json');

  if (args.flags.has('reuse')) {
    const cached = await readCached(summaryFile);
    if (cached !== undefined && cached.inputsDigest === inputsDigest) {
      process.stdout.write(`${json ? JSON.stringify(cached) : human(cached, undefined)}\n`);
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
  const run = await runCorpus({ options, tools, onFile: (file) => writeFile(path.join(out, file.name), file.text) });
  const summary = corpusSummary({ inputsDigest, as: asVersion, options }, run.counts, run.ok);
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  const seconds = (performance.now() - started) / 1000;
  process.stdout.write(`${json ? JSON.stringify(summary) : human(summary, seconds)}\n`);
  return summary.ok ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
