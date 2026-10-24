// planPatch (architecture §6.5, D9, D23): on every committed fixture's config, the assertions of g4.toml-canonical
// (three hand comments survive a rename verbatim, the result re-parses, exactly that entry is renamed and exactly one
// line changes; the entry restructured into a [functions.0x…] table is refused with E_TOML_PATCH_REFUSED); then
// insertions, trailing comments, indentation and CRLF, the `from` key, the startup label (D64 a), symbols, the
// refusals (block entries, a missing table, a multi-line value, a config that is not what the text says) and a
// no-op patch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import { applyProposals, planPatch } from '../../../src/core/config/patch.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import type { Proposal } from '../../../src/core/proposals/types.ts';
import { profileById } from '../../../src/core/profile/registry.ts';
import type { RuleId } from '../../../src/core/provenance/rule-id.ts';
import { configFromDiscover } from '../../../src/core/workflow/config-from-discover.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const SIGNATURE = { kind: 'signature', library: 'gate', version: '0', rule: 'sig.unique-fit' } as const;
const COMMENTS = ['# a comment above everything', '# a comment above an entry', '# a trailing comment'] as const;
const PLAIN_DEFAULT_ENTRY = /^(0x[0-9A-F]{8}) = "(sub_[0-9A-F]{8})"$/;

const BASE = `schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "x"
compiler = "agbcc"

[signatures]
enabled = false

[[modules]]
name = "main"
start = 0x08000000
kind = "asm"
`;

function parsed(text: string): RomliftConfig {
  const result = parseConfig(text);
  assert.ok(result.ok, result.ok ? '' : result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  return result.value;
}

function patched(text: string, proposals: readonly Proposal[], config: RomliftConfig = parsed(text)): string {
  const result = planPatch(text, config, proposals);
  assert.ok(result.ok, result.ok ? '' : result.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  assert.deepEqual(result.diagnostics, []);
  return result.text;
}

function refusal(text: string, proposals: readonly Proposal[], config: RomliftConfig = parsed(text)): string[] {
  const result = planPatch(text, config, proposals);
  assert.equal(result.ok, false, 'expected a refusal');
  return result.ok ? [] : result.diagnostics.map((d) => `${d.code} ${d.message}`);
}

function rename(addr: number, name: string, mode: 'thumb' | 'arm' = 'thumb'): Proposal {
  return { kind: 'function', addr, mode, name, source: SIGNATURE };
}

/** The lines of `after` that are not the same line of `before` (both with equally many lines, or the added ones). */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  return after.split('\n').filter((line, i) => a[i] !== line);
}

function fixtureTexts(): { readonly name: string; readonly text: string }[] {
  const profile = profileById('agbcc');
  if (profile === undefined) throw new Error('the agbcc profile is not registered');
  return listSyntheticFixtures().map((fixture) => {
    const rom = readFixtureRom(fixture);
    return { name: fixture.name, text: serializeConfig(configFromDiscover(rom, discover(rom, { profile }))) };
  });
}

test("g4.toml-canonical's patch assertions hold on every committed fixture's config", () => {
  const fixtures = fixtureTexts();
  assert.ok(fixtures.length >= 47);
  for (const { name, text } of fixtures) {
    const lines = text.split('\n');
    const header = lines.indexOf('[functions]');
    const at = lines.findIndex((l, i) => i > header && PLAIN_DEFAULT_ENTRY.test(l));
    const match = PLAIN_DEFAULT_ENTRY.exec(lines[at] ?? '');
    const moduleLine = lines.findIndex((l) => l.startsWith('kind = "'));
    assert.ok(match?.[1] !== undefined && match[2] !== undefined && moduleLine >= 0, name);
    const commented = [...lines];
    commented[moduleLine] = `${commented[moduleLine] ?? ''}  ${COMMENTS[2]}`;
    commented.splice(at, 0, COMMENTS[1]);
    const input = `${COMMENTS[0]}\n${commented.join('\n')}`;
    const config = parsed(text);
    const addr = Number.parseInt(match[1], 16);
    const output = patched(input, [rename(addr, 'GatePatchedName', config.functions.get(addr)?.mode)], config);
    for (const comment of COMMENTS) assert.ok(output.includes(comment), `${name}: lost ${comment}`);
    assert.deepEqual(changedLines(input, output), [`${match[1]} = { name = "GatePatchedName", from = "sig:gate@0" }`], name);
    const again = parsed(output);
    assert.equal(again.functions.get(addr)?.name, 'GatePatchedName');
    assert.equal(again.functions.size, config.functions.size);
    for (const [other, fn] of config.functions) if (other !== addr) assert.deepEqual(again.functions.get(other), fn, name);
    assert.deepEqual(again.modules, config.modules);

    const moved = `${lines.filter((l) => l !== lines[at]).join('\n').trimEnd()}\n\n[functions.${match[1]}]\nname = "${match[2]}"\n`;
    const movedConfig = parsed(moved);
    assert.equal(serializeConfig(movedConfig), text, `${name}: the restructured file means the same config`);
    const refused = refusal(moved, [rename(addr, 'GatePatchedName', config.functions.get(addr)?.mode)], movedConfig);
    assert.equal(refused.length, 1, name);
    assert.match(refused[0] ?? '', /^E_TOML_PATCH_REFUSED .* restructured by hand.*: 0x[0-9A-F]{8} = \{ name = "GatePatchedName", from = "sig:gate@0" \}$/);
  }
});

test('a rename keeps the indentation and a trailing comment of its line, and the comment above it', () => {
  const text = `${BASE}\n[functions]\n# the entry\n  0x08000010 = "sub_08000010"   # keep me\n0x08000020 = "sub_08000020"\n`;
  const output = patched(text, [rename(0x0800_0010, 'Main')]);
  assert.equal(output, text.replace('0x08000010 = "sub_08000010"', '0x08000010 = { name = "Main", from = "sig:gate@0" }'));
});

test('a new entry goes after the next lower address, or right after the header, with its neighbour’s indentation', () => {
  const text = `${BASE}\n[functions] # table comment\n  0x08000010 = "A"\n  # about B\n  0x08000030 = "B"\n\n[symbols]\n`;
  const add = (addr: number): Proposal => ({ kind: 'function', addr, mode: 'thumb', source: { kind: 'analysis', rule: 'seed.test' as RuleId } });
  const output = patched(text, [add(0x0800_0040), add(0x0800_0020), add(0x0800_0000), add(0x0800_0028)]);
  assert.equal(
    output,
    `${BASE}\n[functions] # table comment\n  0x08000000 = "sub_08000000"\n  0x08000010 = "A"\n  0x08000020 = "sub_08000020"\n  0x08000028 = "sub_08000028"\n  # about B\n  0x08000030 = "B"\n  0x08000040 = "sub_08000040"\n\n[symbols]\n`,
  );
  const empty = `${BASE}\n[functions]\n\n[symbols]\n`;
  assert.equal(patched(empty, [add(0x0800_0000)]), `${BASE}\n[functions]\n0x08000000 = "sub_08000000"\n\n[symbols]\n`);
});

test('a CRLF file gets CRLF lines', () => {
  const text = `${BASE}\n[functions]\n0x08000010 = "A"\n\n[symbols]\n`.replace(/\n/g, '\r\n');
  const output = patched(text, [{ kind: 'function', addr: 0x0800_0020, mode: 'arm', name: 'B', source: SIGNATURE }, rename(0x0800_0010, 'C')]);
  assert.equal(output, text.replace('0x08000010 = "A"\r\n', '0x08000010 = { name = "C", from = "sig:gate@0" }\r\n0x08000020 = { name = "B", mode = "arm", from = "sig:gate@0" }\r\n'));
});

test('`from` records a persisted source; the analysis leaves it as it was; aliases and size are kept', () => {
  const text = `${BASE}\n[functions]\n0x08000010 = { name = "A", size = 0x20, aliases = ["B"], from = "sig:gate@0" }\n`;
  const signature: Proposal = { kind: 'function', addr: 0x0800_0010, mode: 'thumb', name: 'm4aSoundMain', source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.test' as RuleId } };
  assert.match(patched(text, [signature]), /^0x08000010 = \{ name = "m4aSoundMain", size = 0x20, aliases = \["B"\], from = "sig:m4a@2001" \}$/m);
  const analysis: Proposal = { kind: 'function', addr: 0x0800_0010, mode: 'thumb', size: 0x30, source: { kind: 'analysis', rule: 'seed.test' as RuleId } };
  assert.match(patched(text, [analysis]), /^0x08000010 = \{ name = "A", size = 0x30, aliases = \["B"\], from = "sig:gate@0" \}$/m);
});

test('a proposal never removes `label = true`: the startup code inside the cartridge entry keeps it (D64 a)', () => {
  const text = `${BASE}\n[functions]\n0x08000000 = { name = "sub_08000000", mode = "arm" }\n0x080000C0 = { name = "sub_080000C0", mode = "arm", label = true }\n`;
  const output = patched(text, [rename(0x0800_00c0, 'start', 'arm')]);
  assert.deepEqual(changedLines(text, output), ['0x080000C0 = { name = "start", mode = "arm", label = true, from = "sig:gate@0" }']);
  const cleared: Proposal = { kind: 'function', addr: 0x0800_00c0, mode: 'arm', label: false, name: 'start', source: SIGNATURE };
  assert.equal(parsed(patched(text, [cleared])).functions.get(0x0800_00c0)?.label, true);
});

test('symbols are patched like functions', () => {
  const text = `${BASE}\n[functions]\n\n[symbols]\n0x03000000 = "gUnk_03000000"   # RAM\n`;
  const output = patched(text, [
    { kind: 'symbol', addr: 0x0300_0000, name: 'gMain', source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' } },
    { kind: 'symbol', addr: 0x0300_0010, name: 'gTable', size: 0x40, type: 'pointers', source: SIGNATURE },
  ]);
  assert.equal(output, `${BASE}\n[functions]\n\n[symbols]\n0x03000000 = { name = "gMain", from = "sig:m4a@2001" }   # RAM\n0x03000010 = { name = "gTable", size = 0x40, type = "pointers", from = "sig:gate@0" }\n`);
});

test('an unchanged entry is not rewritten, so a no-op patch returns the text itself', () => {
  const text = `${BASE}\n[functions]\n0x08000010 = { name = "A", mode = "thumb" }  # not canonical, but meant the same\n`;
  assert.equal(patched(text, [rename(0x0800_0010, 'A')].map((p) => ({ ...p, source: { kind: 'analysis', rule: 'seed.x' as RuleId } }))), text);
  assert.equal(patched(text, []), text);
});

test('the refusals: a block entry, a missing table, a multi-line value, dotted keys, and a stale config', () => {
  const text = `${BASE}\n[functions]\n0x08000010 = { name = "A", aliases = [\n  "B",\n] }\n0x08000020.name = "C"\n`;
  assert.deepEqual(refusal(text, [rename(0x0800_0010, 'X')]), [
    'E_TOML_PATCH_REFUSED 0x08000010 in [functions] is not one single-line entry (line 20): it was restructured by hand, so the planner does not edit it; replace it with this line under [functions]: 0x08000010 = { name = "X", aliases = ["B"], from = "sig:gate@0" }',
  ]);
  assert.deepEqual(refusal(text, [rename(0x0800_0020, 'X')]), [
    'E_TOML_PATCH_REFUSED 0x08000020 in [functions] is not one single-line entry (line 23): it was restructured by hand, so the planner does not edit it; replace it with this line under [functions]: 0x08000020 = { name = "X", from = "sig:gate@0" }',
  ]);
  assert.deepEqual(refusal(BASE, [{ kind: 'symbol', addr: 0x0300_0000, name: 'gA', source: SIGNATURE }]), [
    'E_TOML_PATCH_REFUSED romlift.toml has no [symbols] table to add 0x03000000 to; add the table with this line: 0x03000000 = { name = "gA", from = "sig:gate@0" }',
  ]);
  const module: Proposal = { kind: 'module', name: 'm4a', start: 0x0800_0100, moduleKind: 'asm', library: { name: 'm4a', version: '2001' }, source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.x' as RuleId } };
  assert.deepEqual(refusal(`${BASE}\n[functions]\n`, [module]), [
    'E_TOML_PATCH_REFUSED [[modules]] are blocks, which the planner does not edit; make the [[modules]] read, in link order:\n[[modules]]\nname = "main"\nstart = 0x08000000\nkind = "asm"\n\n[[modules]]\nname = "m4a"\nstart = 0x08000100\nkind = "asm"\nlibrary = "m4a"\nversion = "2001"',
  ]);
  const override: Proposal = { kind: 'override', span: { start: 0x0800_0100, end: 0x0800_0140 }, overrideKind: 'code', mode: 'arm', runsAt: 0x0300_0000, source: { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' } };
  assert.deepEqual(refusal(`${BASE}\n[functions]\n`, [override]), [
    'E_TOML_PATCH_REFUSED [[overrides]] are blocks, which the planner does not edit; make the [[overrides]] read:\n[[overrides]]\nstart = 0x08000100\nsize = 0x40\nkind = "code"\nmode = "arm"\nruns_at = 0x03000000\nfrom = "sig:m4a@2001"',
  ]);
  const plain = `${BASE}\n[functions]\n0x08000010 = "A"\n0x08000020 = "B"\n`;
  const stale = parsed(plain.replace('"B"', '"Stale"'));
  const message = refusal(plain, [rename(0x0800_0010, 'X')], stale);
  assert.equal(message.length, 1);
  assert.match(message[0] ?? '', /^E_TOML_PATCH_REFUSED the patched text does not mean the intended config: the patched file reads "0x08000020 = \\"B\\"" where the intended config reads "0x08000020 = \\"Stale\\""; paste these entries by hand:\n\[functions\] 0x08000010 = \{ name = "X", from = "sig:gate@0" \}$/);
});

test('applyProposals: in order, later wins; modules and overrides land in start order', () => {
  const config = parsed(`${BASE}\n[[modules]]\nname = "data"\nstart = 0x08000400\nkind = "data"\ngenerated = false\n\n[functions]\n`);
  const next = applyProposals(config, [
    rename(0x0800_0010, 'First'),
    rename(0x0800_0010, 'Second'),
    { kind: 'module', name: 'lib', start: 0x0800_0200, moduleKind: 'asm', source: SIGNATURE },
    { kind: 'module', name: 'rodata', start: 0x0800_0400, moduleKind: 'data', source: SIGNATURE },
    { kind: 'override', span: { start: 0x0800_0300, end: 0x0800_0310 }, overrideKind: 'data', source: SIGNATURE },
    { kind: 'override', span: { start: 0x0800_0100, end: 0x0800_0110 }, overrideKind: 'code', source: { kind: 'layout', reason: 'data' } },
  ]);
  assert.equal(next.functions.get(0x0800_0010)?.name, 'Second');
  assert.deepEqual(
    next.modules.map((m) => [m.name, m.start, m.generated]),
    [
      ['main', 0x0800_0000, true],
      ['lib', 0x0800_0200, true],
      ['rodata', 0x0800_0400, false],
    ],
  );
  assert.deepEqual(next.overrides, [
    { start: 0x0800_0100, size: 0x10, kind: 'code' },
    { start: 0x0800_0300, size: 0x10, kind: 'data', from: 'sig:gate@0' },
  ]);
  assert.equal(config.functions.size, 0, 'the input config is not changed');
});
