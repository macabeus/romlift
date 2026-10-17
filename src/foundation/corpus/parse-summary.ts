// The structural reader of a persisted corpus summary (`romlift/corpus-summary@1`, written by
// `npm run corpus` and carried by bench/results.json): every field is checked against the contract,
// so a reader gets a CorpusSummary or a precise reason, never a cast.
import { RAW_REASONS } from '../isa/types.ts';
import type { RawReason } from '../isa/types.ts';
import { CORPUS_SUMMARY_SCHEMA } from './types.ts';
import type { Alignment, ArmCoverage, CorpusExample, CorpusOptions, CorpusSectionSummary, CorpusSummary } from './types.ts';

type JsonObject = Readonly<Record<string, unknown>>;

class Invalid extends Error {
  override readonly name = 'Invalid';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, at: string): JsonObject {
  if (!isObject(value)) throw new Invalid(`${at} is not an object`);
  return value;
}

function list(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Invalid(`${at} is not a list`);
  return value;
}

function count(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Invalid(`${at} is not a count`);
  return value;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Invalid(`${at} is not a string`);
  return value;
}

function strings(value: unknown, at: string): readonly string[] {
  return list(value, at).map((v, i) => text(v, `${at}[${i}]`));
}

function example(value: unknown, at: string): CorpusExample {
  const r = record(value, at);
  return { offset: count(r['offset'], `${at}.offset`), word: text(r['word'], `${at}.word`), text: text(r['text'], `${at}.text`), expected: text(r['expected'], `${at}.expected`), got: text(r['got'], `${at}.got`) };
}

function examples(value: unknown, at: string): readonly CorpusExample[] {
  return list(value, at).map((v, i) => example(v, `${at}[${i}]`));
}

function rawCounts(value: unknown, at: string): Readonly<Record<RawReason, number>> {
  const r = record(value, at);
  const extra = Object.keys(r).find((k) => !RAW_REASONS.some((reason) => reason === k));
  if (extra !== undefined) throw new Invalid(`${at} has the unknown reason '${extra}'`);
  const n = (reason: RawReason): number => count(r[reason], `${at}.${reason}`);
  return { undefined: n('undefined'), unpredictable: n('unpredictable'), 'sbz-set': n('sbz-set'), 'as-alias': n('as-alias'), 'no-roundtrip': n('no-roundtrip') };
}

function section(value: unknown, at: string): CorpusSectionSummary {
  const r = record(value, at);
  return {
    cases: count(r['cases'], `${at}.cases`),
    mnemonic: count(r['mnemonic'], `${at}.mnemonic`),
    raw: count(r['raw'], `${at}.raw`),
    agree: count(r['agree'], `${at}.agree`),
    disagree: count(r['disagree'], `${at}.disagree`),
    rawByReason: rawCounts(r['rawByReason'], `${at}.rawByReason`),
    examples: examples(r['examples'], `${at}.examples`),
  };
}

function coverage(value: unknown, at: string): ArmCoverage {
  const out: Record<string, { readonly exhaustive: readonly string[]; readonly sampled: readonly string[] }> = {};
  for (const [id, entry] of Object.entries(record(value, at))) {
    const r = record(entry, `${at}.${id}`);
    out[id] = { exhaustive: strings(r['exhaustive'], `${at}.${id}.exhaustive`), sampled: strings(r['sampled'], `${at}.${id}.sampled`) };
  }
  return out;
}

function alignment(value: unknown, at: string): Alignment {
  if (value === '0-mod-4' || value === '2-mod-4') return value;
  throw new Invalid(`${at} is not an alignment`);
}

function options(value: unknown, at: string): CorpusOptions {
  const r = record(value, at);
  return { seed: count(r['seed'], `${at}.seed`), armSample: count(r['armSample'], `${at}.armSample`), blSample: count(r['blSample'], `${at}.blSample`) };
}

function summary(value: unknown): CorpusSummary {
  const r = record(value, 'the summary');
  if (r['schema'] !== CORPUS_SUMMARY_SCHEMA) throw new Invalid(`schema is not '${CORPUS_SUMMARY_SCHEMA}'`);
  const sections = record(r['sections'], 'sections');
  const arm = record(sections['arm'], 'sections.arm');
  const encoder = record(r['encoderAgrees'], 'encoderAgrees');
  const context = record(r['context'], 'context');
  if (typeof r['ok'] !== 'boolean') throw new Invalid('ok is not a boolean');
  return {
    schema: CORPUS_SUMMARY_SCHEMA,
    inputsDigest: text(r['inputsDigest'], 'inputsDigest'),
    as: text(r['as'], 'as'),
    options: options(r['options'], 'options'),
    sections: {
      thumb: section(sections['thumb'], 'sections.thumb'),
      bl: section(sections['bl'], 'sections.bl'),
      arm: { ...section(arm, 'sections.arm'), coverage: coverage(arm['coverage'], 'sections.arm.coverage') },
    },
    encoderAgrees: { checked: count(encoder['checked'], 'encoderAgrees.checked'), disagree: count(encoder['disagree'], 'encoderAgrees.disagree'), examples: examples(encoder['examples'], 'encoderAgrees.examples') },
    context: {
      checked: count(context['checked'], 'context.checked'),
      disagree: count(context['disagree'], 'context.disagree'),
      alignments: list(context['alignments'], 'context.alignments').map((a, i) => alignment(a, `context.alignments[${i}]`)),
      extremes: count(context['extremes'], 'context.extremes'),
      examples: examples(context['examples'], 'context.examples'),
    },
    ok: r['ok'],
  };
}

/** The summary `value` holds, or why it is not a `romlift/corpus-summary@1`. */
export function parseCorpusSummary(value: unknown): { readonly ok: true; readonly value: CorpusSummary } | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: summary(value) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}
