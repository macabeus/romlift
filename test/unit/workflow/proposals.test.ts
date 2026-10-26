// The proposal screen and the signature layer (core/workflow/proposals.ts; architecture §7.3, §7.4, D9, D93): each
// contradiction kind of checkProposals (against the analysis: the other mode, a pool, table or data claim at the entry,
// a table over code; against the config: a listed function of the other mode, a data override over a function, a code
// override over a table, a module border inside a runs_at range; a name taken at another address), one
// W_EVIDENCE_CONFLICT per dropped proposal at its address, and every other proposal kept unchanged in its order; the
// fold init makes (names, `from`, `size` and inner labels, tables as symbols, the libraries used); the proposals
// analyze --update keeps (default names only); its library modules, and the notes of a region no module could take.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Claim } from '../../../src/core/analysis/types.ts';
import type { ClaimRun } from '../../../src/core/analysis/types.ts';
import type { Proposal, ProposalSource } from '../../../src/core/proposals/types.ts';
import { checkProposals, proposalAddr } from '../../../src/core/workflow/proposals.ts';
import { droppedRegionNotes, foldSignatures, isDefaultName, librariesOf, libraryModuleProposals, signatureLayer, updateProposals } from '../../../src/core/workflow/signature-layer.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { analysisOf, BASE, configOf, fact, HEADER_END, romWith } from '../layout/hand-made.ts';

const SIG: ProposalSource = { kind: 'signature', library: 'm4a', version: '2001', rule: 'sig.unique-fit' };
const fn = (addr: number, name: string, mode: 'thumb' | 'arm' = 'thumb', extra: Partial<Extract<Proposal, { kind: 'function' }>> = {}): Proposal => ({ kind: 'function', addr, mode, name, source: SIG, ...extra });
const table = (addr: number, name: string, size: number): Proposal => ({ kind: 'symbol', addr, name, size, type: 'pointers', source: SIG });

/** An analysis with Thumb functions at 0x100, 0x120 (a pool at 0x11C) and an ARM function at 0x140; data from 0x160 (or `tail`). */
function analysis(tail?: readonly ClaimRun[]): ReturnType<typeof analysisOf> {
  const rom = romWith([], { size: 0x200 });
  const functions = [fact({ entry: BASE + 0x100, end: BASE + 0x120, pools: [BASE + 0x11c] }), fact({ entry: BASE + 0x120, end: BASE + 0x140 }), fact({ entry: BASE + 0x140, end: BASE + 0x160, mode: 'arm' })];
  const base: ClaimRun[] = [
    { span: { start: BASE + 0x100, end: BASE + 0x11c }, kind: Claim.code, owner: BASE + 0x100 },
    { span: { start: BASE + 0x11c, end: BASE + 0x120 }, kind: Claim.pool, owner: BASE + 0x100 },
    { span: { start: BASE + 0x120, end: BASE + 0x160 }, kind: Claim.code, owner: BASE + 0x120 },
  ];
  return analysisOf(rom, { functions, claims: [...base, ...(tail ?? [{ span: { start: BASE + 0x160, end: BASE + 0x200 }, kind: Claim.data }])] });
}

const A = analysis();

function config(over: Partial<Parameters<typeof configOf>[0]> = {}): RomliftConfig {
  return configOf({ modules: [['rom_header', BASE], ['main', HEADER_END]], ...over });
}

/** checkProposals' verdict on `bad` beside an agreeing proposal on either side: `bad` dropped with one conflict at its address. */
function dropped(bad: Proposal, cfg?: RomliftConfig, at: number = proposalAddr(bad)): string {
  const before = fn(BASE + 0x100, 'Before');
  const after = fn(BASE + 0x120, 'After');
  const out = checkProposals([before, bad, after], cfg === undefined ? { analysis: A } : { analysis: A, config: cfg });
  assert.deepEqual(out.kept, [before, after], 'the agreeing proposals are kept unchanged, in order');
  assert.equal(out.conflicts.length, 1);
  const [d] = out.conflicts;
  assert.equal(d?.code, 'W_EVIDENCE_CONFLICT');
  assert.equal(d?.severity, 'warning');
  assert.equal(d?.addr, at);
  return d?.message ?? '';
}

test('agreeing proposals are kept as they are, in order, with no conflict', () => {
  const proposals = [fn(BASE + 0x140, 'Arm', 'arm'), fn(BASE + 0x100, 'First'), table(BASE + 0x170, 'gTable', 0x10)];
  assert.deepEqual(checkProposals(proposals, { analysis: A, config: config() }), { kept: proposals, conflicts: [] });
});

test('against the analysis: a function where it found one of the other mode, naming both sides', () => {
  const message = dropped(fn(BASE + 0x140, 'NotArm'));
  assert.match(message, /^the signature m4a@2001 \(sig\.unique-fit\) proposes NotArm as a thumb function at 0x08000140, but the analysis found a arm function there \(seed\.call\)/);
  assert.match(message, /the proposal is dropped$/);
});

test('against the analysis: a function whose entry the analysis claims as a pool, a table or data', () => {
  assert.match(dropped(fn(BASE + 0x11c, 'OnPool')), /claims \[0x0800011C, 0x08000120\) as pool/);
  assert.match(dropped(fn(BASE + 0x180, 'InData')), /claims \[0x08000160, 0x08000200\) as data/);
  const withTable = analysis([{ span: { start: BASE + 0x1a0, end: BASE + 0x1b0 }, kind: Claim.table, owner: BASE + 0x120 }]);
  assert.deepEqual(checkProposals([fn(BASE + 0x180, 'Free')], { analysis: withTable }).conflicts, [], 'free bytes: no claim says otherwise');
  const out = checkProposals([fn(BASE + 0x1a4, 'OnTable')], { analysis: withTable });
  assert.deepEqual(out.kept, []);
  assert.match(out.conflicts[0]?.message ?? '', /as table/);
});

test('against the analysis: a table over found code', () => {
  assert.match(dropped(table(BASE + 0x150, 'gOverCode', 0x20)), /claims \[0x08000120, 0x08000160\) as code of the function at 0x08000120/);
  // A table in the data is no contradiction.
  assert.deepEqual(checkProposals([table(BASE + 0x160, 'gData', 0x10)], { analysis: A }).conflicts, []);
});

test('against the config: a listed function of the other mode, a data override over a function, a code override over a table', () => {
  const listed = config({ functions: [[BASE + 0x150, { name: 'Listed', mode: 'arm' }]] });
  assert.match(dropped(fn(BASE + 0x150, 'Thumb'), listed), /romlift\.toml lists Listed there as a arm function/);
  const data = config({ overrides: [{ start: BASE + 0x128, size: 0x18, kind: 'data' }] });
  const message = dropped(fn(BASE + 0x130, 'UnderData'), data);
  assert.match(message, /a data override of romlift\.toml covers \[0x08000128, 0x08000140\)/);
  const code = config({ overrides: [{ start: BASE + 0x168, size: 0x8, kind: 'code' }] });
  assert.match(dropped(table(BASE + 0x160, 'gUnderCode', 0x10), code), /a code override of romlift\.toml covers \[0x08000168, 0x08000170\)/);
  // A data override that only touches the table's end, and a code override past it, contradict nothing.
  assert.deepEqual(checkProposals([table(BASE + 0x160, 'gNear', 0x8)], { analysis: A, config: code }).conflicts, []);
});

test('against the config: a library module border strictly inside a runs_at range; the range borders are fine', () => {
  const ram = config({ overrides: [{ start: BASE + 0x120, size: 0x20, kind: 'code', runsAt: 0x0300_0000 }] });
  const module = (start: number): Proposal => ({ kind: 'module', name: 'm4a', start, moduleKind: 'asm', library: { name: 'm4a', version: '2001' }, source: { kind: 'layout', reason: 'asm-only' } });
  assert.match(dropped(module(BASE + 0x130), ram, BASE + 0x130), /would cut the runs_at range \[0x08000120, 0x08000140\)/);
  assert.deepEqual(checkProposals([module(BASE + 0x120), module(BASE + 0x140)], { analysis: A, config: ram }).conflicts, []);
});

test('a name the config or an earlier kept proposal gives another address contradicts it; the same address does not', () => {
  const named = config({ functions: [[BASE + 0x100, { name: 'SoundMain' }]] });
  assert.match(dropped(fn(BASE + 0x120, 'SoundMain'), named), /the name SoundMain is already given to 0x08000100/);
  assert.deepEqual(checkProposals([fn(BASE + 0x100, 'SoundMain')], { analysis: A, config: named }).conflicts, []);
  const first = fn(BASE + 0x100, 'Twice');
  const second = fn(BASE + 0x120, 'Twice');
  const out = checkProposals([first, second], { analysis: A });
  assert.deepEqual(out.kept, [first]);
  assert.equal(out.conflicts[0]?.addr, BASE + 0x120);
  assert.deepEqual(out.conflicts[0]?.cites, [BASE + 0x120, BASE + 0x100]);
});

test('one conflict per proposal, however many sides it contradicts', () => {
  const listed = config({ functions: [[BASE + 0x140, { name: 'Arm', mode: 'arm' }]] });
  const out = checkProposals([fn(BASE + 0x140, 'Thumb')], { analysis: A, config: listed });
  assert.equal(out.conflicts.length, 1);
  assert.match(out.conflicts[0]?.message ?? '', /the analysis found a arm function there .*; and romlift\.toml lists Arm there as a arm function/);
});

test('foldSignatures: the name, from and size of a placed function, label = true inside a restored extent, tables as symbols', () => {
  const cfg = config({ functions: [[BASE + 0x100, 'sub_08000100'], [BASE + 0x110, 'sub_08000110'], [BASE + 0x120, 'sub_08000120'], [BASE + 0x140, { name: 'sub_08000140', mode: 'arm' }]] });
  const folded = foldSignatures(cfg, [fn(BASE + 0x100, 'SoundMain', 'thumb', { size: 0x20 }), fn(BASE + 0x140, 'ArmPart', 'arm'), table(BASE + 0x170, 'gTable', 0x10)]);
  assert.deepEqual(folded.functions.get(BASE + 0x100), { name: 'SoundMain', mode: 'thumb', size: 0x20, aliases: [], from: 'sig:m4a@2001' });
  assert.deepEqual(folded.functions.get(BASE + 0x110), { name: 'sub_08000110', mode: 'thumb', aliases: [], label: true }, 'inside the restored extent, no from of its own');
  assert.deepEqual(folded.functions.get(BASE + 0x120), { name: 'sub_08000120', mode: 'thumb', aliases: [] }, 'at the extent end: not inside');
  assert.deepEqual(folded.functions.get(BASE + 0x140), { name: 'ArmPart', mode: 'arm', aliases: [], from: 'sig:m4a@2001' });
  assert.deepEqual(folded.symbols.get(BASE + 0x170), { name: 'gTable', size: 0x10, type: 'pointers', aliases: [], from: 'sig:m4a@2001' });
  assert.deepEqual([...folded.functions.keys()], [...folded.functions.keys()].sort((a, b) => a - b));
  assert.deepEqual(folded.modules, cfg.modules);
  assert.deepEqual(librariesOf([fn(1, 'a'), { ...fn(2, 'b'), source: { kind: 'signature', library: 'libgcc', version: 'agbcc', rule: 'sig.unique-fit' } }, { kind: 'function', addr: 4, mode: 'thumb', source: { kind: 'analysis', rule: 'seed.call' } }]), ['libgcc', 'm4a']);
});

test('updateProposals: only entries that still carry a default name are renamed; a restored extent labels the entries it holds', () => {
  const cfg = config({ functions: [[BASE + 0x100, 'sub_08000100'], [BASE + 0x110, 'sub_08000110'], [BASE + 0x120, 'MyName']], symbols: [[BASE + 0x170, { name: 'gMine', aliases: [] }]] });
  const proposals = [fn(BASE + 0x100, 'SoundMain', 'thumb', { size: 0x20 }), fn(BASE + 0x120, 'Renamed'), fn(BASE + 0x150, 'Unlisted'), table(BASE + 0x170, 'gTable', 0x10), table(BASE + 0x180, 'gNew', 0x10)];
  const kept = updateProposals(cfg, A, proposals);
  assert.deepEqual(
    kept.map((p) => (p.kind === 'function' || p.kind === 'symbol' ? `${p.kind} ${(p.addr - BASE).toString(16)} ${p.name ?? '(label)'}${p.kind === 'function' && p.label === true ? ' label' : ''}` : p.kind)),
    ['function 100 SoundMain', 'function 110 (label) label', 'function 150 Unlisted', 'symbol 180 gNew'],
  );
  assert.ok(isDefaultName('sub_08000100', 0x0800_0100) && isDefaultName('gUnk_03000000', 0x0300_0000));
  assert.ok(!isDefaultName('sub_08000100', 0x0800_0104) && !isDefaultName('SoundMain', 0x0800_0100));
});

test('libraryModuleProposals: a missing library module and the module resumed after it; none when present; a module inside is a note', () => {
  const rom = romWith([], { size: 0x200 });
  const an = analysisOf(rom, { functions: [0x100, 0x110, 0x120, 0x130, 0x140, 0x150].map((o) => fact({ entry: BASE + o, end: BASE + o + 0x10 })) });
  const region = { span: { start: BASE + 0x110, end: BASE + 0x130 }, library: 'm4a', version: '2001' };
  const cfg = configOf({ modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'c', generated: true }, { name: 'data', start: BASE + 0x160, kind: 'data', generated: true }] });
  const made = libraryModuleProposals(rom, an, cfg, [region]);
  assert.deepEqual(
    made.proposals.map((p) => [p.name, p.start - BASE, p.moduleKind, p.library?.name]),
    [
      ['m4a', 0x110, 'asm', 'm4a'],
      ['main_08000130', 0x130, 'c', undefined],
    ],
  );
  assert.deepEqual(made.notes, []);
  const present = configOf({ modules: [...cfg.modules.slice(0, 2), { name: 'm4a', start: BASE + 0x110, kind: 'asm', generated: true, library: 'm4a', version: '2001' }, { name: 'main_2', start: BASE + 0x130, kind: 'c', generated: true }, cfg.modules[2] ?? assert.fail()] });
  assert.deepEqual(libraryModuleProposals(rom, an, present, [region]).proposals, []);
  const inside = configOf({ modules: [...cfg.modules.slice(0, 2), { name: 'main_2', start: BASE + 0x120, kind: 'c', generated: true }, cfg.modules[2] ?? assert.fail()] });
  const refused = libraryModuleProposals(rom, an, inside, [region]);
  assert.deepEqual(refused.proposals, []);
  assert.deepEqual(refused.notes.map((d) => d.code), ['W_LIBRARY_MODULE_DROPPED']);
  assert.match(refused.notes[0]?.message ?? '', /the module main_2 of romlift\.toml starts at 0x08000120/);
  // A runs_at border already proposed at the region's end is not proposed twice.
  const ram = { kind: 'module', name: 'ram_03000000', start: BASE + 0x130, moduleKind: 'asm', source: { kind: 'layout', reason: 'runs-at' } } as const;
  assert.deepEqual(libraryModuleProposals(rom, an, cfg, [region], [ram]).proposals.map((p) => p.name), ['m4a']);
});

test('droppedRegionNotes: a code region no module of its library meets is noted; a table past the code end is not', () => {
  const cfg = configOf({ modules: [['rom_header', BASE], { name: 'main', start: HEADER_END, kind: 'c', generated: true }, { name: 'data', start: BASE + 0x160, kind: 'data', generated: true }] });
  const notes = droppedRegionNotes(cfg, [
    { span: { start: BASE + 0x112, end: BASE + 0x11e }, library: 'libagbsyscall', version: 'agb' },
    { span: { start: BASE + 0x180, end: BASE + 0x190 }, library: 'm4a', version: '2001' },
  ]);
  assert.deepEqual(notes.map((d) => [d.code, d.addr]), [['W_LIBRARY_MODULE_DROPPED', BASE + 0x112]]);
});

test('signatureLayer: no file, no proposal, region or diagnostic', () => {
  assert.deepEqual(signatureLayer(romWith([], { size: 0x200 }), A, []), { proposals: [], regions: [], placements: [], diagnostics: [] });
});
