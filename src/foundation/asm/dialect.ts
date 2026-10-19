// The assembler dialect (architecture §5, D49): the one definition of the text every generated `.s`
// file starts with, of `include/macros.inc`, and of the arguments `as` runs with. The corpus, the
// writers, the macros.inc template and the text-layout check all take it from here, so the corpus
// tests the dialect the writers emit. The macro names are the proof of concept's (src/emit.ts).
import type { Dialect } from '../isa/types.ts';
import type { Mode } from '../rom/span.ts';

/** A function-start macro: word alignment (unless the entry is at 2 mod 4), visibility, mode and type. */
function startMacro(name: string, mode: Mode, aligned: boolean, global: boolean): string {
  const body = [
    ...(aligned ? ['\t.align 2, 0'] : []),
    ...(global ? ['\t.global \\name'] : []),
    mode === 'arm' ? '\t.arm' : '\t.thumb',
    ...(mode === 'thumb' ? ['\t.thumb_func'] : []),
    '\t.type \\name, %function',
  ];
  return [`\t.macro ${name} name`, ...body, '\t.endm'].join('\n');
}

function endMacro(name: string): string {
  return [`\t.macro ${name} name`, '\t.size \\name, .-\\name', '\t.endm'].join('\n');
}

const MACROS_INC = `${[
  startMacro('arm_func_start', 'arm', true, true),
  startMacro('arm_func_start_local', 'arm', true, false),
  endMacro('arm_func_end'),
  startMacro('thumb_func_start', 'thumb', true, true),
  startMacro('thumb_func_start_local', 'thumb', true, false),
  startMacro('non_word_aligned_thumb_func_start', 'thumb', false, true),
  startMacro('non_word_aligned_thumb_func_start_local', 'thumb', false, false),
  endMacro('thumb_func_end'),
].join('\n\n')}\n`;

/**
 * A symbol name a generated file may define and reference: a letter or `_`, then letters, digits, `_`, `.` and
 * `$`. GNU as reads a leading `$` as an ARM mapping symbol (`$a`, `$t`, `$d`, which change how objdump and ld
 * see the bytes) and a leading `.` as a section name or a local `.L` label, so neither may start a name.
 */
const SYMBOL_NAME = /^[A-Za-z_][A-Za-z0-9_.$]*$/;

/**
 * The longest symbol name, in characters (ASCII, so bytes): a function's name is a file name,
 * `<Name>_<ADDR>.s` in a case-folded group (core/model/paths.ts), and file systems store at most 255 bytes
 * per name, so 200 leaves room for the 11 bytes of `_<ADDR>.s`.
 */
export const MAX_SYMBOL_NAME = 200;

/** Whether `name` is a symbol name (SYMBOL_NAME, at most MAX_SYMBOL_NAME characters) a generated file may define. */
export function isSymbolName(name: string): boolean {
  return name.length <= MAX_SYMBOL_NAME && SYMBOL_NAME.test(name);
}

/** What isSymbolName accepts, as the config schema and E_NAME_INVALID say it. */
export const SYMBOL_NAME_RULE = `a letter or _, then letters, digits, _, . and $, at most ${MAX_SYMBOL_NAME} characters`;

/** The macro file's project path, the one definition (core/model/paths.ts re-exports it as MACROS_PATH). */
const MACROS_PATH = 'include/macros.inc';
const MACROS_INCLUDE = `.include "${MACROS_PATH}"`;

export const DIALECT: Dialect = {
  preamble: (mode) => `.syntax unified\n${MACROS_INCLUDE}\n${mode === 'arm' ? '.arm' : '.thumb'}\n`,
  macrosPath: MACROS_PATH,
  macrosInclude: MACROS_INCLUDE,
  macrosInc: MACROS_INC,
  asArgs: ['-mcpu=arm7tdmi'],
};
