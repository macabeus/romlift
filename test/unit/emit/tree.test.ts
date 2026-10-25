// The frozen emission shapes (architecture §3.4, §6.3, D62), checked by the typechecker: the literals
// below must be assignable to the frozen types, and the @ts-expect-error lines must not be. The runtime
// part covers the shared helpers: the writer registry, WRITER_IDS and the PrintStats sum.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WRITERS } from '../../../src/core/emit/writers/index.ts';
import { addPrintStats, DEFAULT_PRINTER, emptyPrintStats, WRITER_IDS } from '../../../src/core/emit/tree.ts';
import type { DecompState, EmitContext, FileEntry, PrintedChunk, PrintStats, TextEdit, Writer, WriterId } from '../../../src/core/emit/tree.ts';
import type { Model } from '../../../src/core/model/types.ts';
import type { Manifest, WriteOp, WritePlan, WritePlanInputs } from '../../../src/core/write-plan/types.ts';
import type { CheckResult, VerifyReport } from '../../../src/core/verify/report.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { dataItem, modelOf, romWith } from '../../helpers/model.ts';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function expectType<T extends true>(_: T): void {}

// FileEntry: the three ownerships.
const generated = { ownership: 'generated', path: 'asm/main.s', text: '', writer: 'module' } satisfies FileEntry;
const scaffold = { ownership: 'scaffold', path: 'src/main.c', text: '', writer: 'c-stub' } satisfies FileEntry;
const edit: TextEdit = { start: 0, end: 0, text: 'INCLUDE_ASM("asm/nonmatchings/main", F);\n', reason: 'add-stub' };
const reconciled = { ownership: 'reconciled', path: 'src/main.c', baseSha1: '0'.repeat(40), edits: [edit] } satisfies FileEntry;
// @ts-expect-error a scaffold entry is written by the scaffold or c-stub writer only
const wrongScaffold: FileEntry = { ownership: 'scaffold', path: 'Makefile', text: '', writer: 'module' };
void wrongScaffold;

// EmitContext: the printer is optional, and only 'readable' or 'raw'.
const decomp: DecompState = { defined: ['AgbMain'] };
const cxDefault: EmitContext = { decomp };
const cxRaw: EmitContext = { decomp, printer: 'raw' };
// @ts-expect-error no other printer
const cxBad: EmitContext = { decomp, printer: 'pretty' };
void cxBad;

// The writer contract: module-scoped writers get a module index, global writers null.
const writer: Writer = {
  id: 'function',
  scope: 'module',
  *emit(_rom: Rom, model: Model, _cx: EmitContext, module: number | null): Iterable<FileEntry> {
    if (module !== null) yield { ownership: 'generated', path: `asm/${model.modules[module]?.name ?? ''}.s`, text: '', writer: 'function' };
  },
};
expectType<Equal<Parameters<Writer['emit']>, [rom: Rom, model: Model, cx: EmitContext, module: number | null]>>(true);
expectType<Equal<Writer['scope'], 'module' | 'global'>>(true);

// PrintedChunk and PrintStats.
const printed: PrintedChunk = { lines: ['\tthumb_func_start F', 'F:'], stats: { ...emptyPrintStats(), insns: 1 } };
expectType<Equal<keyof PrintStats, 'insns' | 'rawInsns' | 'branches' | 'symbolicBranches' | 'poolLoads' | 'symbolicPoolLoads' | 'rawReasons'>>(true);

// The write plan's shapes, with `retained`.
const manifest: Manifest = { schema: 1, romlift: '0.0.0', files: { 'asm/main.s': { sha1: '0'.repeat(40), writer: 'module' } } };
const inputs: WritePlanInputs = {
  entries: [generated, scaffold, reconciled],
  manifest,
  disk: new Map([['asm/main.s', { kind: 'absent' }]]),
  reconciledTexts: new Map([['src/main.c', '']]),
  hash: (t) => t,
  retained: ['asm/nonmatchings/m4a/', 'asm/m4a.s'],
};
const ops: readonly WriteOp[] = [{ op: 'keep', path: 'asm/main.s', sha1: '0'.repeat(40) }];
const plan: WritePlan = { ops, manifest, diagnostics: [] };
// @ts-expect-error retained is required
const noRetained: WritePlanInputs = { entries: [], manifest: null, disk: new Map(), reconciledTexts: new Map(), hash: (t: string) => t };
void noRetained;

// The verify report.
const check: CheckResult = { id: 'text-layout', ok: true, detail: '12 files', diagnostics: [] };
const report: VerifyReport = { ok: true, checks: [check] };
// @ts-expect-error no such check
const badCheck: CheckResult = { id: 'objdiff', ok: true, detail: '', diagnostics: [] };
void badCheck;

test('the frozen shapes hold at runtime too', () => {
  assert.deepEqual([generated.ownership, scaffold.ownership, reconciled.ownership], ['generated', 'scaffold', 'reconciled']);
  assert.equal(cxDefault.printer, undefined);
  assert.equal(DEFAULT_PRINTER, 'readable');
  assert.equal(cxRaw.printer, 'raw');
  assert.equal(printed.stats.insns, 1);
  assert.equal(inputs.retained.length, 2);
  assert.equal(plan.ops.length, 1);
  assert.ok(report.ok);
  const rom = romWith([], { size: 0x400 });
  const model = modelOf(rom, { modules: [{ name: 'main', chunks: [{ name: 'F', items: [dataItem(0x0800_0000, 0x400)] }] }] });
  assert.deepEqual([...writer.emit(rom, model, cxDefault, 0)].map((e) => e.path), ['asm/main.s']);
  assert.deepEqual([...writer.emit(rom, model, cxDefault, null)], []);
});

test('the registry holds the eight phase-3 writers, phase 4\'s modules-mk and c-stub and phase 6\'s expected and objdiff; ldscript, symbols, modules-mk and objdiff global', () => {
  assert.deepEqual(
    WRITERS.map((w) => [w.id, w.scope]),
    [
      ['header', 'module'],
      ['crt0', 'module'],
      ['function', 'module'],
      ['orphan', 'module'],
      ['module', 'module'],
      ['data', 'module'],
      ['ldscript', 'global'],
      ['symbols', 'global'],
      ['modules-mk', 'global'],
      ['c-stub', 'module'],
      ['expected', 'module'],
      ['objdiff', 'global'],
    ],
  );
  const ids: readonly WriterId[] = WRITERS.map((w) => w.id);
  for (const id of ids) assert.ok(WRITER_IDS.includes(id));
  assert.equal(new Set(WRITER_IDS).size, 13);
});

test('addPrintStats sums every count and merges the raw reasons', () => {
  const a: PrintStats = { insns: 10, rawInsns: 2, branches: 4, symbolicBranches: 3, poolLoads: 2, symbolicPoolLoads: 1, rawReasons: { 'no-roundtrip': 1, 'as-alias': 1 } };
  const b: PrintStats = { insns: 5, rawInsns: 1, branches: 1, symbolicBranches: 1, poolLoads: 0, symbolicPoolLoads: 0, rawReasons: { 'cross-module-short-branch': 1, 'no-roundtrip': 2 } };
  const sum = addPrintStats(a, b);
  assert.deepEqual(sum, { insns: 15, rawInsns: 3, branches: 5, symbolicBranches: 4, poolLoads: 2, symbolicPoolLoads: 1, rawReasons: { 'as-alias': 1, 'cross-module-short-branch': 1, 'no-roundtrip': 3 } });
  assert.deepEqual(Object.keys(sum.rawReasons), ['as-alias', 'cross-module-short-branch', 'no-roundtrip']);
  assert.deepEqual(addPrintStats(emptyPrintStats(), emptyPrintStats()), emptyPrintStats());
});
