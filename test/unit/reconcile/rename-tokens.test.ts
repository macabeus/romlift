// renameIdentifiers (architecture §6.6, roadmap 6.E, D92): the identifier tokens equal to the old name become the new
// one, in code and in directive bodies; comments, strings, character literals, pp-numbers, longer identifiers, header
// names and #error messages never change.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tokenizeC } from '../../../src/core/reconcile/c-tokens.ts';
import { identifierTokens, renameIdentifiers } from '../../../src/core/reconcile/rename-tokens.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';

function renamed(text: string, from = 'Old', to = 'New'): string {
  return applyTextEdits(text, renameIdentifiers(text, from, to));
}

test('identifier tokens of code are renamed, each edit exactly its token', () => {
  const text = 'void Old(void);\nvoid Caller(void) { Old(); (Old)(); }\nINCLUDE_ASM("asm/nonmatchings/main", Old);\n';
  assert.equal(
    renamed(text),
    'void New(void);\nvoid Caller(void) { New(); (New)(); }\nINCLUDE_ASM("asm/nonmatchings/main", New);\n',
  );
  const edits = renameIdentifiers(text, 'Old', 'New');
  assert.equal(edits.length, 4);
  for (const e of edits) {
    assert.equal(text.slice(e.start, e.end), 'Old');
    assert.equal(e.reason, 'rename-identifier');
    assert.equal(e.text, 'New');
  }
});

test('comments, strings and character literals are never touched', () => {
  const text =
    '/* Old */ // Old\nconst char *s = "Old";\nchar c = \'O\';\nconst char *t = "a \\"Old\\" b"; /* Old\n Old */\nint Old;\n';
  assert.equal(
    renamed(text),
    '/* Old */ // Old\nconst char *s = "Old";\nchar c = \'O\';\nconst char *t = "a \\"Old\\" b"; /* Old\n Old */\nint New;\n',
  );
  // A multi-character constant spelling the name is a character literal too.
  assert.equal(renamed("int x = 'Old';\n"), "int x = 'Old';\n");
});

test('partial identifiers and pp-numbers are untouched', () => {
  const text = 'int OldName, pOld, Old_, _Old, Old2, Old$x;\nint y = 1Old;\nint s = a.Old + b->Old;\n';
  assert.equal(renamed(text), 'int OldName, pOld, Old_, _Old, Old2, Old$x;\nint y = 1Old;\nint s = a.New + b->New;\n');
  assert.deepEqual(renameIdentifiers('int OldName;', 'Old', 'New'), []);
});

test('directive bodies are tokenized again: #define, #ifdef, #undef, a function-like macro and a spliced line', () => {
  const text =
    '#define ALIAS Old\n#ifdef Old\n#undef Old\n#endif\n#define CALL(x) Old(x) /* Old */ "Old"\n#define LONG \\\n    Old\n  #  if defined(Old)\n#endif\n';
  const want =
    '#define ALIAS New\n#ifdef New\n#undef New\n#endif\n#define CALL(x) New(x) /* Old */ "Old"\n#define LONG \\\n    New\n  #  if defined(New)\n#endif\n';
  assert.equal(renamed(text), want);
  assert.equal(identifierTokens(text, 'Old').length, 6);
});

test('a header name and an #error or #warning message are text, not code', () => {
  const text =
    '#include <Old.h>\n#include "Old.h"\n#include_next <Old/x.h>\n#error Old is gone\n#warning Old\n#pragma weak Old\n#define Old 1\n';
  assert.equal(
    renamed(text),
    '#include <Old.h>\n#include "Old.h"\n#include_next <Old/x.h>\n#error Old is gone\n#warning Old\n#pragma weak New\n#define New 1\n',
  );
  // An include through a macro is code: its operand names the macro.
  assert.equal(renamed('#include Old\n'), '#include New\n');
});

test('the tokens other than the renamed identifiers are exactly those of the input', () => {
  const text = '﻿/* Old */\r\n#define A Old\r\nvoid Old(void) { char c = \'"\'; const char *s = "Old"; }\r\n';
  const before = tokenizeC(text).map((t) => (t.kind === 'identifier' && t.text === 'Old' ? 'X' : t.text));
  const after = tokenizeC(renamed(text, 'Old', 'Renamed')).map((t) =>
    t.kind === 'identifier' && t.text === 'Renamed' ? 'X' : t.text,
  );
  assert.deepEqual(
    after,
    before.map((t) => t.replace('#define A Old', '#define A Renamed')),
  );
  assert.ok(renamed(text, 'Old', 'Renamed').startsWith('﻿/* Old */\r\n#define A Renamed\r\n'), 'the BOM and CRLF stay');
});

test('nothing to do: the same name, an empty name, a name that does not occur, an unterminated comment', () => {
  assert.deepEqual(renameIdentifiers('int Old;', 'Old', 'Old'), []);
  assert.deepEqual(renameIdentifiers('int Old;', '', 'New'), []);
  assert.deepEqual(renameIdentifiers('int Other;', 'Old', 'New'), []);
  assert.equal(renamed('int Old; /* Old'), 'int New; /* Old');
  assert.equal(renamed('const char *s = "Old'), 'const char *s = "Old', 'an unterminated string is still a string');
});
