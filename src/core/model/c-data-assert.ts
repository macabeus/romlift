// The linker-script text that makes a C unit that defines data fail the link loudly until the data ranges, which the
// owner moved from phase 5 to phase 6 (architecture §6.6, D21, D74 f, D76 g); in core/model since architecture-r1-1
// (D76 h), since it is project knowledge foundation/ does not hold. One NOLOAD section collecting every section of
// the C object but .text, and an ASSERT that it is empty, with the message `g4.c-data-fails-loud` expects (its
// "phase 5" is product text every project's ldscript holds, carried to phase 6 with the ranges that replace it). The
// ldscript writer prints these lines and the ldscript check (core/verify/link-scripts.ts) requires them, so both take
// them from here.

/** The NOLOAD section that collects every section of C module `module`'s object but .text (D74 f). */
export function cDataSectionLine(module: string): string {
  return `.c_data_${module} (NOLOAD) : { *src/${module}.o(.rodata* .data* .bss* COMMON) }`;
}

/** The assertion that C module `module` defines no data. */
export function cDataAssertLine(module: string): string {
  return `ASSERT(SIZEOF(.c_data_${module}) == 0, "src/${module}.c defines data; see AGENTS.md (data ranges arrive in phase 5)")`;
}
