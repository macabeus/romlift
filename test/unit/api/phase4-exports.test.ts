// The phase-4 surface the lead froze (D74), through the package entry points (D37, D43): the scaffold contract
// and the C-stub constants from `romlift`. The owners' exports (init, parseConfig, renderScaffold, ...) are theirs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as romlift from 'romlift';

test('romlift exports the frozen phase-4 values', () => {
  for (const name of [
    'decodeScaffoldManifest',
    'decodeAgbccPin',
    'scaffoldVars',
    'placeholderValues',
    'placeholderText',
    'placeholdersIn',
    'SCAFFOLD_PLACEHOLDERS',
    'SCAFFOLD_ROM_FILE',
    'ROMLIFT_RENDERED_TARGETS',
    'includeAsmStatement',
    'INCLUDE_ASM_HEADER',
    'INCLUDE_ASM_HEADER_PATH',
    'C_STUB_HEADER',
    'NONMATCHINGS_ROOT',
  ]) {
    assert.ok(name in romlift, name);
  }
});

