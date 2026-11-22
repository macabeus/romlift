// Compares what `as` made of a corpus file with the original bytes, case by case, and folds the
// per-file comparisons into the counts of a run (CorpusCounts). It decides nothing: whether the counts
// meet the threshold is foundation/corpus/threshold.ts's corpusOk. A case agrees when the
// bytes at its offset are its original word; a mnemonic also checks that `assemble` gave the same
// word in process (encoder agreement); a probe agrees when `as` rejected its file and `assemble`
// refused its text.
import { RAW_REASONS } from '../isa.ts';
import type { RawReason } from '../isa.ts';
import { hex } from '../util/hex.ts';
import { compareCodeUnits } from '../util/sorted.ts';
import { zeroRawCounts } from './types.ts';
import type {
  Alignment,
  ArmCoverage,
  CorpusAssembly,
  CorpusCounts,
  CorpusExample,
  CorpusFile,
  CorpusSection,
  CorpusSectionSummary,
} from './types.ts';

/** Examples kept per summary block. */
const EXAMPLES = 20;

interface Block {
  checked: number;
  disagree: number;
  examples: CorpusExample[];
}

interface SectionTally {
  cases: number;
  mnemonic: number;
  raw: number;
  agree: number;
  disagree: number;
  rawByReason: Record<RawReason, number>;
  examples: CorpusExample[];
}

/** The comparison of one file. */
export interface CorpusComparison {
  readonly file: string;
  readonly sections: Readonly<Record<CorpusSection, CorpusSectionSummary>>;
  readonly encoder: {
    readonly checked: number;
    readonly disagree: number;
    readonly examples: readonly CorpusExample[];
  };
  readonly context: {
    readonly checked: number;
    readonly disagree: number;
    readonly alignments: readonly Alignment[];
    readonly extremes: number;
    readonly examples: readonly CorpusExample[];
  };
}

function tally(): SectionTally {
  return { cases: 0, mnemonic: 0, raw: 0, agree: 0, disagree: 0, rawByReason: zeroRawCounts(), examples: [] };
}

function block(): Block {
  return { checked: 0, disagree: 0, examples: [] };
}

function wordHex(word: number, size: number): string {
  return `0x${hex(word, size * 2)}`;
}

/** The little-endian value of `size` bytes at `offset`, or undefined past the end. */
function readWord(bytes: Uint8Array, offset: number, size: number): number | undefined {
  if (offset + size > bytes.length) return undefined;
  let word = 0;
  for (let i = size - 1; i >= 0; i--) word = word * 256 + (bytes[offset + i] ?? 0);
  return word;
}

function note(list: CorpusExample[], example: CorpusExample): void {
  if (list.length < EXAMPLES) list.push(example);
}

function firstLine(text: string): string {
  return text.split('\n').find((line) => line.trim() !== '' && !line.includes('Assembler messages')) ?? text;
}

/** Compares one corpus file with what assembling it produced. */
export function compareCorpusFile(file: CorpusFile, assembly: CorpusAssembly): CorpusComparison {
  const sections: Record<CorpusSection, SectionTally> = { thumb: tally(), bl: tally(), arm: tally() };
  const encoder = block();
  const context = block();
  const alignments = new Set<Alignment>();
  let extremes = 0;
  const failure = assembly.ok ? undefined : `as failed: ${firstLine(assembly.stderr)}`;

  const probe = file.probe;
  if (file.expect === 'error' && probe !== undefined) {
    const rejected = !assembly.ok;
    const refused = probe.assembled === undefined;
    const example: CorpusExample = {
      offset: probe.offset,
      word: 'none',
      text: probe.text,
      expected: 'rejected',
      got: `as ${rejected ? 'rejected' : 'accepted'}, assemble ${refused ? 'refused' : `gave ${wordHex(probe.assembled ?? 0, 4)}`}`,
    };
    context.checked++;
    encoder.checked++;
    extremes++;
    alignments.add(probe.context.alignment);
    if (!rejected || !refused) {
      context.disagree++;
      note(context.examples, example);
    }
    if (rejected !== refused) {
      encoder.disagree++;
      note(encoder.examples, example);
    }
  }

  const sizeWrong = assembly.ok && assembly.bytes.length !== file.size;
  for (const c of file.cases) {
    const section = sections[c.section];
    section.cases++;
    if (c.kind === 'mnemonic') section.mnemonic++;
    else section.raw++;
    if (c.reason !== undefined) section.rawByReason[c.reason]++;

    const got = assembly.ok && !sizeWrong ? readWord(assembly.bytes, c.offset, c.size) : undefined;
    const gotText =
      failure ??
      (sizeWrong
        ? `.text is ${assembly.ok ? assembly.bytes.length : 0} bytes, expected ${file.size}`
        : got === undefined
          ? 'missing'
          : wordHex(got, c.size));
    const example = (expected: number): CorpusExample => ({
      offset: c.offset,
      word: wordHex(c.word, c.size),
      text: c.text,
      expected: wordHex(expected, c.size),
      got: gotText,
    });
    const agrees = got === c.word;
    if (agrees) section.agree++;
    else {
      section.disagree++;
      note(section.examples, example(c.word));
    }
    if (c.kind === 'mnemonic') {
      encoder.checked++;
      if (c.assembled === undefined || c.assembled !== got) {
        encoder.disagree++;
        note(encoder.examples, example(c.assembled ?? c.word));
      }
    }
    if (c.context !== undefined) {
      context.checked++;
      alignments.add(c.context.alignment);
      if (c.context.extreme !== undefined) extremes++;
      if (!agrees) {
        context.disagree++;
        note(context.examples, example(c.word));
      }
    }
  }

  return {
    file: file.name,
    sections,
    encoder,
    context: { ...context, alignments: [...alignments].sort(compareCodeUnits), extremes },
  };
}

/** The sum of several section counts (the first EXAMPLES examples kept). */
export function mergeSections(parts: readonly CorpusSectionSummary[]): CorpusSectionSummary {
  const out = tally();
  for (const p of parts) {
    out.cases += p.cases;
    out.mnemonic += p.mnemonic;
    out.raw += p.raw;
    out.agree += p.agree;
    out.disagree += p.disagree;
    for (const r of RAW_REASONS) out.rawByReason[r] += p.rawByReason[r];
    for (const e of p.examples) note(out.examples, e);
  }
  return out;
}

/** Folds per-file comparisons into the counts of the run, with the ARM coverage classes. */
export function summarizeCorpus(comparisons: readonly CorpusComparison[], armCoverage: ArmCoverage): CorpusCounts {
  const section = (s: CorpusSection): CorpusSectionSummary => mergeSections(comparisons.map((c) => c.sections[s]));
  const thumb = section('thumb');
  const bl = section('bl');
  const arm = section('arm');
  const encoder = block();
  const context = block();
  const alignments = new Set<Alignment>();
  let extremes = 0;
  for (const c of comparisons) {
    encoder.checked += c.encoder.checked;
    encoder.disagree += c.encoder.disagree;
    for (const e of c.encoder.examples) note(encoder.examples, e);
    context.checked += c.context.checked;
    context.disagree += c.context.disagree;
    for (const e of c.context.examples) note(context.examples, e);
    for (const a of c.context.alignments) alignments.add(a);
    extremes += c.context.extremes;
  }
  const coverage: Record<string, ArmCoverage[string]> = {};
  for (const id of Object.keys(armCoverage).sort(compareCodeUnits)) {
    const entry = armCoverage[id];
    if (entry !== undefined) coverage[id] = entry;
  }
  return {
    sections: { thumb, bl, arm: { ...arm, coverage } },
    encoderAgrees: encoder,
    context: {
      checked: context.checked,
      disagree: context.disagree,
      alignments: [...alignments].sort(compareCodeUnits),
      extremes,
      examples: context.examples,
    },
  };
}
