// Build compilers (architecture §3.4, D47): an open registry of the C compilers a module may be built with.
// It is separate from the analysis profile (D12): a profile says how the code looks, a build compiler how
// to build it. `agbcc` and `old_agbcc` ship; a project selects one per module (`[[modules]] compiler`,
// default `[build] compiler`), and modules.mk (phase 4) writes its cc1 path and flags.

/** A key of BUILD_COMPILERS. */
export type BuildCompilerId = string;

export interface BuildCompiler {
  readonly id: BuildCompilerId;
  /** The cc1 binary, relative to the project root (built by setup.sh under tools/agbcc/bin). */
  readonly cc1: string;
  /** The default flags; a module's `cflags` are appended to them. */
  readonly flags: readonly string[];
  /** The Makefile rule template of this compiler, relative to the package root. */
  readonly rule: string;
}

/** The flags pret-style agbcc projects compile with. */
const AGBCC_FLAGS: readonly string[] = ['-mthumb-interwork', '-Wimplicit', '-Wparentheses', '-O2', '-fhex-asm'];

function compiler(id: BuildCompilerId): BuildCompiler {
  return { id, cc1: `tools/agbcc/bin/${id}`, flags: AGBCC_FLAGS, rule: `templates/compilers/${id}.mk` };
}

export const BUILD_COMPILERS: Readonly<Record<BuildCompilerId, BuildCompiler>> = {
  agbcc: compiler('agbcc'),
  old_agbcc: compiler('old_agbcc'),
};

/** The compiler of `[build] compiler` when a config names none. */
export const DEFAULT_BUILD_COMPILER: BuildCompilerId = 'agbcc';

/** Whether `id` names a registered build compiler. */
export function isBuildCompilerId(id: string): boolean {
  return Object.hasOwn(BUILD_COMPILERS, id);
}

/** The registered compiler `id`, or undefined. */
export function buildCompilerOf(id: BuildCompilerId): BuildCompiler | undefined {
  return isBuildCompilerId(id) ? BUILD_COMPILERS[id] : undefined;
}
