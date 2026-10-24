// The frozen phase-4 workflow types (architecture §2.1, §3.4, D74) are plain data: sample values of every shape
// are assignable, and the plans' refusals carry only diagnostics. A type error here fails `npm run typecheck`.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import type { FileEntry } from '../../../src/core/emit/tree.ts';
import type { Proposal } from '../../../src/core/proposals/types.ts';
import { decodeScaffoldManifest } from '../../../src/core/scaffold/vars.ts';
import type { AgbccPin, ScaffoldTemplates } from '../../../src/core/scaffold/vars.ts';
import type { GenerateResult } from '../../../src/core/workflow/generate.ts';
import type {
  AnalyzeUpdateInputs,
  AnalyzeUpdatePlan,
  GeneratePlan,
  InitInputs,
  InitOptions,
  InitPlan,
  ProjectInputs,
} from '../../../src/core/workflow/types.ts';
import type { Diagnostic } from '../../../src/foundation/diagnostics/diagnostic.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';

const rom = romFromBytes(new Uint8Array(0xc0), '0'.repeat(40));
const config: RomliftConfig = {
  schema: 1,
  rom: { path: 'baserom.gba', sha1: '0'.repeat(40) },
  build: { name: 'sample', compiler: 'agbcc' },
  signatures: { enabled: false },
  modules: [{ name: 'rom_header', start: 0x08000000, kind: 'asm', generated: true }],
  functions: new Map(),
  symbols: new Map(),
  overrides: [],
};
const agbcc: AgbccPin = { url: 'https://github.com/pret/agbcc', commit: 'da598c1d918402c42c0c0d7128ba14567f3175e9' };
const manifest = decodeScaffoldManifest(JSON.stringify({ schema: 1, files: [] }));
const templates: ScaffoldTemplates = { manifest: { schema: 1, files: [] }, texts: new Map([['Makefile', 'all:\n']]) };
const refusal: readonly Diagnostic[] = [{ code: 'E_MODULE_BORDER', severity: 'error', message: 'refused' }];
const entry: FileEntry = { ownership: 'scaffold', path: 'Makefile', text: 'all:\n', writer: 'scaffold' };

test('the frozen inputs are assignable from plain data', () => {
  const options: InitOptions = { name: 'sample', moduleSize: 0x200 };
  const init: InitInputs = { rom, romFile: 'sample.gba', options, templates, romliftVersion: '0.4.0', agbcc };
  const bare: InitInputs = { rom, romFile: 'baserom.gba', options: {}, templates, romliftVersion: '0.4.0', agbcc };
  const project: ProjectInputs = { rom, configText: 'schema = 1\n', config, cTexts: new Map([['src/main.c', '#include "include_asm.h"\n']]) };
  const update: AnalyzeUpdateInputs = { rom, configText: 'schema = 1\n', config };
  assert.equal(init.options.moduleSize, 0x200);
  assert.deepEqual(bare.options, {});
  assert.equal(project.cTexts.size, 1);
  assert.equal(update.config.build.name, 'sample');
  assert.equal(manifest.ok, false, 'a manifest without the rendered targets is refused');
});

test('every plan is ok with its data or a refusal with diagnostics only', () => {
  const refusedInit: InitPlan = { ok: false, diagnostics: refusal };
  const refusedGenerate: GeneratePlan = { ok: false, diagnostics: refusal };
  const refusedUpdate: AnalyzeUpdatePlan = { ok: false, diagnostics: refusal };
  const proposal: Proposal = { kind: 'function', addr: 0x080000c0, mode: 'thumb', name: 'Renamed', source: { kind: 'signature', library: 'gate', version: '0', rule: 'sig.unique-fit' } };
  const update: AnalyzeUpdatePlan = { ok: true, proposals: [proposal], text: 'schema = 1\n', changed: false, diagnostics: [] };
  for (const plan of [refusedInit, refusedGenerate, refusedUpdate]) assert.deepEqual(Object.keys(plan).sort(), ['diagnostics', 'ok']);
  assert.equal(update.ok && update.proposals.length, 1);
  // The ok variants, built only as types (a GenerateResult needs a whole run): they must stay assignable.
  const makeInit = (r: GenerateResult): InitPlan => ({ ok: true, config, tomlText: '', decompYamlText: '', result: r, scaffold: [entry], diagnostics: [] });
  const makeGenerate = (r: GenerateResult): GeneratePlan => ({ ok: true, result: r, diagnostics: [] });
  assert.equal(typeof makeInit, 'function');
  assert.equal(typeof makeGenerate, 'function');
});
