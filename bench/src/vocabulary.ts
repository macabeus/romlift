// The bench's own closed list (architecture §8.3): why a dataset lists an ELF FUNC symbol as a label
// (not a function start), or real code the ELF does not type as a function. It describes how a
// reference ELF types its symbols, a dataset concern, so it lives here and not in the product. Every
// category is carried by a committed dataset row or by a sealed classifier's false-entry class
// (CLASSIFIER_CATEGORIES); the vocabulary test fails on one that is not. Phase 2's milestone M5 (D26)
// added second-entry, untyped-leaf and split-after-returning-call (which replaces the misnamed
// continuation-after-noreturn-call), and disassembler-split for the one FE7J row that follows no call.
// The owner decision of 17 October 2026 (D60) added unreached-tail and pointer-entry for tmc's rows, and
// widened split-after-returning-call to the indirect call `mov lr, pc; bx rN` (the same split after a
// call that returns, by another call instruction). second-entry and untyped-leaf keep their M5
// definitions (bl-reached helpers and leaves): code reached through its address (a veneer, `bl
// _call_via_rN` with its address, a stored pointer) is pointer-entry, defined by how the program reaches it.
//
// `unreviewed` is not a category: it is the placeholder `bench adopt` writes for a row nobody has
// classified yet, which g2.no-unreviewed refuses at landing.

export const EXCEPTION_CATEGORIES = {
  'loop-label': 'begins at a loop branch inside a function',
  'mixer-internal': 'an offset inside the hand-written m4a sound mixer',
  startup: 'the cartridge entry, startup code or an interrupt entry',
  veneer: 'a linker Thumb-to-ARM veneer',
  'local-subroutine': 'a bl target inside hand-written code, folded into its parent by the ELF',
  'adr-callback': 'a handler reached through adr and stored as a callback',
  'second-entry': 'a second entry point of a hand-written helper, a few bytes after its first, reached by its own bl',
  'untyped-leaf': 'a whole leaf function reached by bl that the ELF only labels, typing no FUNC there',
  'split-after-returning-call':
    "the truth's own disassembler split right after a call whose callee returns (bl _call_via_rN, a bl to a returning helper, or mov lr, pc; bx rN)",
  'disassembler-split':
    "the truth's own disassembler split inside straight-line code that no call, branch or pointer reaches",
  'unreached-tail':
    "code right after a hand-written function's return that nothing reaches, which the ELF folds into that function",
  'pointer-entry':
    'another entry point of hand-written code, reached by a jump through its address (a load-and-jump veneer, bl _call_via_rN with its address, or a stored function pointer), which the ELF only labels',
} as const;
export type ExceptionCategory = keyof typeof EXCEPTION_CATEGORIES;

/** Whether `id` is an exception category id. */
export function isExceptionCategory(id: string): id is ExceptionCategory {
  return Object.hasOwn(EXCEPTION_CATEGORIES, id);
}

/** The categories the sealed classifiers give false entries (classify.ts FalseEntryClass): carried without a dataset row. */
export const CLASSIFIER_CATEGORIES: readonly ExceptionCategory[] = ['startup', 'veneer', 'adr-callback'];

/** The placeholder of a row `bench adopt` added and nobody has classified (refused by g2.no-unreviewed). */
export const UNREVIEWED = 'unreviewed';

/** What a dataset row's `category` may hold: a category, or the adopt placeholder. */
export type RowCategory = ExceptionCategory | typeof UNREVIEWED;

export function isRowCategory(id: string): id is RowCategory {
  return id === UNREVIEWED || isExceptionCategory(id);
}

/** Categories milestone M5 retired: no dataset may carry them, but an artifact committed before M5 still does. */
export const RETIRED_CATEGORIES = {
  'continuation-after-noreturn-call':
    'replaced by split-after-returning-call at milestone M5 (D26): the call it follows returns',
} as const;
export type RetiredCategory = keyof typeof RETIRED_CATEGORIES;

/** What a row of a committed artifact may carry: a row category, or a retired one in an artifact older than M5. */
export type ArtifactCategory = RowCategory | RetiredCategory;

export function isArtifactCategory(id: string): id is ArtifactCategory {
  return isRowCategory(id) || Object.hasOwn(RETIRED_CATEGORIES, id);
}
