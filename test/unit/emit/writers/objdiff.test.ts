// The `objdiff` writer (architecture §6.3, §6.8, roadmap 6.F, D92, D101): objdiff.json for objdiff-cli 3.7.2 (its
// config.schema.json's field names): `$schema`, `custom_make`, `build_target` false, `build_base` true, one unit per
// generated C module in ROM order (target build/expected/<module>.o, base build/src/<module>.o, its source
// src/<module>.c), and `options.functionRelocDiffs = none`, as objdiff-cli's report scores; deterministic JSON with a
// final newline.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  OBJDIFF_SCHEMA_URL,
  objdiffConfig,
  objdiffText,
  objdiffWriter,
} from '../../../../src/core/emit/writers/objdiff.ts';
import type { Model } from '../../../../src/core/model/types.ts';
import { dataItem, modelOf, romWith } from '../../../helpers/model.ts';

const rom = romWith([], { size: 0x400 });
const CX = { decomp: { defined: [] } };

function model(): Model {
  return modelOf(rom, {
    modules: [
      { name: 'rom_header', chunks: [{ kind: 'header', name: 'rom_header', items: [dataItem(0x0800_0000, 0xc0)] }] },
      { name: 'main', kind: 'c', cflags: ['-O2'], chunks: [{ name: 'F', items: [dataItem(0x0800_00c0, 0x40)] }] },
      {
        name: 'm4a',
        library: { name: 'm4a', version: '2001' },
        chunks: [{ name: 'SoundMain', items: [dataItem(0x0800_0100, 0x40)] }],
      },
      {
        name: 'other',
        kind: 'c',
        compiler: 'old_agbcc',
        cflags: ['-O2', '-fprologue-bugfix'],
        chunks: [{ name: 'G', items: [dataItem(0x0800_0140, 0x40)] }],
      },
      { name: 'kept', kind: 'c', generated: false, chunks: [{ name: 'H', items: [dataItem(0x0800_0180, 0x80)] }] },
      { name: 'data', kind: 'data', chunks: [{ kind: 'data', name: 'data', items: [dataItem(0x0800_0200, 0x200)] }] },
    ],
  });
}

test('one unit per generated C module, in ROM order, and the fixed project keys', () => {
  const m = model();
  const [entry] = [...objdiffWriter.emit(rom, m, CX, null)];
  assert.equal(objdiffWriter.scope, 'global');
  assert.ok(entry !== undefined && 'text' in entry);
  assert.deepEqual([entry.path, entry.ownership, entry.writer], ['objdiff.json', 'generated', 'objdiff']);
  assert.equal(entry.text, objdiffText(m));
  assert.equal(
    entry.text,
    `{
  "$schema": "${OBJDIFF_SCHEMA_URL}",
  "custom_make": "make",
  "build_target": false,
  "build_base": true,
  "units": [
    {
      "name": "main",
      "target_path": "build/expected/main.o",
      "base_path": "build/src/main.o",
      "scratch": {
        "platform": "gba",
        "compiler": "agbcc",
        "c_flags": "-O2"
      },
      "metadata": {
        "source_path": "src/main.c"
      }
    },
    {
      "name": "other",
      "target_path": "build/expected/other.o",
      "base_path": "build/src/other.o",
      "scratch": {
        "platform": "gba",
        "compiler": "old_agbcc",
        "c_flags": "-O2 -fprologue-bugfix"
      },
      "metadata": {
        "source_path": "src/other.c"
      }
    }
  ],
  "options": {
    "functionRelocDiffs": "none"
  }
}
`,
  );
  assert.equal(OBJDIFF_SCHEMA_URL, 'https://raw.githubusercontent.com/encounter/objdiff/main/config.schema.json');
});

test('a tree without C modules lists no unit', () => {
  const m = modelOf(rom, {
    modules: [{ name: 'main', chunks: [{ name: 'F', items: [dataItem(0x0800_0000, 0x400)] }] }],
  });
  assert.deepEqual(objdiffConfig(m).units, []);
});
