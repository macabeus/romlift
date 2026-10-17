import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defineRule } from '../../../src/core/analysis/rules/define-rule.ts';
import type { RuleOfKind } from '../../../src/core/analysis/types.ts';

const meta = { id: 'valid.example', summary: 's', restsOn: 'r', recovers: 'c', reads: ['readings'], adds: [] } as const;

test('defineRule returns its spec unchanged, typed by its kind', () => {
  const rule = defineRule({
    meta,
    kind: 'valid',
    reason: 'not-dense',
    intrinsic: true,
    check(r) {
      return r.holeBytes > 8 ? `${r.holeBytes} hole bytes` : undefined;
    },
  });
  const typed: RuleOfKind<'valid'> = rule;
  assert.equal(typed.kind, 'valid');
  assert.equal(typed.meta.id, 'valid.example');
});

test('the contract checks its members at compile time', () => {
  const rules = [
    // @ts-expect-error a validity rule's reason is a miss reason id
    defineRule({ meta, kind: 'valid', reason: 'too-big', intrinsic: true, check: () => undefined }),
    // @ts-expect-error a walk policy answers onInsn, not check
    defineRule({ meta: { ...meta, id: 'walk.example' }, kind: 'walk', check: () => undefined }),
    // @ts-expect-error a seed rule returns candidates
    defineRule({ meta: { ...meta, id: 'seed.example', origin: 'call' }, kind: 'seed', seeds: () => [1] }),
    defineRule({ meta: { ...meta, id: 'seed.example', origin: 'call' }, kind: 'harvest', harvest: (v, earlier) => (earlier.has(v.rom.base) ? [] : [v.rom.base]) }),
  ];
  assert.equal(rules.length, 4);
});
