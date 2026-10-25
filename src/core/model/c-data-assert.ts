// What the link does with a C object's data (architecture §6.6, D21, D74 f, D92); in core/model since architecture-r1-1
// (D76 h), since it is project knowledge foundation/ does not hold. The ldscript writer prints these lines and the
// ldscript check (core/verify/link-scripts.ts) requires them, so both take them from here; the source's path is
// cSourceOf's (fix round 7, architecture-b2-7).
//
// - Every C unit has a NOLOAD check section collecting the sections of its object the link does not place, and an
//   ASSERT that it is empty, with the message `g4.c-data-fails-loud` expects (it names no phase since fix round 3,
//   correctness-a1-6). Without a data range it collects every section but .text (the phase-4 lines, unchanged).
// - A C unit with a data range (Module.dataRange, phase 6) has its object's `.rodata` placed at the range, loaded where
//   it runs, with an ASSERT that it is exactly the range's size; its check section then collects only `.data*`, `.bss*`
//   and COMMON, so C data in RAM still fails the link loudly (a known limitation of phase 6).
// - `verify --assemble/--link` build a C unit from its stub's assembly (core/model/c-unit.ts), without a compiler; for a
//   unit with a data range they append cDataStandIn: the range's ROM bytes as `.rodata`, `.incbin` of baserom.gba as the
//   stub assembly stands in for the C code, with every label of the range defined global at its address, as the C object
//   must define them.
import { incbinLine } from '../../foundation/asm/dialect.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { cSourceOf } from '../../foundation/util/project-files.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { Label } from './types.ts';

/** The object sections a data range places (`.rodata` and its subsections, as agbcc and gcc name them). */
export const C_RODATA_SECTIONS = '.rodata .rodata.*';

/** The NOLOAD section that collects every section of C module `module`'s object but .text (D74 f). */
export function cDataSectionLine(module: string): string {
  return `.c_data_${module} (NOLOAD) : { *src/${module}.o(.rodata* .data* .bss* COMMON) }`;
}

/** The NOLOAD section of a C module with a data range: its object's sections in RAM, which the link does not place. */
export function cRamDataSectionLine(module: string): string {
  return `.c_data_${module} (NOLOAD) : { *src/${module}.o(.data* .bss* COMMON) }`;
}

/** The assertion that C module `module` defines no data the link leaves unplaced. */
export function cDataAssertLine(module: string): string {
  return `ASSERT(SIZEOF(.c_data_${module}) == 0, "${cSourceOf(`${module}.c`)} defines data; see AGENTS.md (romlift does not place C data yet)")`;
}

/** The output section of C module `module`'s data range: its object's `.rodata`, linked and loaded at the range's start. */
export function cRodataName(module: string): string {
  return `.rodata_${module}`;
}

/** The section line that places C module `module`'s `.rodata` (its object `object`, build/src/<module>.o) at `range`. */
export function cRodataSectionLine(module: string, object: string, range: Span): string {
  const at = hexAddr(range.start);
  return `${cRodataName(module)} ${at} : AT(${at}) { ${object}(${C_RODATA_SECTIONS}) }`;
}

/** The assertion that C module `module`'s `.rodata` is exactly the bytes of its data range. */
export function cRodataAssertLine(module: string, range: Span): string {
  const size = range.end - range.start;
  return `ASSERT(SIZEOF(${cRodataName(module)}) == ${size}, "${cSourceOf(`${module}.c`)}'s read-only data is not the ${size} bytes of its data range [${hexAddr(range.start)}, ${hexAddr(range.end)}); see AGENTS.md")`;
}

/** A C unit's data range as `verify` builds it: the span and the labels its object defines there. */
export interface CDataRange {
  readonly span: Span;
  /** Sorted by address, then name. */
  readonly labels: readonly { readonly name: string; readonly addr: Addr }[];
}

/** The data range `range` of a module, with the labels of `labels` that lie in it, by address then name. */
export function cDataRangeOf(range: Span, labels: readonly Pick<Label, 'addr' | 'name'>[]): CDataRange {
  const inside = labels
    .filter((l) => l.addr >= range.start && l.addr < range.end)
    .map((l) => ({ name: l.name, addr: l.addr }))
    .sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
  return { span: { start: range.start, end: range.end }, labels: inside };
}

/** `.incbin` of the ROM's bytes [from, to), or nothing when the slice is empty. */
function romSlice(from: Addr, to: Addr): readonly string[] {
  if (to <= from) return [];
  return [incbinLine(from, to)];
}

/** The assembly that stands in for a C object's `.rodata` over `range`: the ROM's bytes, with the range's labels global. */
export function cDataStandIn(range: CDataRange): string {
  const lines = ['\t.section .rodata'];
  let at = range.span.start;
  for (const label of range.labels) {
    lines.push(...romSlice(at, label.addr), `\t.global ${label.name}`, `${label.name}:`);
    at = Math.max(at, label.addr);
  }
  lines.push(...romSlice(at, range.span.end));
  return `${lines.join('\n')}\n`;
}
