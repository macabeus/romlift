// The printer's word rule for named, sized entries (resolver.ts wordNameOf, the owner's answer to phase-6.md Q6 and Q15,
// D102), assembled and linked on committed fixtures (phase-6 fix round 5, architecture-o0-6: no ci-tier gate's config
// has a sized entry, since `init` places no signature on the synthetic fixtures, so this is the rule's toolchain coverage
// in `npm test`; the real-tier gates build `init`'s configs, which hold signature sizes and tables, D104 g).
// Three configs, each the fixture's discover config plus one sized entry:
//   - code-end-unsized-last: a [symbols] entry `gTable` with `size` at the data module's start; the pool word of the
//     code module holding 0x08000110, 8 bytes in, prints `gTable + 8` from the other module, gTable global;
//   - library-game: the Thumb function at 0x08000264 given a TOML `size`; its own pool word 0x08000269, an odd word
//     inside it, prints `<name> + 4`, which R_ARM_ABS32 links to (S + 4) | 1;
//   - composite: the Thumb function at 0x080003D4 given a TOML `size`; its pool word 0x080003EC, an even word inside
//     it, never prints `<name> + n` (the linker would set the Thumb bit).
// Each model has no diagnostic, its tree passes the text-layout check (no toolchain needed), and with binutils it links
// to the SHA-1.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { emitTree } from '../../../src/core/emit/emit-tree.ts';
import { buildUnits } from '../../../src/core/model/paths.ts';
import type { Model } from '../../../src/core/model/types.ts';
import { checkEntries } from '../../../src/core/verify/text-layout.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { confirmModel } from '../../../src/core/workflow/generate.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { findBinutils } from '../../../src/shell/toolchain/binutils.ts';
import { linkCheck } from '../../../src/shell/toolchain/link-check.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const tools = findBinutils(process.env);
const skip = 'code' in tools ? 'unavailable: toolchain' : false;
const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

interface Case {
  readonly rom: Rom;
  readonly model: Model;
  /** Every `.4byte` line of the tree. */
  readonly words: readonly string[];
}

function sized(fixture: string, edit: (config: RomliftConfig) => RomliftConfig): Case {
  const found = listSyntheticFixtures().find((f) => f.name === fixture);
  if (found === undefined) throw new Error(`the ${fixture} fixture is not committed`);
  const rom = readFixtureRom(found);
  const { model } = confirmModel({ rom, config: edit(configFromDiscover(rom, discover(rom))) });
  const words = [...emitTree(rom, model, { decomp: { defined: [] } })].flatMap((e) => ('text' in e ? e.text.split('\n').filter((l) => l.includes('.4byte ')) : []));
  return { rom, model, words };
}

function withSize(entry: number, size: number): (config: RomliftConfig) => RomliftConfig {
  return (config) => {
    const f = config.functions.get(entry);
    if (f === undefined) throw new Error(`no listed function at 0x${entry.toString(16)}`);
    return { ...config, functions: new Map([...config.functions, [entry, { ...f, size }]]) };
  };
}

const CASES = {
  symbol: sized('code-end-unsized-last', (config) => ({ ...config, symbols: new Map([...config.symbols, [0x0800_0108, { name: 'gTable', size: 0x10, aliases: [] }]]) })),
  odd: sized('library-game', withSize(0x0800_0264, 0x10)),
  even: sized('composite', withSize(0x0800_03d4, 0x5a)),
} as const;

test('the spellings: name + offset from another module, an odd word inside a Thumb function, never an even one', () => {
  for (const c of Object.values(CASES)) assert.deepEqual(c.model.diagnostics, []);
  assert.ok(CASES.symbol.words.some((l) => l.endsWith('.4byte gTable + 8')), CASES.symbol.words.join('\n'));
  assert.equal(CASES.symbol.model.labels.find((l) => l.name === 'gTable')?.scope, 'global');
  assert.equal(CASES.symbol.model.labels.some((l) => l.name === 'gUnk_08000110'), false, 'no gUnk_ label at a word the entry holds');
  const odd = CASES.odd.model.functions.find((f) => f.entry === 0x0800_0264);
  assert.equal(odd?.source.extent, 'toml-size');
  assert.ok(CASES.odd.words.some((l) => l.endsWith(`.4byte ${odd?.name ?? '?'} + 4`)), CASES.odd.words.join('\n'));
  const even = CASES.even.model.functions.find((f) => f.entry === 0x0800_03d4);
  assert.equal(even?.source.extent, 'toml-size');
  assert.equal(CASES.even.words.some((l) => l.includes(`${even?.name ?? '?'} + `)), false, CASES.even.words.join('\n'));
});

for (const [name, c] of Object.entries(CASES)) {
  test(`${name}: the tree passes the text-layout check`, () => {
    const layout = checkEntries(c.rom, c.model, emitTree(c.rom, c.model, { decomp: { defined: [] } }));
    assert.ok(layout.ok, layout.checks.filter((k) => !k.ok).map((k) => k.detail).join('; '));
  });

  test(`${name}: the tree links to the fixture's SHA-1`, { skip }, async () => {
    assert.ok(!('code' in tools));
    const entries = [...emitTree(c.rom, c.model, { decomp: { defined: [] } })];
    const dir = await mkdtemp(join(tmpdir(), 'romlift-sized-'));
    roots.push(dir);
    for (const e of entries) {
      if (!('text' in e)) throw new Error(`${e.path}: a reconciled entry`);
      await mkdir(dirname(join(dir, e.path)), { recursive: true });
      await writeFile(join(dir, e.path), e.text);
    }
    const linked = await linkCheck({ dir, rom: c.rom, units: buildUnits(c.model), tools });
    assert.ok(linked.ok, linked.detail);
    assert.equal(linked.sha1, c.rom.sha1);
  });
}
