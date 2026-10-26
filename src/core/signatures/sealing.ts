// Whether a bench dataset is sealed (D25), the rule that keeps a held-out ROM from ever being a signature reference
// (D32, g6.no-heldout-references): the shell's builder and the bench read this one definition (architecture-6), kept
// out of the spec format (architecture-r1-8). Pure.

/**
 * Whether a dataset (its JSON fields as the bench records them: `heldout`, `revealed`) is sealed: held out and never
 * revealed (D25).
 */
export function isSealedDataset(fields: { readonly heldout?: unknown; readonly revealed?: unknown }): boolean {
  return fields.heldout === true && (!Array.isArray(fields.revealed) || fields.revealed.length === 0);
}
