// Fault injection into the TOML patch planner (g4.checks-fail, architecture §6.5, §10, D23). A project on disk is
// loaded and patched as `analyze --update --write` will do it (loadConfig, planPatch, saveConfig only when the patch
// is accepted): a hand-restructured [functions.0x…] table is E_TOML_PATCH_REFUSED and romlift.toml is left byte for
// byte as it was. Then two mutants show that the re-parse comparison carries weight: a planner that skips it
// (planLineEdits alone) accepts a patch whose text does not mean the config it was asked for, which the contract
// check below catches and the real planner refuses; and a line edit corrupted after planning is refused by the
// comparison itself.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { renderDecompYaml } from '../../../src/core/config/decomp-yaml.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { applyProposals, planLineEdits, planPatch, verifyPatched } from '../../../src/core/config/patch.ts';
import type { ConfigPatchResult } from '../../../src/core/config/patch.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { serializeConfig } from '../../../src/core/config/serialize.ts';
import type { Proposal } from '../../../src/core/proposals/types.ts';
import { loadConfig } from '../../../src/shell/config/load.ts';
import { saveConfig } from '../../../src/shell/config/save.ts';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const SHA1 = '963a50107f0fc692ddfe294c4fcaf305c0d30aaa';

const TOML = `# my project
schema = 1

[rom]
path = "baserom.gba"
sha1 = "${SHA1}"

[build]
name = "rlfx"
compiler = "agbcc"

[signatures]
enabled = false

[[modules]]
name = "main"
start = 0x08000000
kind = "asm"

[functions]
0x08000000 = { name = "sub_08000000", mode = "arm" }   # entry
0x08000010 = "sub_08000010"
0x08000020 = "sub_08000020"

[symbols]
`;

/** The same config with 0x08000010 restructured by hand into its own table. */
const RESTRUCTURED = `${TOML.replace('0x08000010 = "sub_08000010"\n', '')}
# kept apart to annotate it
[functions.0x08000010]
name = "sub_08000010"
`;

type Planner = (text: string, config: RomliftConfig, proposals: readonly Proposal[]) => ConfigPatchResult;

const rename = (addr: number, name: string): Proposal => ({ kind: 'function', addr, mode: 'thumb', name, source: { kind: 'legacy' } });

/** The planner with the re-parse comparison skipped: the mutant g4.checks-fail requires this test to catch. */
const skipsComparison: Planner = (text, config, proposals) => {
  const planned = planLineEdits(text, config, proposals);
  return planned.ok ? { ok: true, text: planned.text, diagnostics: [] } : planned;
};

/** The planner's contract: an accepted patch re-parses to applyProposals(config, proposals). */
function honours(planner: Planner, text: string, config: RomliftConfig, proposals: readonly Proposal[]): boolean {
  const result = planner(text, config, proposals);
  if (!result.ok) return result.diagnostics.length > 0 && result.diagnostics.every((d) => d.code === 'E_TOML_PATCH_REFUSED');
  const reparsed = parseConfig(result.text);
  return reparsed.ok && serializeConfig(reparsed.value) === serializeConfig(applyProposals(config, proposals));
}

function config(text: string): RomliftConfig {
  const parsed = parseConfig(text);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.diagnostics.map((d) => d.message).join('; '));
  return parsed.value;
}

async function project(toml: string): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'romlift-patch-mutation-')));
  roots.push(dir);
  await writeFile(join(dir, 'decomp.yaml'), renderDecompYaml({ name: 'rlfx', title: 'RLFX', gameCode: 'RLFX', sha1: SHA1 }));
  await writeFile(join(dir, 'romlift.toml'), toml);
  return dir;
}

/** analyze --update --write's flow: load, plan, save only an accepted patch. */
async function updateWrite(dir: string, proposals: readonly Proposal[]): Promise<ConfigPatchResult> {
  const loaded = await loadConfig(dir);
  assert.ok(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.diagnostics));
  const result = planPatch(loaded.value.text, loaded.value.value, proposals);
  if (result.ok) assert.equal((await saveConfig(dir, result.text, loaded.value.project.config)).ok, true);
  return result;
}

test('a clean patch of the canonical file is accepted and saved, comments kept', async () => {
  const dir = await project(TOML);
  const result = await updateWrite(dir, [rename(0x0800_0010, 'Main')]);
  assert.ok(result.ok);
  assert.equal(await readFile(join(dir, 'romlift.toml'), 'utf8'), TOML.replace('0x08000010 = "sub_08000010"', '0x08000010 = { name = "Main", from = "legacy" }'));
});

test('a hand-restructured table is E_TOML_PATCH_REFUSED and romlift.toml is left as it was', async () => {
  const dir = await project(RESTRUCTURED);
  const before = await readFile(join(dir, 'romlift.toml'));
  const result = await updateWrite(dir, [rename(0x0800_0010, 'Main')]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok ? [] : result.diagnostics.map((d) => [d.code, d.addr]),
    [['E_TOML_PATCH_REFUSED', 0x0800_0010]],
  );
  assert.match(result.ok ? '' : (result.diagnostics[0]?.message ?? ''), /replace it with this line under \[functions\]: 0x08000010 = \{ name = "Main", from = "legacy" \}$/);
  assert.deepEqual(await readFile(join(dir, 'romlift.toml')), before);
});

test('a planner that skips the re-parse comparison is caught: it accepts a text that does not mean the intended config', () => {
  // The config the caller holds is not what the text says (the file changed after it was read): the line edit of
  // 0x08000010 applies cleanly, but the text still names 0x08000020 sub_08000020 where the intended config says Old.
  const stale = config(TOML.replace('0x08000020 = "sub_08000020"', '0x08000020 = "Old"'));
  const proposals = [rename(0x0800_0010, 'Main')];
  assert.equal(honours(planPatch, TOML, stale, proposals), true, 'the real planner refuses');
  const real = planPatch(TOML, stale, proposals);
  assert.equal(real.ok ? 'accepted' : real.diagnostics[0]?.code, 'E_TOML_PATCH_REFUSED');
  assert.equal(honours(skipsComparison, TOML, stale, proposals), false, 'the mutant accepts a wrong text, and the contract check sees it');
  // On a sound input both agree, so the check is not trivially false.
  assert.equal(honours(skipsComparison, TOML, config(TOML), proposals), true);
  assert.equal(honours(planPatch, RESTRUCTURED, config(RESTRUCTURED), proposals), true);
});

test('a line edit corrupted after planning is refused by the comparison', () => {
  const base = config(TOML);
  const planned = planLineEdits(TOML, base, [rename(0x0800_0010, 'Main')]);
  assert.ok(planned.ok);
  assert.equal(verifyPatched(planned.text, base, planned.intended), undefined);
  const corruptions = [
    planned.text.replace('name = "Main"', 'name = "Mian"'),
    planned.text.replace('0x08000010 = {', '0x08000018 = {'),
    planned.text.replace('0x08000020 = "sub_08000020"\n', ''),
    planned.text.replace('0x08000010 = {', '0x08000010 = { mode = "arm",'),
    planned.text.replace('[symbols]\n', '[symbols]\n0x08000010 = "x"\n'),
  ];
  for (const text of corruptions) {
    assert.notEqual(text, planned.text);
    assert.equal(verifyPatched(text, base, planned.intended)?.code, 'E_TOML_PATCH_REFUSED', text);
  }
});
