// Lays corpus cases out as one assembly file: the dialect preamble, `corpus_base`, one line per case
// (the printed mnemonic or its `.inst` fallback), padding, and the `.set` definitions of every label
// the cases printed. Each case is decoded at the address it occupies, so a PC-relative form prints the
// label of its own target.
import { assemble, format, formatRaw, parse, specOf } from '@match-kit/isa/armv4t';
import type { FlowClass, Insn, SymbolResolver } from '@match-kit/isa/armv4t';

import { DIALECT } from '../asm/dialect.ts';
import { decode, printing } from '../isa.ts';
import type { Mode } from '../rom/span.ts';
import { hex } from '../util/hex.ts';
import { compareNumbers } from '../util/sorted.ts';
import { CORPUS_BASE } from './types.ts';
import type { CaseContext, CorpusCase, CorpusFile, CorpusProbe, CorpusSection, Extreme } from './types.ts';

/** The row flow classes whose text names an address, so their bytes depend on where they sit. */
const ADDRESS_FLOWS: ReadonlySet<FlowClass> = new Set<FlowClass>(['branch', 'cond-branch', 'bl', 'pool-load', 'adr']);

/** The label the corpus prints for an address. */
export function corpusLabel(addr: number): string {
  return `_${hex(addr)}`;
}

/** The address of a corpus label, or undefined. */
export function corpusAddress(name: string): number | undefined {
  return /^_[0-9A-F]{8}$/.test(name) ? Number.parseInt(name.slice(1), 16) : undefined;
}

/** A resolver that names every address and remembers which ones it named, shifted by `delta`. */
function recordingResolver(labels: Set<number>, delta = 0): SymbolResolver {
  return {
    labelFor: (addr) => {
      const target = addr + delta;
      labels.add(target);
      return corpusLabel(target);
    },
    addressOf: corpusAddress,
  };
}

function alignmentOf(addr: number): CaseContext['alignment'] {
  return addr % 4 === 0 ? '0-mod-4' : '2-mod-4';
}

function labelLines(labels: ReadonlySet<number>): string[] {
  return [...labels].sort(compareNumbers).map((target) => {
    const distance = target - CORPUS_BASE;
    return `.set ${corpusLabel(target)}, corpus_base ${distance < 0 ? '-' : '+'} 0x${Math.abs(distance).toString(16)}`;
  });
}

function header(mode: Mode): string[] {
  return [DIALECT.preamble(mode).trimEnd(), '.balign 4', 'corpus_base:'];
}

export interface FileBuilder {
  /** Adds one case at the current offset. */
  add(word: number, extreme?: Extreme): CorpusCase;
  /** Adds a case, and again at the next offset when its text depends on its address (Thumb: the other alignment). */
  addBoth(word: number, extreme?: Extreme): void;
  pad(bytes: number): void;
  readonly count: () => number;
  build(): CorpusFile;
}

/** A builder for one file of cases of `section`, decoded in `mode`. */
export function fileBuilder(mode: Mode, section: CorpusSection, name: string): FileBuilder {
  const lines = header(mode);
  const cases: CorpusCase[] = [];
  const labels = new Set<number>();
  const resolver = recordingResolver(labels);
  let offset = 0;

  const addressDependent = (insn: Insn): boolean => ADDRESS_FLOWS.has(specOf(insn.specId).flow);

  const add = (word: number, extreme?: Extreme): CorpusCase => {
    const addr = CORPUS_BASE + offset;
    const insn = decode(mode, word, addr);
    const printed = printing(insn, resolver);
    const text = printed.kind === 'mnemonic' ? printed.text : formatRaw(insn);
    const context: CaseContext | undefined = addressDependent(insn)
      ? { alignment: alignmentOf(addr), ...(extreme === undefined ? {} : { extreme }) }
      : undefined;
    const item: CorpusCase = {
      offset,
      word: insn.word,
      size: insn.size,
      specId: insn.specId,
      text,
      kind: printed.kind,
      section,
      ...(printed.kind === 'raw' ? { reason: printed.reason } : { assembled: printed.assembled.word }),
      ...(context === undefined ? {} : { context }),
    };
    lines.push(`\t${text}`);
    cases.push(item);
    offset += insn.size;
    return item;
  };

  return {
    add,
    addBoth: (word, extreme) => {
      const first = add(word, extreme);
      if (mode === 'thumb' && first.context !== undefined) add(word, extreme);
    },
    pad: (bytes) => {
      lines.push(`\t.space ${bytes}`);
      offset += bytes;
    },
    count: () => cases.length,
    build: () => ({
      name,
      mode,
      text: `${[...lines, ...labelLines(labels)].join('\n')}\n`,
      size: offset,
      expect: 'bytes',
      cases,
    }),
  };
}

/**
 * A file holding one text that must not assemble: the instruction `word` decoded at `offset` and
 * printed with its label moved `delta` bytes, one step past the end of its range.
 */
export function probeFile(
  mode: Mode,
  section: CorpusSection,
  name: string,
  word: number,
  offset: number,
  delta: number,
  extreme: Extreme,
): CorpusFile | undefined {
  const addr = CORPUS_BASE + offset;
  const labels = new Set<number>();
  const insn = decode(mode, word, addr);
  const text = format(insn, recordingResolver(labels, delta));
  if (text === undefined) return undefined;
  const parsed = parse(text, mode, addr, recordingResolver(new Set<number>()));
  const assembled = parsed === undefined ? undefined : assemble(parsed, addr)?.word;
  const probe: CorpusProbe = {
    offset,
    section,
    text,
    context: { alignment: alignmentOf(addr), extreme },
    ...(assembled === undefined ? {} : { assembled }),
  };
  const lines = [...header(mode), ...(offset > 0 ? [`\t.space ${offset}`] : []), `\t${text}`, ...labelLines(labels)];
  return { name, mode, text: `${lines.join('\n')}\n`, size: offset + insn.size, expect: 'error', cases: [], probe };
}
