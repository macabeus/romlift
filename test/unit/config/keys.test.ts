// The TOML outline and the address-key checks (architecture §6.5, D22): every header and key statement with its
// line and offsets, strings and comments that look like keys ignored; E_TOML_KEY_SPELLING for a key that is not 0x
// and eight upper-case hex digits; E_DUPLICATE_ADDRESS for an address defined twice in one table, however it is
// written, each with line numbers.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addressKey,
  addressKeyUses,
  addressOfKey,
  checkAddressKeys,
  isAddressKey,
  outlineToml,
} from '../../../src/core/config/keys.ts';

function codes(text: string): string[] {
  return checkAddressKeys(outlineToml(text)).map((d) => `${d.code} ${d.message}`);
}

test('isAddressKey takes exactly 0x and eight upper-case hex digits', () => {
  assert.equal(isAddressKey('0x08000470'), true);
  assert.equal(isAddressKey('0xFFFFFFFF'), true);
  for (const bad of ['0x8000470', '0x080004700', '0x0800047a', '0X08000470', '08000470', 'main', '0x0800047G', '']) {
    assert.equal(isAddressKey(bad), false, bad);
  }
  assert.equal(addressKey(0x0800_0470), '0x08000470');
  assert.equal(addressOfKey('0x8000470'), 0x0800_0470);
  assert.equal(addressOfKey('0X0800047a'), 0x0800_047a);
  assert.equal(addressOfKey('0x100000000'), undefined);
  assert.equal(addressOfKey('main'), undefined);
});

test('the outline lists headers and statements with their lines, tables and offsets', () => {
  const text = [
    'schema = 1 # top',
    '',
    '[rom]',
    'path = "baserom.gba"',
    '[[modules]]',
    'name = "a"',
    '[[modules]]  # second',
    'name = "b"',
    'cflags = [',
    '  "-O1", # a comment inside an array',
    '  "-g",',
    ']',
    '[functions]',
    '  0x08000470 = "AgbMain"   # trailing',
    '"0x08000480" = { name = "Quoted" }',
    '[functions.0x08000490]',
    "name = 'Table'",
  ].join('\n');
  const outline = outlineToml(text);
  assert.deepEqual(
    outline.headers.map((h) => [h.line, h.path.join('.'), h.array, h.index]),
    [
      [3, 'rom', false, -1],
      [5, 'modules', true, 0],
      [7, 'modules', true, 1],
      [13, 'functions', false, -1],
      [16, 'functions.0x08000490', false, -1],
    ],
  );
  assert.deepEqual(
    outline.keys.map((k) => [k.line, k.endLine, k.table.join('.'), k.tableIndex, k.key.join('.')]),
    [
      [1, 1, '', -1, 'schema'],
      [4, 4, 'rom', -1, 'path'],
      [6, 6, 'modules', 0, 'name'],
      [8, 8, 'modules', 1, 'name'],
      [9, 12, 'modules', 1, 'cflags'],
      [14, 14, 'functions', -1, '0x08000470'],
      [15, 15, 'functions', -1, '0x08000480'],
      [17, 17, 'functions.0x08000490', -1, 'name'],
    ],
  );
  const entry = outline.keys[5];
  assert.ok(entry !== undefined);
  assert.equal(text.slice(entry.lineStart, entry.start), '  ');
  assert.equal(text.slice(entry.start, entry.valueEnd), '0x08000470 = "AgbMain"');
  assert.equal(text.slice(entry.comment, entry.lineEnd), '# trailing');
  assert.equal(outline.keys[0]?.comment, text.indexOf('# top'));
  assert.equal(outline.keys[1]?.comment, -1);
});

test('keys inside multi-line strings, comments and arrays are not keys', () => {
  const text = [
    '[functions]',
    '# 0x08000470 = "Commented"',
    '0x08000480 = { name = "A", from = "x" }',
    '[symbols]',
    '0x03000000 = { name = "B", aliases = [',
    '  "C", # 0x03000004 = "D"',
    '] }',
    '[notes]',
    'text = """',
    '0x08000470 = "InAString"',
    '[functions]',
    '"""',
    "raw = '''",
    '0x08000470 = "InALiteral"',
    "'''",
    '0x8000470 = "Real"',
  ].join('\n');
  const uses = addressKeyUses(outlineToml(text));
  assert.deepEqual(
    uses.map((u) => [u.table, u.spelling, u.line, u.shape, u.singleLine]),
    [
      ['functions', '0x08000480', 3, 'line', true],
      ['symbols', '0x03000000', 5, 'line', false],
    ],
  );
  assert.deepEqual(codes(text), []);
});

test('a misspelt address key is E_TOML_KEY_SPELLING at its line, with the right spelling', () => {
  const text = [
    '[functions]',
    '0x8000470 = "A"',
    '0x0800047a = "B"',
    '[symbols]',
    '0X03000000 = "C"',
    'gFoo = "D"',
    '[functions.0x8000480]',
    'name = "E"',
  ].join('\n');
  assert.deepEqual(codes(text), [
    'E_TOML_KEY_SPELLING line 2: [functions] key 0x8000470 is not 0x followed by eight upper-case hex digits; write 0x08000470',
    'E_TOML_KEY_SPELLING line 3: [functions] key 0x0800047a is not 0x followed by eight upper-case hex digits; write 0x0800047A',
    'E_TOML_KEY_SPELLING line 5: [symbols] key 0X03000000 is not 0x followed by eight upper-case hex digits; write 0x03000000',
    'E_TOML_KEY_SPELLING line 6: [symbols] key gFoo is not 0x followed by eight upper-case hex digits; write an address such as 0x08000470',
    'E_TOML_KEY_SPELLING line 7: [functions] key 0x8000480 is not 0x followed by eight upper-case hex digits; write 0x08000480',
  ]);
  const found = checkAddressKeys(outlineToml(text));
  assert.equal(found[0]?.addr, 0x0800_0470);
  assert.equal(found[3]?.addr, undefined);
});

test('an address defined twice is E_DUPLICATE_ADDRESS, however the two definitions are written', () => {
  assert.deepEqual(codes('[functions]\n0x08000470 = "A"\n0x08000470 = "A"\n'), [
    'E_DUPLICATE_ADDRESS line 3: [functions] lists 0x08000470 twice, at lines 2 and 3',
  ]);
  assert.deepEqual(codes('[functions]\n0x08000470 = "A"\n\n[functions.0x08000470]\nname = "B"\n'), [
    'E_DUPLICATE_ADDRESS line 4: [functions] lists 0x08000470 twice, at lines 2 and 4',
  ]);
  assert.deepEqual(codes('[functions]\n0x08000470 = "A"\n0x08000470.name = "B"\n'), [
    'E_DUPLICATE_ADDRESS line 3: [functions] lists 0x08000470 twice, at lines 2 and 3',
  ]);
  assert.deepEqual(codes('[functions]\n0x08000470 = "A"\n0x8000470 = "B"\n0x08000470 = "C"\n'), [
    'E_DUPLICATE_ADDRESS line 3: [functions] lists 0x08000470 3 times, at lines 2, 3 and 4',
    'E_TOML_KEY_SPELLING line 3: [functions] key 0x8000470 is not 0x followed by eight upper-case hex digits; write 0x08000470',
  ]);
  assert.deepEqual(codes('functions.0x08000470 = "A"\n[functions]\n0x08000470 = "B"\n'), [
    'E_DUPLICATE_ADDRESS line 3: [functions] lists 0x08000470 twice, at lines 1 and 3',
  ]);
  const found = checkAddressKeys(outlineToml('[symbols]\n0x03000000 = "A"\n0x03000000 = "A"\n'));
  assert.deepEqual(
    found.map((d) => [d.code, d.addr]),
    [['E_DUPLICATE_ADDRESS', 0x0300_0000]],
  );
});

test('one entry written as a table or as dotted keys is defined once; the same address in both tables is not a duplicate', () => {
  assert.deepEqual(codes('[functions.0x08000470]\nname = "A"\nmode = "arm"\naliases = ["B"]\n'), []);
  assert.deepEqual(codes('[functions]\n0x08000470.name = "A"\n0x08000470.mode = "arm"\n'), []);
  assert.deepEqual(codes('[functions]\n0x08000470 = "A"\n[symbols]\n0x08000470 = "gA"\n'), []);
  assert.deepEqual(codes('[[functions]]\nname = "A"\n'), []);
});

test('the outline never throws and stops at nothing: unclosed strings and brackets, stray text, CRLF', () => {
  for (const text of [
    '[functions\n0x08000470 = "A"\n',
    'a = "unclosed\n[functions]\n0x08000470 = "B"\n',
    'a = [1, 2\n',
    'x = """\nnever closed',
    '= 1\n[',
    '\r\n[functions]\r\n0x08000470 = "A"\r\n',
  ]) {
    assert.doesNotThrow(() => checkAddressKeys(outlineToml(text)), JSON.stringify(text));
  }
  const crlf = outlineToml('[functions]\r\n0x08000470 = "A" # c\r\n0x08000480 = "B"\r\n');
  assert.deepEqual(
    crlf.keys.map((k) => [k.line, k.key[0]]),
    [
      [2, '0x08000470'],
      [3, '0x08000480'],
    ],
  );
  const text = '[functions]\r\n0x08000470 = "A"\r\n';
  const entry = outlineToml(text).keys[0];
  assert.equal(entry === undefined ? '' : text.slice(entry.start, entry.lineEnd), '0x08000470 = "A"');
});
