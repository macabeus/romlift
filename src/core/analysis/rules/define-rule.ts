// defineRule (architecture §4.1, D7): a rule file exports one value built here, its contract and its
// metadata side by side. The contract is typed by its `kind`, so the parameters of every method are
// inferred from the contract and a wrong member fails to typecheck.
import type { RuleKind, RuleOfKind } from '../types.ts';

/** Declares a rule of contract `kind`; the identity, kept for the types it checks. */
export function defineRule<K extends RuleKind>(spec: RuleOfKind<K> & { readonly kind: K }): RuleOfKind<K> {
  return spec;
}
