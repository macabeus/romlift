// The binutils runner: PATH lookup, E_TOOLCHAIN_MISSING, and assembling a few lines with the real
// arm-none-eabi-as (skipped as unavailable when the toolchain is not installed).
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { DIALECT } from '../../../../src/foundation/asm/dialect.ts';
import {
  assembleWithBinutils,
  binutilsVersions,
  findBinutils,
  findExecutable,
  linkWithBinutils,
} from '../../../../src/shell/toolchain/binutils.ts';
import { stubBinutils } from './stub.ts';

const tools = findBinutils(process.env);
const available = !('code' in tools);

test('a PATH without the tools gives E_TOOLCHAIN_MISSING naming each', async () => {
  const empty = await mkdtemp(path.join(tmpdir(), 'romlift-path-'));
  try {
    const result = findBinutils({ PATH: empty });
    assert.ok('code' in result);
    assert.equal(result.code, 'E_TOOLCHAIN_MISSING');
    assert.equal(result.severity, 'error');
    assert.match(result.message, /arm-none-eabi-as, arm-none-eabi-ld, arm-none-eabi-objcopy/);
    assert.ok('code' in findBinutils({}));
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('the PATH is searched in order for executables', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-path-'));
  try {
    for (const tool of ['as', 'ld', 'objcopy']) {
      const file = path.join(dir, `arm-none-eabi-${tool}`);
      await writeFile(file, '#!/bin/sh\n');
      await chmod(file, 0o755);
    }
    await writeFile(path.join(dir, 'arm-none-eabi-ld'), '');
    await chmod(path.join(dir, 'arm-none-eabi-ld'), 0o644);
    const missingLd = findBinutils({ PATH: dir });
    assert.ok('code' in missingLd && /arm-none-eabi-ld$/.test(missingLd.message));
    await chmod(path.join(dir, 'arm-none-eabi-ld'), 0o755);
    const found = findBinutils({ PATH: [path.join(dir, 'missing'), dir].join(path.delimiter) });
    assert.deepEqual(found, {
      as: path.join(dir, 'arm-none-eabi-as'),
      ld: path.join(dir, 'arm-none-eabi-ld'),
      objcopy: path.join(dir, 'arm-none-eabi-objcopy'),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'assembleWithBinutils returns the .text bytes',
  { skip: available ? false : 'unavailable: toolchain' },
  async () => {
    const source = `${DIALECT.preamble('thumb')}\tthumb_func_start f\nf:\n\tpush {r4, lr}\n\tbx lr\n`;
    const result = await assembleWithBinutils(source, {
      mode: 'thumb',
      files: { 'include/macros.inc': DIALECT.macrosInc },
    });
    assert.ok(result.ok, result.ok ? '' : result.stderr);
    assert.deepEqual([...result.bytes], [0x10, 0xb5, 0x70, 0x47]);
    // The relocatable object itself, for a caller that reads its symbols and relocations (bench objdiff).
    assert.deepEqual([...result.object.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
    const arm = await assembleWithBinutils('.syntax unified\n.arm\n\tbx lr\n');
    assert.ok(arm.ok);
    assert.deepEqual([...arm.bytes], [0x1e, 0xff, 0x2f, 0xe1]);
  },
);

test(
  'an assembler error is returned with its stderr and E_TOOLCHAIN_FAILED',
  { skip: available ? false : 'unavailable: toolchain' },
  async () => {
    const result = await assembleWithBinutils('.syntax unified\n.thumb\n\tmov r0, r1\n', { mode: 'thumb' });
    assert.ok(!result.ok);
    assert.match(result.stderr, /Error: MOV Rd, Rs with two low registers/);
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      ['E_TOOLCHAIN_FAILED'],
    );
    const escape = await assembleWithBinutils('.thumb\n', { files: { '../outside.inc': '' } });
    assert.ok(!escape.ok && /outside the assembly directory/.test(escape.diagnostics[0]?.message ?? ''));
  },
);

test(
  'the versions are the first lines of --version',
  { skip: available ? false : 'unavailable: toolchain' },
  async () => {
    assert.ok(!('code' in tools));
    const versions = await binutilsVersions(tools);
    assert.match(versions.as, /^GNU assembler /);
    assert.match(versions.ld, /^GNU ld /);
    assert.match(versions.objcopy, /^GNU objcopy /);
  },
);

test('assembleWithBinutils without the tools gives E_TOOLCHAIN_MISSING', async () => {
  const saved = process.env['PATH'];
  process.env['PATH'] = '';
  try {
    const result = await assembleWithBinutils('.thumb\n');
    assert.ok(!result.ok);
    assert.deepEqual(
      result.diagnostics.map((d) => d.code),
      ['E_TOOLCHAIN_MISSING'],
    );
  } finally {
    process.env['PATH'] = saved;
  }
});

test('findExecutable searches the PATH of the given environment only', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'romlift-path-'));
  try {
    const file = path.join(dir, 'agbcc');
    await writeFile(file, '#!/bin/sh\n');
    await chmod(file, 0o755);
    assert.equal(findExecutable('agbcc', { PATH: dir }), file);
    assert.equal(findExecutable('agbcc', { PATH: '' }), undefined);
    assert.equal(findExecutable('agbcc', {}), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'assembleWithBinutils runs the tools it is given, not the PATH',
  { skip: available ? false : 'unavailable: toolchain' },
  async () => {
    assert.ok(!('code' in tools));
    const saved = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      const result = await assembleWithBinutils('.syntax unified\n.arm\n\tbx lr\n', { tools });
      assert.ok(result.ok);
      assert.deepEqual([...result.bytes], [0x1e, 0xff, 0x2f, 0xe1]);
    } finally {
      process.env['PATH'] = saved;
    }
  },
);

test(
  'linkWithBinutils links two objects with the script and returns the linked .text',
  { skip: available ? false : 'unavailable: toolchain' },
  async () => {
    assert.ok(!('code' in tools));
    const script = 'SECTIONS\n{\n  . = 0x08000000;\n  .text : { a.o(.text) b.o(.text) }\n  /DISCARD/ : { *(*) }\n}\n';
    const a = { name: 'a', mode: 'arm' as const, text: '.syntax unified\n.arm\n.global _start\n_start:\n\tbl far\n' };
    const b = { name: 'b', mode: 'arm' as const, text: '.syntax unified\n.arm\n.global far\nfar:\n\tbx lr\n' };
    const result = await linkWithBinutils([a, b], { script, tools });
    assert.ok(result.ok, result.ok ? '' : result.stderr);
    // bl from 0x08000000 to 0x08000004: offset (4 - 8) >> 2 = -1.
    assert.deepEqual([...result.bytes], [0xff, 0xff, 0xff, 0xeb, 0x1e, 0xff, 0x2f, 0xe1]);
    const unresolved = await linkWithBinutils([a], { script: 'SECTIONS { .text : { a.o(.text) } }\n', tools });
    assert.ok(!unresolved.ok);
    assert.match(unresolved.stderr, /undefined reference to `far'/);
    assert.deepEqual(
      unresolved.diagnostics.map((d) => d.code),
      ['E_TOOLCHAIN_FAILED'],
    );
    const escape = await linkWithBinutils([{ name: '../a', text: '' }], { script, tools });
    assert.ok(!escape.ok && /refusing the link source name/.test(escape.diagnostics[0]?.message ?? ''));
  },
);

test('a tool that exits 0 without writing its output is E_TOOLCHAIN_FAILED, not a thrown read', async () => {
  await stubBinutils({}, async (dir) => {
    const stub = findBinutils({ PATH: dir });
    assert.ok(!('code' in stub));
    const assembled = await assembleWithBinutils('.thumb\n', { tools: stub });
    assert.ok(!assembled.ok);
    assert.deepEqual(
      assembled.diagnostics.map((d) => d.code),
      ['E_TOOLCHAIN_FAILED'],
    );
    assert.match(assembled.diagnostics[0]?.message ?? '', /wrote no source\.o/);
    const linked = await linkWithBinutils([{ name: 'a', text: '.thumb\n' }], { script: 'SECTIONS {}\n', tools: stub });
    assert.ok(!linked.ok);
    assert.match(linked.diagnostics[0]?.message ?? '', /wrote no linked\.elf/);
  });
  await stubBinutils({ as: ': > source.o' }, async (dir) => {
    const stub = findBinutils({ PATH: dir });
    assert.ok(!('code' in stub));
    const assembled = await assembleWithBinutils('.thumb\n', { tools: stub });
    assert.ok(!assembled.ok);
    assert.match(assembled.diagnostics[0]?.message ?? '', /objcopy exited 0 but wrote no text\.bin/);
  });
});
