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

export const DIALECT: Dialect = {
  preamble: (mode) => `.syntax unified\n.include "include/macros.inc"\n${mode === 'arm' ? '.arm' : '.thumb'}\n`,
  macrosInc: MACROS_INC,
  asArgs: ['-mcpu=arm7tdmi'],
};
