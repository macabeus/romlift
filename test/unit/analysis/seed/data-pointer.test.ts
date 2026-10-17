import assert from 'node:assert/strict';
import { test } from 'node:test';

import dataPointer from '../../../../src/core/analysis/rules/seed/data-pointer.ts';
import { Claim } from '../../../../src/core/analysis/types.ts';
import type { AnalysisView, ClaimKind } from '../../../../src/core/analysis/types.ts';
import type { Span } from '../../../../src/foundation/rom/span.ts';
import { romWith, viewWith, words } from '../../../helpers/analysis.ts';

const W = 0x0800_0300;
const [T1, T2, T3, T4, T5, T6] = [0x0800_0400, 0x0800_0410, 0x0800_0420, 0x0800_0430, 0x0800_0440, 0x0800_0450] as const;

function view(claims: readonly { span: Span; kind: ClaimKind }[], neverValid: readonly number[] = []): AnalysisView {
  // T6 is named twice: once from a word claimed as code, once from a free word.
  const rom = romWith([{ at: W, bytes: words(T6 + 1, T5 + 1, T4 + 1, T3 + 1, T2 + 1, T1 + 1, T6 + 1) }], { size: 0x800 });
  return { ...viewWith({ rom, claims, functions: [T1] }), neverValid: (a) => neverValid.includes(a) };
}

test('every pointer target outside the functions, the earlier list and neverValid, named by a word not claimed as code, ascending', () => {
  const code = (start: number): { span: Span; kind: ClaimKind } => ({ span: { start, end: start + 4 }, kind: Claim.code });
  const v = view([code(W), code(W + 8), { span: { start: W + 4, end: W + 8 }, kind: Claim.pool }], [T3]);
  assert.deepEqual(dataPointer.harvest(v, new Set([T2])), [T5, T6]);
});

test('without exclusions every target is harvested', () => {
  assert.deepEqual(dataPointer.harvest(view([]), new Set()), [T2, T3, T4, T5, T6]);
});

test('a target whose only referring word is claimed as code is not a candidate', () => {
  const v = view([{ span: { start: W, end: W + 0x1c }, kind: Claim.code }]);
  assert.deepEqual(dataPointer.harvest(v, new Set()), []);
  assert.equal(dataPointer.meta.origin, 'data-pointer');
});
