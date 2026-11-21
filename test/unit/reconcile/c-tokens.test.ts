// tokenizeC (architecture §6.6): comments, strings, character literals, preprocessor lines, identifiers, numbers and
// punctuators, with offsets and lines; nothing inside a comment, literal or directive is ever read as code; an
// unclosed one is a token marked unterminated, and the tokenizer never throws.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTrivia, tokenizeC } from '../../../src/core/reconcile/c-tokens.ts';
import type { CToken } from '../../../src/core/reconcile/c-tokens.ts';

function kinds(text: string): readonly (readonly [string, string])[] {
  return tokenizeC(text).map((t) => [t.kind, t.text] as const);
}

test('every kind of token, with whitespace skipped', () => {
  assert.deepEqual(kinds('int x = 0x1F + y->z; // done\n/* c */ s = "a;b" \'c\';'), [
    ['identifier', 'int'],
    ['identifier', 'x'],
    ['punctuator', '='],
    ['number', '0x1F'],
    ['punctuator', '+'],
    ['identifier', 'y'],
    ['punctuator', '->'],
    ['identifier', 'z'],
    ['punctuator', ';'],
    ['comment', '// done'],
    ['comment', '/* c */'],
    ['identifier', 's'],
    ['punctuator', '='],
    ['string', '"a;b"'],
    ['char', "'c'"],
    ['punctuator', ';'],
  ]);
});

test('offsets and lines: text.slice(start, end) is the token, line is where it starts', () => {
  const text = 'a\n  /* two\nlines */ b\n"s"';
  const tokens = tokenizeC(text);
  for (const t of tokens) assert.equal(text.slice(t.start, t.end), t.text);
  assert.deepEqual(
    tokens.map((t) => [t.text, t.line]),
    [
      ['a', 1],
      ['/* two\nlines */', 2],
      ['b', 3],
      ['"s"', 4],
    ],
  );
});

test('longest-match punctuators and pp-numbers', () => {
  assert.deepEqual(kinds('a<<=b... c>>d ++e 1.5e+3f .5 1e-2'), [
    ['identifier', 'a'],
    ['punctuator', '<<='],
    ['identifier', 'b'],
    ['punctuator', '...'],
    ['identifier', 'c'],
    ['punctuator', '>>'],
    ['identifier', 'd'],
    ['punctuator', '++'],
    ['identifier', 'e'],
    ['number', '1.5e+3f'],
    ['number', '.5'],
    ['number', '1e-2'],
  ]);
});

test('a preprocessor line runs to its end, across splices and comments that span lines; a `#` elsewhere is a punctuator', () => {
  const text = '#define A(x) \\\n  x /* a\n b */ + 1\nint y; # z\n  #include "a//b.h"\n';
  const tokens = tokenizeC(text);
  assert.deepEqual(
    tokens.map((t) => [t.kind, t.text]),
    [
      ['preprocessor', '#define A(x) \\\n  x /* a\n b */ + 1'],
      ['identifier', 'int'],
      ['identifier', 'y'],
      ['punctuator', ';'],
      ['punctuator', '#'],
      ['identifier', 'z'],
      ['preprocessor', '#include "a//b.h"'],
    ],
  );
  assert.deepEqual(
    tokenizeC('/* x */ #if 1').map((t) => t.kind),
    ['comment', 'preprocessor'],
    'a comment keeps the line start',
  );
});

test('nothing inside a comment or a literal is code: INCLUDE_ASM in a string or comment is no identifier', () => {
  const text = '/* INCLUDE_ASM("a", b); */ "INCLUDE_ASM(\\"a\\", b);" // INCLUDE_ASM\n\'\\\'\'';
  assert.deepEqual(
    tokenizeC(text).filter((t) => t.kind === 'identifier'),
    [],
  );
  assert.deepEqual(
    tokenizeC(text).map((t) => t.kind),
    ['comment', 'string', 'comment', 'char'],
  );
});

test('an unclosed comment, string or character literal is one unterminated token; the tokenizer never throws', () => {
  const unclosed = (text: string): CToken | undefined => tokenizeC(text).at(-1);
  assert.deepEqual([unclosed('a /* b')?.kind, unclosed('a /* b')?.terminated], ['comment', false]);
  assert.deepEqual([unclosed('x = "abc\nint')?.kind], ['identifier'], 'a string ends at its line');
  assert.equal(tokenizeC('x = "abc\nint').find((t) => t.kind === 'string')?.terminated, false);
  assert.equal(unclosed("'a")?.terminated, false);
  assert.equal(unclosed('#if "x')?.terminated, false);
  assert.equal(unclosed('// line comment')?.terminated, true);
  for (const junk of ['\\', '@`', 'é中', '"\\', "'\\\n", '/*/', '#\\\n']) assert.doesNotThrow(() => tokenizeC(junk));
  assert.deepEqual(kinds('@ é'), [
    ['other', '@'],
    ['other', 'é'],
  ]);
});

test('CRLF line ends and line splices between tokens', () => {
  const text = 'a\r\nb \\\n c\r\n#x\r\n';
  assert.deepEqual(
    tokenizeC(text).map((t) => [t.kind, t.text.trimEnd(), t.line]),
    [
      ['identifier', 'a', 1],
      ['identifier', 'b', 2],
      ['identifier', 'c', 3],
      ['preprocessor', '#x', 4],
    ],
  );
});

test('isTrivia: comments and preprocessor lines', () => {
  assert.deepEqual(tokenizeC('/* a */ #x\nb').map(isTrivia), [true, true, false]);
});
