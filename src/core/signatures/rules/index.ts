// The signature placement rules (architecture §4.1 "sig", §7.2, D7): one file per rule beside this index, each with
// its metadata, keyed by id (the SignatureRuleId union of ../schema.ts). The record is empty until its owner,
// p6-signatures-match, adds the five rules (D93); explain merges it with the analysis RULES only to print rule meta.
import type { RuleMeta } from '../../provenance/rule-id.ts';

export const SIGNATURE_RULES: Readonly<Record<string, RuleMeta>> = {};
