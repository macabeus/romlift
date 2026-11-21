// The model's public JSON (architecture §3.4, D19, D62 d): NDJSON, the ModelJsonHeader line then one
// ModelJsonChunk line per chunk, canonical JSON, deterministic, every ItemTable row inline in its chunk's line.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MODEL_JSON_SCHEMA, encodeModel } from '../../../src/core/model/codec.ts';
import { specIdAt } from '../../../src/core/model/item-table.ts';
import { buildModel } from '../../../src/core/model/model.ts';
import type { Model, ModelJsonChunk, ModelJsonHeader } from '../../../src/core/model/types.ts';
import { NO_SPEC } from '../../../src/core/model/types.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { RomliftInvariantError } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { hexAddr } from '../../../src/foundation/util/hex.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';
import { BASE, HEADER_END, analysisOf, configOf, fact, romWith } from '../layout/hand-made.ts';

function fixtureModel(name: string) {
  const fixture = listSyntheticFixtures().find((f) => f.name === name);
  if (fixture === undefined) throw new Error(`no fixture ${name}`);
  const rom = readFixtureRom(fixture);
  const analysis = discover(rom);
  return { rom, model: buildModel(rom, analysis, configFromDiscover(rom, analysis)) };
}

/** A model with every optional member: a library, a run address, aliases, a sized symbol, unlisted findings and diagnostics. */
function richModel() {
  const rom = romWith([], { size: 0x200 });
  const base = analysisOf(rom, {
    functions: [fact({ entry: BASE + 0x100, end: BASE + 0x110 }), fact({ entry: BASE + 0x110, end: BASE + 0x120 })],
    seeds: [
      { entry: BASE + 0x100, mode: 'thumb', rule: 'seed.listed' },
      { entry: BASE + 0x110, mode: 'thumb', rule: 'seed.listed' },
    ],
  });
  if (base.mode !== 'confirm') throw new Error('confirm');
  const analysis = {
    ...base,
    unlisted: [
      {
        entry: BASE + 0x180,
        mode: 'arm' as const,
        origin: 'call' as const,
        provenance: { rule: 'seed.call' as const, round: 2, cites: [BASE + 0x104], note: 'n' },
      },
    ],
  };
  const config = configOf({
    modules: [
      ['rom_header', BASE],
      ['main', HEADER_END],
      {
        name: 'lib',
        start: BASE + 0x110,
        kind: 'asm',
        generated: false,
        library: 'm4a',
        version: '2001',
        compiler: 'old_agbcc',
        cflags: ['-ftst'],
      },
      ['oops', BASE + 0x114],
    ],
    functions: [
      [BASE + 0x100, { name: 'A', aliases: ['A_alias'], from: 'evidence:elf' }],
      [BASE + 0x110, 'sub_08000110'],
    ],
    symbols: [[0x0300_0000, { name: 'gRam', size: 8, aliases: [] }]],
    overrides: [{ start: BASE + 0x110, size: 4, kind: 'code', runsAt: BASE + 0x110 }],
  });
  return { rom, model: buildModel(rom, analysis, config) };
}

function lines(model: Model, rom: Parameters<typeof encodeModel>[1]): string[] {
  return [...encodeModel(model, rom)];
}

test('NDJSON: a header line, then one line per chunk, each one canonical JSON ending in a newline', () => {
  for (const { rom, model } of [fixtureModel('bx-pc-veneer'), richModel()]) {
    const out = lines(model, rom);
    assert.equal(out.length, model.chunks.length + 1);
    for (const line of out) {
      assert.ok(line.endsWith('\n') && !line.slice(0, -1).includes('\n'));
      const value = JSON.parse(line) as unknown;
      assert.equal(line, `${canonical(value)}\n`, 'keys sorted, no whitespace');
    }
    const header = JSON.parse(out[0] ?? '') as ModelJsonHeader;
    assert.equal(header.schema, MODEL_JSON_SCHEMA);
    assert.deepEqual(header.rom, { sha1: model.rom.sha1, end: hexAddr(model.rom.end) });
    assert.equal(header.modules.length, model.modules.length);
    assert.equal(header.labels.length, model.labels.length);
    assert.deepEqual(
      out.slice(1).map((l) => (JSON.parse(l) as ModelJsonChunk).name),
      model.chunks.map((c) => c.name),
    );
  }
});

/** JSON with object keys sorted by code unit, as canonicalJson writes it. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

test('every ItemTable row survives the encoding, in order, inside its chunk', () => {
  for (const { rom, model } of [fixtureModel('mixer-tiled-hole'), fixtureModel('code-copied-to-ram'), richModel()]) {
    const rows = lines(model, rom)
      .slice(1)
      .flatMap((l) => (JSON.parse(l) as ModelJsonChunk).items);
    assert.equal(rows.length, model.items.count);
    rows.forEach((row, i) => {
      const spec = model.items.spec[i] ?? NO_SPEC;
      assert.deepEqual(row, [
        model.items.kind[i],
        hexAddr(model.items.start[i] ?? 0),
        model.items.length[i],
        spec === NO_SPEC ? null : specIdAt(spec),
        model.items.aux[i],
      ]);
    });
  }
});

test('optional members appear when present: library, runAt, aliases, symbol size, unlisted, diagnostics', () => {
  const { rom, model } = richModel();
  const header = JSON.parse(lines(model, rom)[0] ?? '') as ModelJsonHeader;
  const lib = header.modules.find((m) => m.name === 'lib');
  assert.deepEqual(
    [lib?.library, lib?.runAt, lib?.generated, lib?.compiler, lib?.cflags.at(-1)],
    [{ name: 'm4a', version: '2001' }, '0x08000110', false, 'old_agbcc', '-ftst'],
  );
  assert.deepEqual(header.functions[0], {
    aliases: ['A_alias'],
    entry: '0x08000100',
    extent: { end: '0x08000110', start: '0x08000100' },
    mode: 'thumb',
    name: 'A',
    source: { extent: 'analysis', name: { from: 'evidence:elf', kind: 'toml' } },
  });
  assert.deepEqual(header.functions[1]?.source, { extent: 'analysis', name: { kind: 'default' } });
  assert.deepEqual(header.symbols, [{ addr: '0x03000000', name: 'gRam', size: 8 }]);
  assert.deepEqual(header.unlisted, [
    {
      entry: '0x08000180',
      mode: 'arm',
      origin: 'call',
      provenance: { cites: ['0x08000104'], note: 'n', round: 2, rule: 'seed.call' },
    },
  ]);
  assert.deepEqual(
    header.diagnostics.map((d) => [d.code, d.severity, d.addr]),
    model.diagnostics.map((d) => [d.code, d.severity, d.addr === undefined ? undefined : hexAddr(d.addr)]),
  );
  assert.ok(header.diagnostics.length > 0);
});

test('deterministic: equal models encode to equal text, lazily, line by line', () => {
  const a = fixtureModel('veneer-array');
  const b = fixtureModel('veneer-array');
  assert.deepEqual(lines(a.model, a.rom), lines(b.model, b.rom));
  const iterator = encodeModel(a.model, a.rom)[Symbol.iterator]();
  assert.ok((iterator.next().value ?? '').startsWith('{"build":'));
});

test('a ROM the model was not built from is a caller bug', () => {
  const { rom, model } = fixtureModel('veneer-array');
  const other = romFromBytes(rom.bytes, 'f'.repeat(40));
  assert.throws(() => [...encodeModel(model, other)], RomliftInvariantError);
});

test('a module with a C data range prints dataStart in the header, and only that module (phase 6, D92)', () => {
  const { rom } = fixtureModel('c-data');
  const analysis = discover(rom);
  const base = configFromDiscover(rom, analysis);
  const config = {
    ...base,
    modules: base.modules.map((m) => (m.name === 'main' ? { ...m, dataStart: 0x0800_014c } : m)),
  };
  const model = buildModel(rom, analysis, config);
  const header = JSON.parse([...encodeModel(model, rom)][0] ?? '{}') as ModelJsonHeader;
  assert.deepEqual(
    header.modules.map((m) => [m.name, m.dataStart, m.span.end]),
    [
      ['rom_header', undefined, '0x080000C0'],
      ['crt0', undefined, '0x080000F4'],
      ['main', '0x0800014C', '0x0800014C'],
    ],
  );
  const plain = JSON.parse([...encodeModel(buildModel(rom, analysis, base), rom)][0] ?? '{}') as ModelJsonHeader;
  assert.ok(
    plain.modules.every((m) => !('dataStart' in m)),
    'no module without a range has the key',
  );
});
