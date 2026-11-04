// The round-trip corpus core (architecture §5, D54 c, D55): the cases that prove the printer against a
// real `as`, laid out as assembly files, and the comparison of what `as` produced with the original
// bytes. Pure: the shell's runCorpus (shell/toolchain/corpus.ts) assembles the files and hands the
// bytes back to `compareCorpusFile`; test/corpus/generate.ts calls it.
//
// Layout. Each file opens with DIALECT.preamble, aligns to 4 and defines `corpus_base`, which stands
// for address 0x08000000; case n sits at corpus_base + its offset. Every label a case prints is
// defined at the end of the same file by `.set <label>, corpus_base ± <distance>`, so targets far
// outside the file (bl at ±4 MiB, ARM b at ±32 MiB) need neither padding nor a link step: `as`
// resolves a branch or load to a symbol of its own section at assembly time. A case that must not
// assemble (an offset one step past its range) gets a file of its own, which `as` must reject.
export { armCoverage, corpusFiles, EXTREME_FORMS } from './cases.ts';
export { compareCorpusFile, mergeSections, summarizeCorpus } from './compare.ts';
export type { CorpusComparison } from './compare.ts';
export { parseCorpusSummary } from './parse-summary.ts';
export * from './types.ts';
