// The bench's own closed list (architecture §8.3): why a dataset lists an ELF FUNC symbol as a label
// (not a function start), or real code the ELF does not type as a function. It describes how a
// reference ELF types its symbols, a dataset concern, so it lives here and not in the product. These
// are the proof of concept's eight; phase 2's milestone M5 changes them (D26).

export const EXCEPTION_CATEGORIES = {
  'continuation-after-noreturn-call': 'begins right after a bl whose callee never returns and uses the caller state',
  'loop-label': 'begins at a loop branch inside a function',
  'mixer-internal': 'an offset inside the hand-written m4a sound mixer',
  startup: 'the cartridge entry, startup code or an interrupt entry',
  veneer: 'a linker Thumb-to-ARM veneer',
  'local-subroutine': 'a bl target inside hand-written code, folded into its parent by the ELF',
  'adr-callback': 'a handler reached through adr and stored as a callback',
  unreviewed: 'listed to hold the gate; needs a reviewed category',
} as const;
export type ExceptionCategory = keyof typeof EXCEPTION_CATEGORIES;

/** Whether `id` is an exception category id. */
export function isExceptionCategory(id: string): id is ExceptionCategory {
  return Object.hasOwn(EXCEPTION_CATEGORIES, id);
}
