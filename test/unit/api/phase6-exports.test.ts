// The phase-6 surface the lead froze (D93), through the package entry points (D37, D43): the signature file and spec
// types with their validators, the placement rule ids and the empty rule registry, the CheckProposals contract and
// explain's signature part. The owners' functions (extractSignatures, buildSignatures, matchSignatures, planRename,
// checkProposals, ...) are theirs and are not asserted here. The type-only part is checked by `npm run typecheck`:
// each value below must be assignable to its frozen type.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';
import type {
  CheckProposals,
  ExplainSignature,
  InitOptions,
  MemberId,
  ProposalCheck,
  SignatureFile,
  SignaturePlacement,
  SignatureRuleId,
  SignatureSpec,
} from 'romlift';
import * as internal from 'romlift/internal';

const MEMBER: MemberId = 'm4aSoundMain@m4a0.o';

const FILE: SignatureFile = {
  schema: 3,
  library: 'm4a',
  builtWith: '0.0.0',
  versions: [
    {
      id: '2001',
      idNote: 'the earliest known release',
      references: [{ dataset: 'sa2', commit: 'abc1234', romSha1: '0'.repeat(40) }],
      linkOrder: [{ reference: 'sa2', members: [{ id: MEMBER, addr: 0x0809_45e8 }] }],
      functions: [{ id: MEMBER, name: 'm4aSoundMain', mode: 'thumb', size: 4, bytes: '00b5f0bd', mask: 'ffffffff' }],
      tables: [{ id: 'gXcmdTable@m4a.o', name: 'gXcmdTable', size: 8, bytes: '0000000000000000', mask: '00000000ffffffff', names: [MEMBER, null] }],
    },
  ],
};

const SPEC: SignatureSpec = {
  library: 'm4a',
  versions: [{ id: '2001', idNote: 'note', references: [{ dataset: 'sa2', objects: ['src/lib/m4a/m4a0.o'], tables: ['gXcmdTable'] }] }],
  reviewedNames: { [MEMBER]: { name: 'SoundMain', reason: 'the name every project uses' } },
};

test('romlift exports the frozen phase-6 values', () => {
  for (const name of ['parseSignatureFile', 'parseSignatureSpec', 'isMemberId', 'SIGNATURE_RULE_IDS', 'SignatureCodes']) assert.ok(name in romlift, name);
  assert.deepEqual(romlift.SIGNATURE_RULE_IDS, ['sig.unique-fit', 'sig.link-order-run', 'sig.neighbour-spacing', 'sig.pinned-both-sides', 'sig.short-member-window']);
  // A code lands with its first raiser (D45): the builder's (p6-signatures-build) are the first.
  for (const code of ['E_SIGNATURE_NAME_DUPLICATE', 'E_SIGNATURE_OBJECTS_UNMATCHED']) assert.ok(code in romlift.SignatureCodes, code);
});

test('romlift/internal exports the signature rule registry, empty until p6-signatures-match fills it', () => {
  assert.ok('SIGNATURE_RULES' in internal);
  assert.deepEqual(internal.SIGNATURE_RULES, {});
});

test('the frozen file and spec round-trip through their validators', () => {
  assert.deepEqual(romlift.parseSignatureFile(JSON.parse(JSON.stringify(FILE))), { ok: true, value: FILE });
  assert.deepEqual(romlift.parseSignatureSpec(JSON.parse(JSON.stringify(SPEC))), { ok: true, value: SPEC });
});

test('the frozen types: placements, the proposal screen, explain and init options', () => {
  const rule: SignatureRuleId = 'sig.pinned-both-sides';
  const placement: SignaturePlacement = { library: 'm4a', version: '2001', member: MEMBER, name: 'm4aSoundMain', kind: 'function', addr: 0x0804_f294, size: 4, mode: 'thumb', rule, constants: [{ offset: 0, reference: 1, rom: 2 }] };
  const screen: CheckProposals = (proposals, cx): ProposalCheck => ({ kept: proposals.filter(() => cx.analysis.functions.length >= 0), conflicts: [] });
  const signature: ExplainSignature = { library: 'm4a', version: '2001', name: 'm4aSoundMain', rule };
  const options: InitOptions = { signatures: false };
  assert.equal(placement.rule, 'sig.pinned-both-sides');
  assert.equal(typeof screen, 'function');
  assert.equal(signature.rule, rule);
  assert.equal(options.signatures, false);
});
