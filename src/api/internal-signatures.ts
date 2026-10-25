// The signature placement rules' registry and the matcher's policy (architecture §4.1 "sig", §7.2), exported from
// `romlift/internal` only, like the analysis RULES and outside semver: explain's rule meta and g6.explain-coverage
// read SIGNATURE_RULES; the bench and the tests read SIGNATURE_POLICY and SIGNATURE_RULE_ORDER, and pass a policy
// with stages left out to see what a rule decides (p6-signatures-match, D93); the bench reads isSealedDataset, the
// sealing rule the signature builder applies too (architecture-6).
export { SIGNATURE_RULES } from '../core/signatures/rules/index.ts';
export { SIGNATURE_POLICY, SIGNATURE_RULE_ORDER } from '../core/signatures/policy.ts';
export { isLibraryName, isSealedDataset } from '../core/signatures/spec.ts';
