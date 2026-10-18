// valid.not-pointer-table (the PoC's whyInvalid() and looksLikePointerTable()): over the aligned words
// from the entry to the reading's code end that hold an instruction, count those whose value is a
// Thumb pointer into the ROM. Instruction pairs rarely form one; a pointer table decoded as code is made
// of them. A table is at least pointerWords.minPointers pointers and a share minShare of the words.
import { contains, u32 } from '../../../../foundation/rom/rom.ts';
import { isPointedAt } from '../../pointers.ts';
import { defineRule } from '../define-rule.ts';

export default defineRule({
  meta: {
    id: 'valid.not-pointer-table',
    summary: 'the words of the reading are not mostly Thumb code pointers',
    restsOn: 'two Thumb instructions rarely form an odd word pointing at a word-aligned ROM address',
    recovers: 'tables of function pointers decoded as code',
    reads: ['readings', 'pointer-index', 'rom'],
    adds: ['validity'],
  },
  kind: 'valid',
  reason: 'pointer-table',
  intrinsic: true,
  check(r, v) {
    const { minPointers, minShare } = v.profile.pointerWords;
    const end = r.codeEnd;
    let words = 0;
    let pointers = 0;
    for (let a = (r.entry + 3) & ~3; a + 4 <= end; a += 4) {
      if (!r.insnAt.has(a) && !r.insnAt.has(a + 2)) continue;
      words += 1;
      if (contains(v.rom, a, 4) && isPointedAt(v.pointers, u32(v.rom, a) - 1)) pointers += 1;
    }
    if (pointers < minPointers || pointers < minShare * words) return undefined;
    return `its words are Thumb code pointers: a table, not code (${pointers} of ${words})`;
  },
});
