// The C-data part of the structural ldscript check (core/verify/link-scripts.ts, architecture §6.6, D74 f): outside
// every section, each C unit's check section and ASSERT in ROM order, exactly as core/model/c-unit.ts spells them,
// and none for an asm or data unit; any other difference is E_SELF_CHECK_TEXT at its line.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ldscriptText } from '../../../src/core/emit/writers/ldscript.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { checkLdscript } from '../../../src/core/verify/link-scripts.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';

const rom = romWith([], { size: 0x400 });

function model(mainKind: 'asm' | 'c', otherKind: 'asm' | 'c'): Model {
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'main', kind: mainKind, chunks: [{ name: 'Func', items: [dataItem(0x0800_00c0, 0x40)] }] },
      { name: 'other', kind: otherKind, chunks: [{ name: 'Other', items: [dataItem(0x0800_0100, 0x100)] }] },
      { name: 'data', kind: 'data', chunks: [{ kind: 'data', name: 'data', items: [dataItem(0x0800_0200, 0x200)] }] },
    ],
  });
}

function messages(m: Model, text: string): string[] {
  return checkLdscript(m, 'ldscript.txt', text).map((d) => `${d.code} ${d.message}`);
}

const DATA_MAIN = '    .c_data_main (NOLOAD) : { *src/main.o(.rodata* .data* .bss* COMMON) }\n';
const ASSERT_MAIN = '    ASSERT(SIZEOF(.c_data_main) == 0, "src/main.c defines data; see AGENTS.md (romlift does not place C data yet)")\n';

test('the writer\'s script passes, with and without C units', () => {
  for (const m of [model('asm', 'asm'), model('c', 'asm'), model('c', 'c')]) assert.deepEqual(messages(m, ldscriptText(m)), []);
});

test('a missing ASSERT, a missing check section, or both for a C unit fail at the end of the script', () => {
  const m = model('c', 'asm');
  const text = ldscriptText(m);
  assert.deepEqual(messages(m, text.replace(ASSERT_MAIN, '')), [
    'E_SELF_CHECK_TEXT ldscript.txt line 12: lacks `ASSERT(SIZEOF(.c_data_main) == 0, "src/main.c defines data; see AGENTS.md (romlift does not place C data yet)")`, which C unit main needs (at 0x080000C0)',
  ]);
  assert.match(messages(m, text.replace(DATA_MAIN, '').replace(ASSERT_MAIN, ''))[0] ?? '', /lacks `\.c_data_main \(NOLOAD\)/);
});

test('a changed message, input pattern or order, or a check of an asm unit, fails at its line', () => {
  const m = model('c', 'c');
  const text = ldscriptText(m);
  const lineOf = (t: string, needle: string): number => t.split('\n').findIndex((l) => l.includes(needle)) + 1;
  const message = text.replace('see AGENTS.md', 'see README.md');
  assert.match(messages(m, message)[0] ?? '', new RegExp(`line ${lineOf(message, 'README')}: holds \`ASSERT\\(SIZEOF\\(\\.c_data_main\\) == 0, "src/main\\.c defines data; see README\\.md`));
  const pattern = text.replace('*src/main.o(', 'build/src/main.o(');
  assert.match(messages(m, pattern)[0] ?? '', /holds `\.c_data_main \(NOLOAD\) : \{ build\/src\/main\.o\(/);
  // main's pair after other's: the first C-data line is other's where main's comes first in ROM order.
  const swapped = text.replace(`${DATA_MAIN}${ASSERT_MAIN}`, '').replace(/\}\n$/, `${DATA_MAIN}${ASSERT_MAIN}}\n`);
  assert.match(messages(m, swapped)[0] ?? '', /where C unit main needs `\.c_data_main/);
  const asm = model('asm', 'c');
  assert.match(messages(asm, ldscriptText(model('c', 'c')))[0] ?? '', /build\/src\/main\.o|C unit other needs/);
  const extra = ldscriptText(asm).replace(/\}\n$/, `${DATA_MAIN}}\n`);
  assert.match(messages(asm, extra)[0] ?? '', /holds `\.c_data_main \(NOLOAD\).*`, which no C unit of the model needs there/);
});
