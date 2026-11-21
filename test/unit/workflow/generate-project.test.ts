// generate over a project (architecture §2.1, §6.4, D74 c), pure: right after init, the plan over the disk init's
// write left is keep only and changes nothing (the manifest included), on every committed fixture; an existing C file
// is reconciled (D75 b): its INCLUDE_ASM lines follow the TOML (a renamed function's line replaced, the user's C kept),
// as an edit of the text read, refused with E_STALE_EDIT when the file changed since; another ROM than [rom] sha1 is
// E_ROM_SHA1_MISMATCH before any analysis; an illegal border is E_MODULE_BORDER and plans nothing; the illegal TOMLs
// of g4.toml-mutations are refused by the parser with their codes, so no generate runs; DecompState comes from the
// C texts through the reconciler's scanner.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import { retainedPrefixes } from '../../../src/core/model/paths.ts';
import {
  decompStateOf,
  generateProject,
  generatedEntries,
  projectTreeEntries,
  reconciledTextsOf,
} from '../../../src/core/workflow/generate.ts';
import { init } from '../../../src/core/workflow/init.ts';
import type { ProjectInputs } from '../../../src/core/workflow/types.ts';
import { planWrites } from '../../../src/core/write-plan/plan-writes.ts';
import { planChangesNothing, projectPlanInputs } from '../../../src/core/write-plan/project-plan.ts';
import type { ProjectWriteState } from '../../../src/core/write-plan/project-plan.ts';
import type { DiskFileState, Manifest } from '../../../src/core/write-plan/types.ts';
import { C_STUB_HEADER, includeAsmStatement } from '../../../src/foundation/asm/dialect.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error('the package templates do not read');
const SCAFFOLD = scaffold.value;
const VERSION = SCAFFOLD.romliftVersion;
const hash = (text: string): string => sha1Of(text);

/** The disk a fresh init leaves: every tree and scaffold path written, its manifest; no journal. */
function afterInit(rom: Rom): {
  readonly project: ProjectInputs;
  readonly state: ProjectWriteState;
  readonly texts: ReadonlyMap<string, string>;
} {
  const plan = init({
    rom,
    romFile: 'game.gba',
    options: {},
    templates: SCAFFOLD.templates,
    romliftVersion: VERSION,
    agbcc: SCAFFOLD.agbcc,
  });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => `${d.code} ${d.message}`).join('; '));
  const entries: FileEntry[] = [...generatedEntries(rom, plan.result), ...plan.scaffold];
  const fresh = planWrites({
    entries,
    manifest: null,
    disk: new Map(entries.map((e): [string, DiskFileState] => [e.path, { kind: 'absent' }])),
    reconciledTexts: new Map(),
    hash,
    retained: [],
    romlift: VERSION,
  });
  const texts = new Map<string, string>();
  for (const op of fresh.ops) if (op.op === 'write') texts.set(op.path, op.text);
  const disk = new Map<string, DiskFileState>(
    [...texts].map(([path, text]) => [path, { kind: 'present', sha1: hash(text) }]),
  );
  const cTexts = new Map([...texts].filter(([path]) => path.startsWith('src/') && path.endsWith('.c')));
  const manifest: Manifest = fresh.manifest;
  return {
    project: { rom, configText: plan.tomlText, config: plan.config, cTexts },
    state: { manifest, journal: null, disk, reconciledTexts: new Map() },
    texts,
  };
}

test('right after init, generate over the project plans only keeps and changes nothing, on every committed fixture', () => {
  let fixtures = 0;
  for (const fixture of listSyntheticFixtures()) {
    const rom = readFixtureRom(fixture);
    const { project, state } = afterInit(rom);
    const plan = generateProject(project);
    assert.ok(plan.ok, `${fixture.name}: ${plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', ')}`);
    assert.ok(plan.result.report.ok, fixture.name);
    const writes = planWrites(
      projectPlanInputs(generatedEntries(rom, plan.result), state, hash, VERSION, retainedPrefixes(plan.result.model)),
    );
    const active = writes.ops.filter((op) => op.op !== 'keep').map((op) => `${op.op} ${op.path}`);
    assert.deepEqual(active, [], fixture.name);
    assert.ok(writes.ops.length > 0, fixture.name);
    assert.ok(planChangesNothing(writes, state), fixture.name);
    fixtures++;
  }
  assert.ok(fixtures >= 3);
});

test('a C file the user changed is reconciled: its C is kept and the missing INCLUDE_ASM lines are added as an edit', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project, state, texts } = afterInit(rom);
  const mine = 'void Mine(void) {}\n';
  const disk = new Map(state.disk);
  disk.set('src/main.c', { kind: 'present', sha1: hash(mine) });
  const firstAsm = [...disk.keys()].find((p) => p.startsWith('asm/')) ?? assert.fail('no asm path');
  disk.set(firstAsm, { kind: 'absent' });
  const plan = generateProject({ ...project, cTexts: new Map([['src/main.c', mine]]) });
  assert.ok(plan.ok);
  const writes = planWrites(
    projectPlanInputs(
      projectTreeEntries(rom, plan.result, hash),
      { ...state, disk, reconciledTexts: reconciledTextsOf(plan.result) },
      hash,
      VERSION,
      retainedPrefixes(plan.result.model),
    ),
  );
  assert.deepEqual(
    writes.ops.filter((op) => op.op !== 'keep').map((op) => `${op.op} ${op.path}`),
    [`write ${firstAsm}`, 'edit src/main.c'],
  );
  const edit = writes.ops.find((op) => op.op === 'edit');
  const fresh = texts.get('src/main.c') ?? assert.fail('init wrote no src/main.c');
  // The file had neither a stub nor the include, so it gains the include with its stubs (fix round 6, correctness-b1-2).
  assert.equal(
    edit?.op === 'edit' ? edit.text : '',
    `${C_STUB_HEADER}${mine}${fresh.slice(C_STUB_HEADER.length)}`,
    'the stubs follow the C, which is kept',
  );
  assert.equal(planChangesNothing(writes, { ...state }), false);
});

test('a renamed function: generate replaces its INCLUDE_ASM line in src/<module>.c; a file changed since it was read is E_STALE_EDIT', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project, state, texts } = afterInit(rom);
  const module = project.config.modules.find((m) => m.kind === 'c') ?? assert.fail('far-jump has no c module');
  const path = `src/${module.name}.c`;
  const base = texts.get(path) ?? assert.fail(`init wrote no ${path}`);
  const [entry, fn] =
    [...project.config.functions].find(
      ([a, f]) => base.includes(includeAsmStatement(module.name, f.name)) && a > module.start,
    ) ?? assert.fail('no stub to rename');
  const functions = new Map(project.config.functions);
  functions.set(entry, { ...fn, name: 'Renamed' });
  const plan = generateProject({
    ...project,
    config: { ...project.config, functions },
    cTexts: new Map([[path, base]]),
  });
  assert.ok(plan.ok, plan.ok ? '' : plan.diagnostics.map((d) => d.code).join(', '));
  const known = new Map(state.disk);
  for (const p of plan.result.paths) if (!known.has(p)) known.set(p, { kind: 'absent' });
  const inputs = { ...state, disk: known, reconciledTexts: reconciledTextsOf(plan.result) };
  const writes = planWrites(
    projectPlanInputs(
      projectTreeEntries(rom, plan.result, hash),
      inputs,
      hash,
      VERSION,
      retainedPrefixes(plan.result.model),
    ),
  );
  const edit = writes.ops.find((op) => op.op === 'edit' && op.path === path);
  assert.equal(
    edit?.op === 'edit' ? edit.text : '',
    base.replace(includeAsmStatement(module.name, fn.name), includeAsmStatement(module.name, 'Renamed')),
  );
  const resolved = [...generatedEntries(rom, plan.result)].find((e) => e.path === path);
  assert.equal(
    resolved !== undefined && 'text' in resolved ? resolved.text : '',
    edit?.op === 'edit' ? edit.text : 'no edit',
    'a fresh tree gets the reconciled text',
  );
  const disk = new Map(known);
  disk.set(path, { kind: 'present', sha1: hash(`${base}// edited meanwhile\n`) });
  const stale = planWrites(
    projectPlanInputs(
      projectTreeEntries(rom, plan.result, hash),
      { ...inputs, disk },
      hash,
      VERSION,
      retainedPrefixes(plan.result.model),
    ),
  );
  assert.deepEqual(
    stale.diagnostics.map((d) => [d.code, d.path]),
    [['E_STALE_EDIT', path]],
  );
});

test('another ROM than [rom] sha1 is E_ROM_SHA1_MISMATCH, before any analysis', () => {
  const rom = readFixtureRom(listSyntheticFixtures().find((f) => f.name === 'far-jump') ?? assert.fail('far-jump'));
  const { project } = afterInit(rom);
  const plan = generateProject({
    ...project,
    config: { ...project.config, rom: { ...project.config.rom, sha1: 'f'.repeat(40) } },
  });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.ok ? [] : plan.diagnostics.map((d) => [d.code, d.path]), [
    ['E_ROM_SHA1_MISMATCH', 'romlift.toml'],
  ]);
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
    [
      'src/b.c',
      '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/b", sub_08000100);\nint Zeta(void) { return 0; }\n',
    ],
    [
      'src/a.c',
      '/* Alpha(void) { } */\nvoid Alpha(int x) { if (x) { } }\nconst char *s = "Beta() {}";\nvoid Zeta(void) {}\n',
    ],
  ]);
  assert.deepEqual(decompStateOf(cTexts), { defined: ['Alpha', 'Zeta'] });
  assert.deepEqual(
    decompStateOf(
      new Map([['src/main.c', '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", sub_0800);\n']]),
    ),
    { defined: [] },
  );
  // A definition inside an #if region is not one the default build compiles (architecture-a2-3), as for the reconciler.
  assert.deepEqual(
    decompStateOf(new Map([['src/main.c', '#ifdef NONMATCHING\nvoid Foo(void) {\n}\n#endif\nvoid Bar(void) {\n}\n']])),
    { defined: ['Bar'] },
  ); // A file the scanner cannot split: its definitions as far as it reads (its policy, architecture-b0-2); B is not swallowed.
  assert.deepEqual(
    decompStateOf(
      new Map([['src/main.c', 'void A(void){\n#ifdef X\nif(1){\n#else\nif(0){\n#endif\n}\n}\nvoid B(void){}\n']]),
    ),
    { defined: ['A', 'B'] },
  );
  assert.deepEqual(decompStateOf(new Map([['src/main.c', 'int K(a) int a; {\n    return a;\n}\nvoid B(void){}\n']])), {
    defined: ['B'],
  });
});

test('planChangesNothing: false without a manifest, with a journal, with an active op or another manifest', () => {
  const manifest: Manifest = {
    schema: 1,
    romlift: VERSION,
    files: { 'asm/a.s': { sha1: 'a'.repeat(40), writer: 'function' } },
  };
  const keep = { ops: [{ op: 'keep' as const, path: 'asm/a.s', sha1: 'a'.repeat(40) }], manifest };
  assert.ok(planChangesNothing(keep, { manifest, journal: null }));
  assert.equal(planChangesNothing(keep, { manifest: null, journal: null }), false);
  assert.equal(planChangesNothing(keep, { manifest, journal: { schema: 1, ops: [] } }), false);
  assert.equal(
    planChangesNothing({ ...keep, manifest: { ...manifest, romlift: 'other' } }, { manifest, journal: null }),
    false,
  );
  assert.equal(
    planChangesNothing({ ops: [{ op: 'delete', path: 'asm/b.s' }], manifest }, { manifest, journal: null }),
    false,
  );
});
