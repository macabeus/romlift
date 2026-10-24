// A stub-only C unit read back (architecture §6.4, §6.6, D74 f, g): what the text-layout check and the link check
// take from a `src/<module>.c`. It is read with the reconciler's tokenizer and INCLUDE_ASM finder (core/reconcile,
// never a regex over C), and it is a stub-only unit when, at file scope, it holds nothing but comments, the header
// include (`#include "include_asm.h"`, before the first statement) and INCLUDE_ASM statements: no function
// definition, no declaration, no other directive. Only such a unit compiles to the assembly
// core/model/c-unit.ts encodes, so only it can be laid out, assembled or linked without a compiler; anything else
// is a problem at its line. What the statements must include (the module's chunk files in ROM order) is the
// text-layout check's.
import type { BuildCompilerId } from '../config/compilers.ts';
import { C_STUB_HEADER } from '../../foundation/asm/dialect.ts';
import { stubAssemblyText } from '../model/c-unit.ts';
import { chunkFileOf } from '../../foundation/util/project-files.ts';
import { scanC } from '../reconcile/include-asm.ts';

/** The header include a stub starts with (C_STUB_HEADER without its blank line). */
const HEADER_INCLUDE = C_STUB_HEADER.trimEnd();

/** One INCLUDE_ASM statement of a stub: the chunk file it includes and its line. */
export interface StubInclude {
  readonly path: string;
  readonly line: number;
}

/** Why a C text is not a stub-only unit, at a line. */
export interface StubProblem {
  readonly line: number;
  readonly message: string;
}

export interface StubReading {
  /** The chunk files its INCLUDE_ASM statements include, in text order. */
  readonly includes: readonly StubInclude[];
  /** Empty for a stub-only unit. */
  readonly problems: readonly StubProblem[];
}

/** The INCLUDE_ASM statements of a C text and every reason it is not a stub-only unit. */
export function readStub(text: string): StubReading {
  const scan = scanC(text);
  const problems: StubProblem[] = [];
  for (const t of scan.unterminated) problems.push({ line: t.line, message: `the file ends inside a ${t.kind === 'preprocessor' ? 'directive' : t.kind}` });
  const firstStatement = scan.statements[0]?.start ?? text.length;
  let header = false;
  for (const d of scan.directives) {
    if (d.kind !== 'preprocessor') continue;
    if (d.text.trimEnd() === HEADER_INCLUDE && !header && d.start < firstStatement) header = true;
    else problems.push({ line: d.line, message: `holds the directive \`${d.text.trimEnd()}\`; a stub-only unit has only \`${HEADER_INCLUDE}\`, before its first INCLUDE_ASM` });
  }
  if (!header && scan.statements.length > 0) problems.push({ line: scan.statements[0]?.line ?? 1, message: `uses INCLUDE_ASM without \`${HEADER_INCLUDE}\` before it` });
  for (const d of scan.definitions) {
    problems.push({ line: d.line, message: `defines the function ${d.name === '' ? '(unnamed)' : d.name}; only a stub-only unit is laid out and linked without a compiler (build decompiled C with make)` });
  }
  for (const o of scan.others) problems.push({ line: o.line, message: `holds \`${o.first}…\` at file scope; a stub-only unit holds only INCLUDE_ASM statements` });
  problems.sort((a, b) => a.line - b.line);
  return { includes: scan.statements.map((s) => ({ path: chunkFileOf(s.dir, s.name), line: s.line })), problems };
}

/** The assembly a build compiler emits for a stub-only C text (core/model/c-unit.ts), or why the text is not one. */
export type StubAssembly = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly problems: readonly StubProblem[] };

/** The assembly build compiler `compiler` (the module's) emits for C text `text`, or why it is not a stub-only unit. */
export function stubAssemblyOf(text: string, compiler: BuildCompilerId): StubAssembly {
  const reading = readStub(text);
  if (reading.problems.length > 0) return { ok: false, problems: reading.problems };
  return { ok: true, text: stubAssemblyText(reading.includes.map((i) => i.path), compiler) };
}
