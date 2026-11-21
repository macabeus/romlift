// core/config/rom-sha1.ts (architecture-9, architecture-r1-7, D75 h, D76 h): a project's ROM must be the one
// romlift.toml's `[rom] sha1` records, compared case-insensitively; another is E_ROM_SHA1_MISMATCH on the TOML.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { romSha1Problems } from '../../../src/core/config/rom-sha1.ts';

const SHA1 = 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b';
const config = { rom: { path: 'baserom.gba', sha1: SHA1 } };

test('the recorded ROM is fine, in either case', () => {
  assert.deepEqual(romSha1Problems({ sha1: SHA1 }, config), []);
  assert.deepEqual(romSha1Problems({ sha1: SHA1.toUpperCase() }, config), []);
});

test('another ROM is E_ROM_SHA1_MISMATCH on romlift.toml, naming both SHA-1s', () => {
  const other = '037702b1febd5c9535262165bf030551d153de81';
  const found = romSha1Problems({ sha1: other }, config);
  assert.deepEqual(
    found.map((d) => [d.code, d.path]),
    [['E_ROM_SHA1_MISMATCH', 'romlift.toml']],
  );
  assert.match(found[0]?.message ?? '', new RegExp(`${other}.*${SHA1}`));
});
