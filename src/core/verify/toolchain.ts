// The verdicts of the toolchain checks (architecture §2.1, §6.4): what `verify --link` and `verify --assemble`
// conclude from the bytes the toolchain produced. Pure: shell/toolchain/link-check.ts runs `as`, `ld` and
// objcopy, reads their output and hashes it; everything decided about those bytes is here.
//
// - link: the linked image's SHA-1 against the ROM's, and where the two first differ when they do.
// - assemble: each unit's object, its `.text` against the unit's ROM range byte for byte, except the fields
//   its relocations leave to the linker (a cross-module `bl`, a pool word naming a label); for a C unit with a data
//   range (phase 6, §6.6), its `.rodata` against the range the same way.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { parseElf, relocationsOf } from '../../foundation/formats/elf.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import { hex } from '../../foundation/util/hex.ts';
import type { AssembleUnit, BuildUnit } from '../model/paths.ts';
import type { CheckResult } from './report.ts';


/**
 * Why `as` cannot build a unit's object, or undefined when it can: its source is no assembly file (a C module's
 * `src/<module>.c`, which phase 4's compile step builds; the text-layout check refuses such a model first).
 */
export function unassemblable(unit: BuildUnit): string | undefined {
  return unit.source.endsWith('.s') ? undefined : `${unit.source} (module ${unit.module}) is not an assembly source`;
}

/**
 * The `link` check. `ok` when the image links and its SHA-1 equals the ROM's; a toolchain or I/O failure
 * carries its diagnostic (E_TOOLCHAIN_MISSING, E_TOOLCHAIN_FAILED, E_IO_*), while a linked image that
 * differs has no diagnostic code (architecture §9.1 has none) and says where in `detail`.
 */
export interface LinkCheckResult extends CheckResult {
  readonly id: 'link';
  /** The SHA-1 of the linked image; null when nothing linked. */
  readonly sha1: string | null;
}

/** One module of the `assemble` check. */
export interface ModuleAssembly {
  readonly module: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** The `assemble` check: `ok` when every unit assembles and each object's `.text` equals its ROM range. */
export interface AssembleCheckResult extends CheckResult {
  readonly id: 'assemble';
  /** In unit order; empty when the toolchain is missing. */
  readonly modules: readonly ModuleAssembly[];
}

/** A link check that did not get to an image, or failed for a toolchain or I/O reason. */
export function linkFailure(detail: string, diagnostics: readonly Diagnostic[]): LinkCheckResult {
  return { id: 'link', ok: false, detail, diagnostics, sha1: null };
}

/** Where two images first differ, for a detail line. */
export function firstDifference(image: Uint8Array, rom: Rom): string {
  const shared = Math.min(image.length, rom.bytes.length);
  for (let i = 0; i < shared; i++) {
    if (image[i] !== rom.bytes[i]) return `first difference at 0x${hex(rom.base + i)}`;
  }
  return `the image is 0x${image.length.toString(16)} bytes, the ROM 0x${rom.bytes.length.toString(16)}`;
}

/** The link verdict of a linked image of `units` units, whose SHA-1 the shell computed. */
export function linkVerdict(image: Uint8Array, sha1: string, rom: Rom, units: number): LinkCheckResult {
  if (sha1 === rom.sha1) return { id: 'link', ok: true, detail: `${units} units link to the ROM's SHA-1 ${sha1}`, diagnostics: [], sha1 };
  return { id: 'link', ok: false, detail: `the linked image's SHA-1 ${sha1} is not the ROM's ${rom.sha1}: ${firstDifference(image, rom)}`, diagnostics: [], sha1 };
}

/** One unit's verdict, with how many bytes its relocations left to the linker. */
export interface ObjectVerdict extends ModuleAssembly {
  readonly masked: number;
}

/** How one section of an object compares with a ROM range: how many bytes its relocations masked, or the first problem. */
type SectionComparison = { readonly ok: true; readonly masked: number } | { readonly ok: false; readonly detail: string };

/** Section `name` of `object` against the ROM bytes of `span`, outside the fields its relocations leave to the linker. */
function compareSection(object: Uint8Array, unit: AssembleUnit, rom: Rom, name: string, span: { readonly start: number; readonly end: number }, what: string): SectionComparison {
  const failed = (detail: string): SectionComparison => ({ ok: false, detail });
  const elf = parseElf(object);
  if (!elf.ok) return failed(`${unit.object}: ${elf.error}`);
  const section = elf.value.sections.find((s) => s.name === name);
  const length = span.end - span.start;
  const size = section?.size ?? 0;
  if (section === undefined || size !== length) {
    return failed(`${unit.object} has 0x${size.toString(16)} bytes of ${name}, ${what} spans 0x${length.toString(16)}`);
  }
  if (section.offset + size > object.length) return failed(`${unit.object}: ${name} lies outside the file`);
  const relocations = relocationsOf(object, elf.value, section);
  if (!relocations.ok) return failed(`${unit.object}: ${relocations.error}`);
  const mask = new Uint8Array(size);
  let masked = 0;
  for (const r of relocations.value) {
    for (let i = r.offset; i < r.offset + r.width && i < size; i++) {
      if (mask[i] === 0) masked++;
      mask[i] = 1;
    }
  }
  const base = span.start - rom.base;
  if (base < 0 || base + size > rom.bytes.length) return failed(`${what === 'the module' ? "the module's span" : what} lies outside the ROM`);
  for (let i = 0; i < size; i++) {
    if (mask[i] === 0 && object[section.offset + i] !== rom.bytes[base + i]) {
      return failed(`first difference at 0x${hex(span.start + i)}`);
    }
  }
  return { ok: true, masked };
}

/** One unit's verdict: its object's `.text`, outside the relocated fields, against the ROM range; and a data range's `.rodata`. */
export function compareObject(object: Uint8Array, unit: AssembleUnit, rom: Rom): ObjectVerdict {
  const text = compareSection(object, unit, rom, '.text', unit.span, 'the module');
  if (!text.ok) return { module: unit.module, ok: false, detail: text.detail, masked: 0 };
  const range = unit.data?.span;
  if (range === undefined) return { module: unit.module, ok: true, detail: `equals 0x${hex(unit.span.start)}..0x${hex(unit.span.end)}`, masked: text.masked };
  const data = compareSection(object, unit, rom, '.rodata', range, 'its data range');
  if (!data.ok) return { module: unit.module, ok: false, detail: data.detail, masked: 0 };
  return { module: unit.module, ok: true, detail: `equals 0x${hex(unit.span.start)}..0x${hex(unit.span.end)} and its data range 0x${hex(range.start)}..0x${hex(range.end)}`, masked: text.masked + data.masked };
}

/** The `assemble` result of every unit's verdict (in unit order) and the toolchain's diagnostics. */
export function assembleVerdict(modules: readonly ModuleAssembly[], masked: number, diagnostics: readonly Diagnostic[]): AssembleCheckResult {
  const bad = modules.filter((m) => !m.ok);
  if (bad.length === 0) {
    const detail = `${modules.length} modules assemble to their ROM ranges (${masked} relocated bytes left to the linker)`;
    return { id: 'assemble', ok: diagnostics.length === 0, detail, diagnostics, modules };
  }
  const detail = `${bad.length} of ${modules.length} modules differ: ${bad.map((m) => `${m.module}: ${m.detail}`).join('; ')}`;
  return { id: 'assemble', ok: false, detail, diagnostics, modules };
}

/** An assemble check that did not get to any object (the toolchain is missing, a file could not be written). */
export function assembleFailure(detail: string, diagnostics: readonly Diagnostic[]): AssembleCheckResult {
  return { id: 'assemble', ok: false, detail, diagnostics, modules: [] };
}
