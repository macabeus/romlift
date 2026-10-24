// The two code-reference scans agree (architecture-r1-3): core/layout/refs.ts borderRefs bounds the legal
// borders by the PC-relative loads and adrs it finds in the analysis' function spans (load addresses, each
// halfword alone), and core/model/labels.ts codeRefs names the references the model prints (the model's code
// segments, run addresses, bl pairs stepped over). A border none of borderRefs' references crosses is safe only
// if every PC-relative reference codeRefs names inside a function span is one of them, at the same site and
// target (the target moved by the run offset inside a runs_at module). Checked on all 47 committed fixtures, for
// the discover run and for the confirm run generate makes over configFromDiscover's config.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import { codeLayout } from '../../../src/core/layout/borders.ts';
import { borderRefs } from '../../../src/core/layout/refs.ts';
import { codeRefs } from '../../../src/core/model/labels.ts';
import { relocatedModules, runOffsetAt } from '../../../src/core/model/modules.ts';
import { segmentsOf } from '../../../src/core/model/segments.ts';
import { initModel } from '../../../src/core/workflow/init-config.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import type { Module } from '../../../src/core/model/types.ts';
import { listSyntheticFixtures, readFixtureRom } from '../../helpers/fixtures.ts';

const fixtures = listSyntheticFixtures();

/** The PC-relative references of codeRefs inside a function span that borderRefs lacks, as `site -> target` texts. */
function missing(rom: Rom, analysis: AnalysisResult, modules: readonly Module[]): { readonly missing: string[]; readonly checked: number } {
  const relocated = relocatedModules(modules);
  const border = new Set(borderRefs(rom, analysis).pcRelative.map((r) => `${r.site}:${r.target + runOffsetAt(relocated, r.site)}`));
  const spans = analysis.functions.flatMap((f) => f.code);
  const inFunction = (a: number): boolean => spans.some((s) => a >= s.start && a < s.end);
  const refs = codeRefs(rom, segmentsOf(rom, analysis, codeLayout(rom, analysis).headerEnd), relocated);
  const out: string[] = [];
  let checked = 0;
  for (const r of refs) {
    if ((r.kind !== 'pool-load' && r.kind !== 'adr') || !inFunction(r.site)) continue;
    checked++;
    if (!border.has(`${r.site}:${r.target}`)) out.push(`0x${r.site.toString(16)} -> 0x${r.target.toString(16)} (${r.specId})`);
  }
  return { missing: out, checked };
}

test('every committed fixture is found', () => {
  assert.equal(fixtures.length, 51);
});

test('every PC-relative reference the model names inside a function is one borderRefs bounds the borders by, discover and confirm runs', () => {
  let checked = 0;
  for (const fixture of fixtures) {
    const rom = readFixtureRom(fixture);
    const found = discover(rom);
    const discovered = missing(rom, found, []);
    assert.deepEqual(discovered.missing, [], `${fixture.name} (discover)`);
    const confirmed = initModel(rom);
    assert.ok(confirmed.ok, fixture.name);
    const confirm = missing(rom, confirmed.analysis, confirmed.model.modules);
    assert.deepEqual(confirm.missing, [], `${fixture.name} (confirm)`);
    checked += discovered.checked + confirm.checked;
  }
  assert.ok(checked > 0, 'the fixtures hold PC-relative references');
});
