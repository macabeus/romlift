// What a perfect `as` would make of a corpus file: each case's original bytes at its offset (fillers
// zero), and a rejection for a probe file. Used to test the comparator without a toolchain.
import type { CorpusAssembly, CorpusFile } from '../../../src/foundation/corpus/corpus.ts';

export function perfectAs(file: CorpusFile): CorpusAssembly {
  if (file.expect === 'error') return { ok: false, stderr: 'source.s: Assembler messages:\nsource.s:7: Error: branch out of range\n' };
  const bytes = new Uint8Array(file.size);
  for (const c of file.cases) for (let i = 0; i < c.size; i++) bytes[c.offset + i] = (c.word >>> (8 * i)) & 0xff;
  return { ok: true, bytes };
}
