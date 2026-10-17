// The round-trip corpus core (architecture §5, D54 c): the cases that prove the printer against a
// real `as`, laid out as assembly files, and the comparison of what `as` produced with the original
// bytes. Pure: the caller (test/corpus/generate.ts, and `doctor` from wave 2) writes the files, runs
// the assembler, and hands the bytes back to `compareCorpusFile`.
//
// Layout. Each file opens with DIALECT.preamble, aligns to 4 and defines `corpus_base`, which stands
// for address 0x08000000; case n sits at corpus_base + its offset. Every label a case prints is
// defined at the end of the same file by `.set <label>, corpus_base ± <distance>`, so targets far
// outside the file (bl at ±4 MiB, ARM b at ±32 MiB) need neither padding nor a link step: `as`
// resolves a branch or load to a symbol of its own section at assembly time. A case that must not
// assemble (an offset one step past its range) gets a file of its own, which `as` must reject.
import { DIALECT } from '../asm/dialect.ts';
import { assemble } from './assemble.ts';
import { decode } from './decode.ts';
import { format, formatRaw } from './format.ts';
import { parse } from './parse.ts';
import { rawReason } from './roundtrip.ts';
import { specOf, specsOf } from './rows.ts';
import type { CorpusIsa } from './corpus-types.ts';

export { armCoverage, corpusFiles } from './corpus-cases.ts';
export { compareCorpusFile, summarizeCorpus } from './corpus-compare.ts';
export * from './corpus-types.ts';

/** The product's isa. */
export const CORPUS_ISA: CorpusIsa = {
  decode,
  format,
  formatRaw,
  parse,
  assemble,
  rawReason,
  specOf,
  specs: specsOf,
  preamble: DIALECT.preamble,
};
