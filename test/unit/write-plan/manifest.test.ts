// The manifest codec (architecture §6.4, D17): canonical JSON (sorted keys, one newline), a strict reader
// that returns an error value for anything that is not a schema-1 manifest, and the generated roots.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeManifest, encodeManifest, isProjectPath } from '../../../src/core/write-plan/manifest.ts';
import {
  GENERATED_ROOTS,
  JOURNAL_PATH,
  LOCK_PATH,
  MANIFEST_PATH,
  ROMLIFT_DIR,
  underGeneratedRoot,
} from '../../../src/core/write-plan/types.ts';
import type { Manifest } from '../../../src/core/write-plan/types.ts';

const SHA = 'a0a298d9dba1ba15d04a42fc2eb35893d1a9569b';

const MANIFEST: Manifest = {
  schema: 1,
  romlift: '0.0.0',
  files: {
    'ldscript.txt': { sha1: SHA, writer: 'ldscript' },
    'asm/nonmatchings/main/AgbMain.s': { sha1: SHA, writer: 'function' },
    'asm/crt0.s': { sha1: SHA, writer: 'crt0' },
  },
};

function text(m: Manifest): string {
  return [...encodeManifest(m)].join('');
}

test('a manifest encodes canonically and decodes to itself', () => {
  const t = text(MANIFEST);
  assert.ok(t.endsWith('}\n'));
  assert.ok(
    t.indexOf('"asm/crt0.s"') < t.indexOf('"asm/nonmatchings/main/AgbMain.s"') &&
      t.indexOf('"asm/nonmatchings') < t.indexOf('"ldscript.txt"'),
    'paths sorted by code unit',
  );
  assert.ok(
    t.indexOf('"files"') < t.indexOf('"romlift"') && t.indexOf('"romlift"') < t.indexOf('"schema"'),
    'keys sorted',
  );
  const back = decodeManifest(t);
  assert.ok(back.ok);
  assert.deepEqual(back.manifest, MANIFEST);
  assert.equal(text(back.manifest), t);
});

test('an empty manifest round-trips, and a "__proto__" path stays an own member', () => {
  const empty: Manifest = { schema: 1, romlift: '1.2.3', files: {} };
  assert.deepEqual(decodeManifest(text(empty)), { ok: true, manifest: empty });
  const decoded = decodeManifest(`{"schema":1,"romlift":"1","files":{"__proto__":{"sha1":"${SHA}","writer":"data"}}}`);
  assert.ok(decoded.ok);
  assert.deepEqual(Object.keys(decoded.manifest.files), ['__proto__']);
});

test('anything else decodes to an error value, never a throw', () => {
  const bad: readonly [string, RegExp][] = [
    ['not json', /not JSON/],
    ['[]', /not a JSON object/],
    ['{"schema":2,"romlift":"1","files":{}}', /schema 2/],
    ['{"schema":1,"files":{}}', /romlift/],
    ['{"schema":1,"romlift":"1","files":[]}', /files is not an object/],
    ['{"schema":1,"romlift":"1","files":{},"extra":1}', /unknown member "extra"/],
    [`{"schema":1,"romlift":"1","files":{"../x":{"sha1":"${SHA}","writer":"data"}}}`, /not a project path/],
    [`{"schema":1,"romlift":"1","files":{"/abs":{"sha1":"${SHA}","writer":"data"}}}`, /not a project path/],
    ['{"schema":1,"romlift":"1","files":{"a.s":{"sha1":"ABC","writer":"data"}}}', /SHA-1/],
    [`{"schema":1,"romlift":"1","files":{"a.s":{"sha1":"${SHA}","writer":"nope"}}}`, /writer "nope"/],
    [`{"schema":1,"romlift":"1","files":{"a.s":{"sha1":"${SHA}","writer":"data","x":0}}}`, /unknown member "x"/],
  ];
  for (const [input, message] of bad) {
    const result = decodeManifest(input);
    assert.equal(result.ok, false, input);
    if (!result.ok) assert.match(result.error, message, input);
  }
});

test('project paths are normalised and relative', () => {
  for (const ok of ['asm/x.s', 'ldscript.txt', '.romlift/manifest.json', 'a/b/c']) assert.ok(isProjectPath(ok), ok);
  for (const bad of ['', '/x', 'a//b', 'a/./b', 'a/../b', '..', 'a\\b', 'a/', 'x\0y'])
    assert.ok(!isProjectPath(bad), JSON.stringify(bad));
});

test('the generated roots and romlift state paths', () => {
  assert.deepEqual(GENERATED_ROOTS, [
    'asm/',
    'data/',
    'expected/',
    'ldscript.txt',
    'symbols.ld',
    'modules.mk',
    'objdiff.json',
  ]);
  assert.equal(ROMLIFT_DIR, '.romlift');
  assert.equal(MANIFEST_PATH, '.romlift/manifest.json');
  assert.equal(JOURNAL_PATH, '.romlift/journal.json');
  assert.equal(LOCK_PATH, '.romlift/lock');
  assert.ok(underGeneratedRoot('asm/nonmatchings/main/AgbMain.s'));
  assert.ok(underGeneratedRoot('symbols.ld'));
  assert.ok(!underGeneratedRoot('symbols.ld.bak'));
  assert.ok(!underGeneratedRoot('src/main.c'));
  assert.ok(!underGeneratedRoot('asmx/a.s'));
});
