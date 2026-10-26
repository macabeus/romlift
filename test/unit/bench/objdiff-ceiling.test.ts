// bench/src/objdiff-ceiling.ts (D102): the ceiling file g6.objdiff reads, parsed strictly, and lowered by a measurement,
// never raised.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CEILING_SCHEMA, lowerCeilings, parseCeilings } from '../../../bench/src/objdiff-ceiling.ts';

test('lowerCeilings: a measured count lowers a ceiling, never raises it; a ROM without one is refused (D104 b)', () => {
  const existing = { schema: CEILING_SCHEMA, roms: { fe7j: 7, sa3: 4 } } as const;
  assert.deepEqual(lowerCeilings(existing, { fe7j: 5, sa3: 9 }), { schema: CEILING_SCHEMA, roms: { fe7j: 5, sa3: 4 } });
  assert.throws(() => lowerCeilings(existing, { fe7j: 5, tmc: 25 }), /no ceiling to lower for tmc: a new ceiling is the owner's/);
  assert.throws(() => lowerCeilings(undefined, { tmc: 25, fe7j: 7 }), /no ceiling to lower for fe7j, tmc/);
  assert.deepEqual(Object.keys(lowerCeilings(existing, {}).roms), ['fe7j', 'sa3'], 'a ROM not measured keeps its ceiling');
});

test('parseCeilings: the schema and a non-negative integer per ROM, ROMs in code-unit order', () => {
  assert.deepEqual(parseCeilings({ schema: CEILING_SCHEMA, roms: { tmc: 25, fe7j: 0 } }, 'f'), { schema: CEILING_SCHEMA, roms: { fe7j: 0, tmc: 25 } });
  assert.throws(() => parseCeilings({ schema: 'other', roms: {} }, 'f'), /schema must be/);
  assert.throws(() => parseCeilings({ schema: CEILING_SCHEMA, roms: { fe7j: -1 } }, 'f'), /non-negative integer/);
  assert.throws(() => parseCeilings({ schema: CEILING_SCHEMA, roms: { fe7j: 1.5 } }, 'f'), /non-negative integer/);
});
