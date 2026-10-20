// generate over a project (architecture §2.1, §6.4, D74 c), pure: right after init, the plan over the disk init's
// write left is keep only and changes nothing (the manifest included), on every committed fixture; the stream holds
// the c stubs as scaffold entries, so a C file the user changed is kept, never edited; another ROM than [rom] sha1 is
// E_ROM_SHA1_MISMATCH before any analysis; an illegal border is E_MODULE_BORDER and plans nothing; the illegal TOMLs
// of g4.toml-mutations are refused by the parser with their codes, so no generate runs; DecompState comes from the
// C texts through the reconciler's scanner.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { decompStateOf, generatedEntries, generateProject, planChangesNothing, projectPlanInputs } from '../../../src/core/workflow/generate.ts';
import type { ProjectWriteState } from '../../../src/core/workflow/generate.ts';
import { init } from '../../../src/core/workflow/init.ts';
import type { ProjectInputs } from '../../../src/core/workflow/types.ts';
import { planWrites } from '../../../src/core/write-plan/plan-writes.ts';
import type { Manifest } from '../../../src/core/write-plan/types.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error('the package templates do not read');
const SCAFFOLD = scaffold.value;
const VERSION = SCAFFOLD.romliftVersion;
const hash = (text: string): string => sha1Of(text);

/** The disk a fresh init leaves: every tree and scaffold path written, its manifest; no journal. */
function afterInit(rom: Rom): { readonly project: ProjectInputs; readonly state: ProjectWriteState; readonly texts: ReadonlyMap<string, string> } {
  const plan = init({ rom, romFile: 'game.gba', options: {}, templates: SCAFFOLD.templates, romliftVersion: VERSION, agbcc: SCAFFOLD.agbcc });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  const entries: FileEntry[] = [...generatedEntries(rom, plan.result), ...plan.scaffold];
  const fresh = planWrites({ entries, manifest: null, disk: new Map(entries.map((e) => [e.path, 'absent'] as const)), reconciledTexts: new Map(), hash, retained: [], romlift: VERSION });
  const texts = new Map<string, string>();
  for (const op of fresh.ops) if (op.op === 'write') texts.set(op.path, op.text);
  const disk = new Map<string, string | 'absent'>([...texts].map(([path, text]) => [path, hash(text)] as const));
  const cTexts = new Map([...texts].filter(([path]) => path.startsWith('src/') && path.endsWith('.c')));
  const manifest: Manifest = fresh.manifest;
  return { project: { rom, configText: plan.tomlText, config: plan.config, cTexts }, state: { manifest, journal: null, disk, reconciledTexts: new Map() }, texts };
}

test('right after init, generate over the project plans only keeps and changes nothing, on every committed fixture', () => {
  let fixtures = 0;
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const { project, state } = afterInit(rom);
    const plan = generateProject(project);
    assert.ok(plan.ok, `${fixture.name}: ${plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', ')}`);
    assert.ok(plan.result.report.ok, fixture.name);
    const writes = planWrites(projectPlanInputs(plan.result.model, generatedEntries(rom, plan.result), state, hash, VERSION));
    const active = writes.ops.filter((op) => op.op !== 'keep').map((op) => `${op.op} ${op.path}`);
    assert.deepEqual(active, [], fixture.name);
    assert.ok(writes.ops.length > 0, fixture.name);
    assert.ok(planChangesNothing(writes, state), fixture.name);
    fixtures++;
  }
  assert.ok(fixtures >= 3);
});

test('a C file the user changed is kept: the c stub is a scaffold entry, never an edit; a deleted generated file is written again', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project, state } = afterInit(rom);
  const disk = new Map(state.disk);
  disk.set('src/main.c', hash('void Mine(void) {}\n'));
  const firstAsm = [...disk.keys()].find((p) => p.startsWith('asm/')) ?? assert.fail('no asm path');
  disk.set(firstAsm, 'absent');
  const plan = generateProject({ ...project, cTexts: new Map([['src/main.c', 'void Mine(void) {}\n']]) });
  assert.ok(plan.ok);
  const writes = planWrites(projectPlanInputs(plan.result.model, generatedEntries(rom, plan.result), { ...state, disk }, hash, VERSION));
  assert.deepEqual(writes.ops.filter((op) => op.op !== 'keep').map((op) => `${op.op} ${op.path}`), [`write ${firstAsm}`]);
  assert.equal(planChangesNothing(writes, { ...state }), false);
});

test('another ROM than [rom] sha1 is E_ROM_SHA1_MISMATCH, before any analysis', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project } = afterInit(rom);
  const plan = generateProject({ ...project, config: { ...project.config, rom: { ...project.config.rom, sha1: 'f'.repeat(40) } } });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.ok ? [] : plan.diagnostics.map((d) => [d.code, d.path]), [['E_ROM_SHA1_MISMATCH', 'romlift.toml']]);
});

test("the composite's illegal border is E_MODULE_BORDER and nothing is planned", () => {
  const composite = listSyntheticFixtures().find((f) => f.name === 'composite') ?? assert.fail('composite');
  const rom = readFixtureRom(composite);
  const { project } = afterInit(rom);
  const moved = project.config.modules.findIndex((m, i) => i > 0 && m.kind === 'c');
  const modules = project.config.modules.map((m, i) => (i === moved ? { ...m, start: m.start + 2 } : m));
  const plan = generateProject({ ...project, config: { ...project.config, modules } });
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok && plan.diagnostics.some((d) => d.code === 'E_MODULE_BORDER'));
});

test('the illegal TOMLs are refused by the parser with their codes (a repeated line, a seven-digit key), so no plan exists', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project } = afterInit(rom);
  const lines = project.configText.split('\n');
  const at = lines.findIndex((l) => /^0x0[0-9A-F]{7} = /.test(l));
  const line = lines[at] ?? assert.fail('no [functions] line');
  const repeated = parseConfig([...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join('\n'));
  assert.ok(!repeated.ok && repeated.diagnostics.some((d) => d.code === 'E_DUPLICATE_ADDRESS'));
  const spelled = parseConfig([...lines.slice(0, at), line.replace(/^0x0/, '0x'), ...lines.slice(at + 1)].join('\n'));
  assert.ok(!spelled.ok && spelled.diagnostics.some((d) => d.code === 'E_TOML_KEY_SPELLING'));
});

test('decompStateOf: the names src/*.c defines at file scope, unique, in code-unit order; stubs define none', () => {
  const cTexts = new Map([
    ['src/b.c', '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/b", sub_08000100);\nint Zeta(void) { return 0; }\n'],
    ['src/a.c', '/* Alpha(void) { } */\nvoid Alpha(int x) { if (x) { } }\nconst char *s = "Beta() {}";\nvoid Zeta(void) {}\n'],
  ]);
  assert.deepEqual(decompStateOf(cTexts), { defined: ['Alpha', 'Zeta'] });
  assert.deepEqual(decompStateOf(new Map([['src/main.c', '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", sub_0800);\n']])), { defined: [] });
});

test('planChangesNothing: false without a manifest, with a journal, with an active op or another manifest', () => {
  const manifest: Manifest = { schema: 1, romlift: VERSION, files: { 'asm/a.s': { sha1: 'a'.repeat(40), writer: 'function' } } };
  const keep = { ops: [{ op: 'keep' as const, path: 'asm/a.s', sha1: 'a'.repeat(40) }], manifest };
  assert.ok(planChangesNothing(keep, { manifest, journal: null }));
  assert.equal(planChangesNothing(keep, { manifest: null, journal: null }), false);
  assert.equal(planChangesNothing(keep, { manifest, journal: { schema: 1, ops: [] } }), false);
  assert.equal(planChangesNothing({ ...keep, manifest: { ...manifest, romlift: 'other' } }, { manifest, journal: null }), false);
  assert.equal(planChangesNothing({ ops: [{ op: 'delete', path: 'asm/b.s' }], manifest }, { manifest, journal: null }), false);
});
