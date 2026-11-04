// The signature layer's own policies (core/workflow/signature-layer.ts, architecture §7.3, D95 b; fix round 2,
// architecture-r1-4): signaturesOver places nothing over an analysis with an error, and signatureNotes keeps the locator's notes only
// for a run that uses signatures (--no-signatures, enabled = false drop them).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseSignatureFile } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile } from '../../../src/core/signatures/schema.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { signatureNotes, signaturesOver } from '../../../src/core/workflow/signature-layer.ts';
import { diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { RomCodes } from '../../../src/foundation/rom/codes.ts';
import { listSyntheticFixtures, readFixtureRom, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';

function fixture(name: string): ReturnType<typeof readFixtureRom> {
  const found = listSyntheticFixtures().find((f) => f.name === name);
  assert.ok(found !== undefined, `fixture ${name}`);
  return readFixtureRom(found);
}

const LIBFIX = ((): SignatureFile => {
  const parsed = parseSignatureFile(JSON.parse(readFileSync(join(SYNTHETIC_ROOT, 'library', 'signatures.golden.json'), 'utf8')));
  assert.ok(parsed.ok);
  return parsed.value;
})();

test('signaturesOver: an analysis with an error diagnostic places nothing; no files place nothing', () => {
  const rom = fixture('library-game');
  const analysis = discover(rom);
  assert.ok(signaturesOver(rom, analysis, [LIBFIX]).placements.length > 0);
  const failed = { ...analysis, diagnostics: [...analysis.diagnostics, diagnostic(RomCodes, 'E_ROM_NOT_GBA', 'a planted error')] };
  assert.deepEqual(signaturesOver(rom, failed, [LIBFIX]), { placements: [], regions: [], proposals: [], diagnostics: [] });
  assert.deepEqual(signaturesOver(rom, analysis, []).placements, []);
});

test('signatureNotes: the locator\'s notes for a run that uses signatures, none for one that does not', () => {
  const notes = [diagnostic(RomCodes, 'E_ROM_NOT_GBA', 'a note')];
  assert.deepEqual(signatureNotes(true, notes), notes);
  assert.deepEqual(signatureNotes(true, undefined), []);
  assert.deepEqual(signatureNotes(false, notes), [], '--no-signatures or [signatures] enabled = false');
});
