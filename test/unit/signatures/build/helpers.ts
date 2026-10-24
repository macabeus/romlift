// What the builder's unit tests share: a reference input over a ROM made in the test, an analysis whose functions are
// exactly the code spans the test gives (the builder reads only `functions[].code` and `mode`), and ELF symbols.
import type { AnalysisResult, FunctionFact } from '../../../../src/core/analysis/types.ts';
import type { MapPlacement, ReferenceInput } from '../../../../src/core/signatures/extract.ts';
import type { ElfSymbol } from '../../../../src/foundation/formats/types.ts';
import { romFromBytes } from '../../../../src/foundation/rom/rom.ts';
import type { Rom } from '../../../../src/foundation/rom/rom.ts';
import type { Addr, Mode } from '../../../../src/foundation/rom/span.ts';
import { sha1Of } from '../../../../src/shell/hash.ts';
import { romWith } from '../../../helpers/analysis.ts';
import type { Placed } from '../../../helpers/analysis.ts';

/** A cartridge holding `parts` (test/helpers/analysis.ts romWith), with its real SHA-1. */
export function testRom(parts: readonly Placed[], size?: number): Rom {
  const bytes = romWith(parts, size === undefined ? {} : { size }).bytes;
  return romFromBytes(bytes, sha1Of(bytes));
}

/** A code span of a function, its mode with it. */
export interface Code {
  readonly start: Addr;
  readonly end: Addr;
  readonly mode: Mode;
}

/** A function fact with one code span and nothing else the builder reads. */
function fact(code: Code): FunctionFact {
  return {
    entry: code.start,
    mode: code.mode,
    extent: { start: code.start, end: code.end },
    codeEnd: code.end,
    code: [{ start: code.start, end: code.end }],
    dead: [],
    pools: [],
    farPools: [],
    tables: [],
    calls: [],
    blVerdicts: [],
    exits: [],
    branchTargets: [],
    adrs: [],
    veneers: [],
    absorbed: [],
    holes: [],
    origin: 'call',
    accepted: { rule: 'seed.call', round: 0, cites: [] },
    also: [],
  };
}

/** A discover-mode analysis of `rom` whose functions are `code`, one function per span. */
export function analysisOf(rom: Rom, code: readonly Code[]): AnalysisResult {
  return {
    schema: 'romlift/analysis@1',
    rom: { sha1: rom.sha1, end: rom.end },
    profile: 'agbcc',
    options: { mode: 'discover', seeds: [], overrides: [], trail: 'off' },
    functions: [...code].sort((a, b) => a.start - b.start).map(fact),
    claims: [],
    startup: { span: { start: rom.base, end: rom.base }, entries: [] },
    codeEnd: rom.end,
    rejections: [],
    diagnostics: [],
    mode: 'discover',
  };
}

/** A defined ELF symbol: a Thumb function (`thumb`), an ARM one (`arm`) or an object, global unless `local`. */
export function symbol(name: string, addr: Addr, size: number, kind: 'thumb' | 'arm' | 'object', bind: 'global' | 'local' = 'global'): ElfSymbol {
  const func = kind !== 'object';
  const value = kind === 'thumb' ? addr + 1 : addr;
  return { name, value, addr, size, type: func ? 'func' : 'object', bind, thumb: kind === 'thumb', sectionIndex: 1 };
}

/** One reference input: the dataset name, its ROM, the code spans, the symbols and the map placements. */
export function reference(
  dataset: string,
  rom: Rom,
  code: readonly Code[],
  symbols: readonly ElfSymbol[],
  textPlacements: readonly MapPlacement[],
  dataPlacements: readonly MapPlacement[] = [],
): ReferenceInput {
  return { dataset, commit: `${dataset}-commit`, romSha1: rom.sha1, rom, analysis: analysisOf(rom, code), symbols, textPlacements, dataPlacements };
}
