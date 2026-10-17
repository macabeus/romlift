// What the corpus contains (architecture §5): every Thumb halfword, PC-relative and branch forms at
// both alignments, the offset extremes of b, bcc, Thumb ldr [pc, #imm], adr, bl and the ARM pc-relative
// forms (the ends of each range, and one step past them in files `as` must reject), every bl prefix
// with boundary suffixes plus a seeded bl sample, every ARM row swept field by field with all 16
// conditions, and a seeded ARM sample.
import type { Mode } from '../rom/span.ts';
import { prngSequence, xorshift32 } from '../util/prng.ts';
import { fileBuilder, probeFile } from './corpus-layout.ts';
import type { FileBuilder } from './corpus-layout.ts';
import { CASES_PER_FILE } from './corpus-types.ts';
import type { ArmCoverage, CorpusFile, CorpusIsa, CorpusOptions, CorpusSection, Extreme } from './corpus-types.ts';
import type { Field, InsnSpec } from './types.ts';

/** A seed for one part of the corpus, derived from the corpus seed (xorshift32 needs it nonzero). */
function seedFor(seed: number, salt: number): number {
  return ((seed ^ salt) >>> 0) || 1;
}

function name(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(3, '0')}.s`;
}

/** Files of at most CASES_PER_FILE cases, each case added by `add` from one item. */
function* chunked<T>(
  isa: CorpusIsa,
  mode: Mode,
  section: CorpusSection,
  prefix: string,
  items: Iterable<T>,
  add: (builder: FileBuilder, item: T) => void,
): Generator<CorpusFile> {
  let index = 0;
  let builder = fileBuilder(isa, mode, section, name(prefix, index));
  for (const item of items) {
    add(builder, item);
    if (builder.count() >= CASES_PER_FILE) {
      yield builder.build();
      index++;
      builder = fileBuilder(isa, mode, section, name(prefix, index));
    }
  }
  if (builder.count() > 0) yield builder.build();
}

function* range(n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield i;
}

// ---------------------------------------------------------------------------------------------------
// Offset extremes.

interface ExtremeForm {
  readonly name: string;
  readonly mode: Mode;
  readonly section: CorpusSection;
  /** The encodings at the two ends of the range. */
  readonly min: number;
  readonly max: number;
  /** The smallest target step the form can express. */
  readonly step: number;
}

const THUMB_CONDITIONS: readonly string[] = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le'];

export const EXTREME_FORMS: readonly ExtremeForm[] = [
  { name: 'b', mode: 'thumb', section: 'thumb', min: 0xe400, max: 0xe3ff, step: 2 },
  ...THUMB_CONDITIONS.map((c, i) => ({ name: `b${c}`, mode: 'thumb' as const, section: 'thumb' as const, min: 0xd080 | (i << 8), max: 0xd07f | (i << 8), step: 2 })),
  { name: 'ldr_pc', mode: 'thumb', section: 'thumb', min: 0x4800, max: 0x48ff, step: 4 },
  { name: 'adr', mode: 'thumb', section: 'thumb', min: 0xa000, max: 0xa0ff, step: 4 },
  // bl: offset -4 MiB (prefix 0x400, suffix 0) and +4 MiB - 2 (prefix 0x3ff, suffix 0x7ff).
  { name: 'bl', mode: 'thumb', section: 'bl', min: 0xf800_f400, max: 0xffff_f3ff, step: 2 },
  { name: 'b', mode: 'arm', section: 'arm', min: 0xea80_0000, max: 0xea7f_ffff, step: 4 },
  { name: 'bl', mode: 'arm', section: 'arm', min: 0xeb80_0000, max: 0xeb7f_ffff, step: 4 },
  { name: 'ldr_pc', mode: 'arm', section: 'arm', min: 0xe51f_0fff, max: 0xe59f_0fff, step: 1 },
];

/** The offsets an address-dependent case is tried at: both alignments in Thumb, word-aligned in ARM. */
function offsetsFor(mode: Mode): readonly number[] {
  return mode === 'thumb' ? [0, 2] : [0];
}

function* extremeFiles(isa: CorpusIsa, section: CorpusSection): Generator<CorpusFile> {
  const forms = EXTREME_FORMS.filter((f) => f.section === section);
  const mode = forms[0]?.mode ?? 'thumb';
  const builder = fileBuilder(isa, mode, section, `${section}-extremes.s`);
  for (const form of forms) {
    for (const [word, extreme] of [
      [form.min, 'min'],
      [form.max, 'max'],
    ] as const) {
      // Thumb: at both alignments; a 4-byte bl gets a 2-byte pad between the two.
      builder.add(word, extreme);
      if (mode === 'thumb') {
        if (form.section === 'bl') builder.pad(2);
        builder.add(word, extreme);
        if (form.section === 'bl') builder.pad(2);
      }
    }
  }
  yield builder.build();

  for (const form of forms) {
    for (const offset of offsetsFor(form.mode)) {
      const probes: readonly (readonly [number, number, Extreme])[] = [
        [form.min, -form.step, 'min-1'],
        [form.max, form.step, 'max+1'],
      ];
      for (const [word, delta, extreme] of probes) {
        const tag = `${form.mode}-${form.name}-${extreme === 'min-1' ? 'below' : 'above'}-${offset === 0 ? 'a0' : 'a2'}`;
        const file = probeFile(isa, form.mode, form.section, `probe-${tag}.s`, word, offset, delta, extreme);
        if (file !== undefined) yield file;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// The ARM sweep.

/** Values a field is swept through: every value up to 4 bits, otherwise the boundaries and two random. */
function sweepValues(field: Field, random: () => number): number[] {
  const top = 2 ** field.width - 1;
  if (field.width <= 4) return [...range(top + 1)];
  const half = 2 ** (field.width - 1);
  const values = [0, 1, 2, half - 1, half, top - 1, top, random() % (top + 1), random() % (top + 1)];
  return [...new Set(values)];
}

/** Whether the sweep goes through every value of a field. */
function isExhaustive(field: Field): boolean {
  return field.width <= 4;
}

function withField(word: number, field: Field, value: number): number {
  const mask = (2 ** field.width - 1) * 2 ** field.lo;
  return ((word & ~mask) | (value * 2 ** field.lo)) >>> 0;
}

const SWEEP_BASES = 4;
const BASE_ATTEMPTS = 32;

function* armSweepWords(isa: CorpusIsa, seed: number): Generator<number> {
  let state = seedFor(seed, 0x5eed_a000);
  const random = (): number => {
    state = xorshift32(state);
    return state;
  };
  for (const spec of isa.specs('arm')) {
    for (let b = 0; b < SWEEP_BASES; b++) {
      let base = spec.match;
      for (let attempt = 0; attempt < BASE_ATTEMPTS; attempt++) {
        const word = ((random() & ~spec.mask) | spec.match) >>> 0;
        if (isa.decode('arm', word, 0).specId === spec.id) {
          base = word;
          break;
        }
      }
      yield base;
      for (const field of spec.fields) for (const value of sweepValues(field, random)) yield withField(base, field, value);
    }
  }
}

/** Per ARM row: the fields the sweep covers exhaustively and those it only samples. */
export function armCoverage(isa: CorpusIsa): ArmCoverage {
  const out: Record<string, { exhaustive: string[]; sampled: string[] }> = {};
  for (const spec of isa.specs('arm')) out[spec.id] = coverageOf(spec);
  return out;
}

function coverageOf(spec: InsnSpec): { exhaustive: string[]; sampled: string[] } {
  return {
    exhaustive: spec.fields.filter(isExhaustive).map((f) => f.name),
    sampled: spec.fields.filter((f) => !isExhaustive(f)).map((f) => f.name),
  };
}

// ---------------------------------------------------------------------------------------------------
// bl pairs.

const BL_SUFFIX_BOUNDARIES: readonly number[] = [0x000, 0x001, 0x3ff, 0x400, 0x7fe, 0x7ff];

function blWord(hi: number, lo: number): number {
  return ((0xf000 | hi) | ((0xf800 | lo) << 16)) >>> 0;
}

function* blWords(options: CorpusOptions): Generator<number> {
  for (let hi = 0; hi < 0x800; hi++) for (const lo of BL_SUFFIX_BOUNDARIES) yield blWord(hi, lo);
  for (const r of prngSequence(seedFor(options.seed, 0xb1b1_0000), options.blSample)) yield blWord(r & 0x7ff, (r >>> 11) & 0x7ff);
}

// ---------------------------------------------------------------------------------------------------

/** Every corpus file, in a fixed order: Thumb, bl, ARM; within each the cases, extremes and probes. */
export function* corpusFiles(isa: CorpusIsa, options: CorpusOptions): Generator<CorpusFile> {
  yield* chunked(isa, 'thumb', 'thumb', 'thumb', range(0x10000), (b, hw) => b.addBoth(hw));
  yield* extremeFiles(isa, 'thumb');
  // Each bl is followed by a 2-byte pad, so consecutive pairs alternate between the two alignments.
  yield* chunked(isa, 'thumb', 'bl', 'bl', blWords(options), (b, word) => {
    b.add(word);
    b.pad(2);
  });
  yield* extremeFiles(isa, 'bl');
  yield* chunked(isa, 'arm', 'arm', 'arm-sweep', armSweepWords(isa, options.seed), (b, word) => b.add(word));
  yield* extremeFiles(isa, 'arm');
  yield* chunked(isa, 'arm', 'arm', 'arm-sample', prngSequence(seedFor(options.seed, 0xa5a5_0000), options.armSample), (b, word) => b.add(word));
}
