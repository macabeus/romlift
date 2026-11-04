// Identifier-only renames in a hand-written assembly source (D109): every GNU as symbol token equal to the old name, never
// one inside a comment, a string or a character constant, nor a longer symbol, a local label or a number.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asmSymbolTokens, renameAsmIdentifiers } from '../../../src/core/reconcile/rename-asm.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';

const SOURCE = `@ Old: the interrupt handler (Old in a comment stays)
/* Old in a block
   comment stays */
# Old after a hash that opens a line stays
\t.global Old
\t.type Old, %function
Old:\tldr r0, =Old+1 @ Old again
\tb Old ; bl Old
\t.4byte Old, OldName, .LOld, Old.end, pOld, Old$
\t.ascii "Old \\" Old"
\t.byte 'O, '\\n, 0x10, 1f
\t.size Old, .-Old
`;

test('every symbol token Old is renamed; comments, strings, character constants and longer tokens are not', () => {
  const edits = renameAsmIdentifiers(SOURCE, 'Old', 'New');
  assert.equal(
    applyTextEdits(SOURCE, edits),
    `@ Old: the interrupt handler (Old in a comment stays)
/* Old in a block
   comment stays */
# Old after a hash that opens a line stays
\t.global New
\t.type New, %function
New:\tldr r0, =New+1 @ Old again
\tb New ; bl New
\t.4byte New, OldName, .LOld, Old.end, pOld, Old$
\t.ascii "Old \\" Old"
\t.byte 'O, '\\n, 0x10, 1f
\t.size New, .-New
`,
  );
  assert.ok(edits.every((e) => e.reason === 'rename-identifier'));
});

test('a name equal to the new one, an empty name, or one only in comments plans nothing', () => {
  assert.deepEqual(renameAsmIdentifiers(SOURCE, 'Old', 'Old'), []);
  assert.deepEqual(renameAsmIdentifiers(SOURCE, '', 'New'), []);
  assert.deepEqual(renameAsmIdentifiers('@ Only here\n', 'Only', 'New'), []);
});

test('a hash inside a line is no comment; an unterminated string or comment ends at its line or the text', () => {
  assert.deepEqual(asmSymbolTokens('\tmovs r0, #Old\n', 'Old').map((t) => t.start), [11]);
  assert.deepEqual(asmSymbolTokens('\t.ascii "Old\nOld\n', 'Old').map((t) => t.start), [13]);
  assert.deepEqual(asmSymbolTokens('Old /* Old', 'Old').map((t) => t.start), [0]);
});
