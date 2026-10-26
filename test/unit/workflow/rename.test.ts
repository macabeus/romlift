// planRename (architecture §2.1, §6.6, roadmap 6.E, D9, D92): the one-line TOML patch and the identifier edits of every
// text that names the old name, as reconciled entries over the shell's sha1s; the refusals (E_RENAME_INVALID,
// E_RENAME_UNKNOWN, E_RENAME_EXISTS, E_TOML_PATCH_REFUSED) plan nothing; the journal and stale-config checks.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig } from '../../../src/core/config/parse.ts';
import type { RomliftConfig } from '../../../src/core/config/schema.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';
import { isRenameTarget, planRename, renameJournalProblems, renameProblems, staleRenameConfig } from '../../../src/core/workflow/rename.ts';
import type { RenameInputs } from '../../../src/core/workflow/rename.ts';

const TOML = `schema = 1

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
kind = "c"

[functions]
0x08000100 = "sub_08000100"
0x08000200 = { name = "m4aSoundMain", from = "sig:m4a@2001" }
0x08000300 = { name = "Third", aliases = ["ThirdAlias"] }

[symbols]
0x03000000 = "gMain"
`;

function config(text: string = TOML): RomliftConfig {
  const parsed = parseConfig(text);
  assert.ok(parsed.ok);
  return parsed.value;
}

const TEXTS: ReadonlyMap<string, string> = new Map([
  ['src/main.c', '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", sub_08000100);\n/* sub_08000100 */ const char *s = "sub_08000100";\n'],
  ['include/main.h', '#define CALL sub_08000100()\nvoid sub_08000100(void);\n'],
  ['src/other.c', 'int unrelated;\n'],
]);

/** Names a project's model emits that romlift.toml does not list: a default orphan, a default data symbol, a local label. */
const MODEL_NAMES: ReadonlyMap<string, number> = new Map([
  ['unk_0800032C', 0x0800_032c],
  ['gUnk_0809B670', 0x0809_b670],
  ['_08004808', 0x0800_4808],
  ['sub_08000100', 0x0800_0100],
]);

function inputs(from: string, to: string, texts: ReadonlyMap<string, string> = TEXTS): RenameInputs {
  return { configText: TOML, config: config(), from, to, texts, sha1s: new Map([...texts.keys()].map((p) => [p, `sha1-of-${p}`] as const)), modelNames: MODEL_NAMES };
}

function codes(plan: ReturnType<typeof planRename>): readonly string[] {
  return plan.diagnostics.map((d) => d.code);
}

test('a rename: one TOML line, and the identifier edits of every text that names it, by path, over its sha1', () => {
  const plan = planRename(inputs('sub_08000100', 'InitGame'));
  assert.ok(plan.ok);
  assert.deepEqual(plan.diagnostics, []);
  const before = TOML.split('\n');
  const after = plan.tomlText.split('\n');
  assert.deepEqual(after.filter((line, i) => line !== before[i]), ['0x08000100 = "InitGame"']);
  assert.deepEqual(plan.edits.map((e) => [e.ownership, e.path, e.baseSha1, e.edits.length]), [
    ['reconciled', 'include/main.h', 'sha1-of-include/main.h', 2],
    ['reconciled', 'src/main.c', 'sha1-of-src/main.c', 1],
  ]);
  const main = plan.edits.find((e) => e.path === 'src/main.c');
  assert.equal(applyTextEdits(TEXTS.get('src/main.c') ?? '', main?.edits ?? []), '#include "include_asm.h"\n\nINCLUDE_ASM("asm/nonmatchings/main", InitGame);\n/* sub_08000100 */ const char *s = "sub_08000100";\n');
});

test("the entry's from key is dropped; an alias and a symbol rename too; a name in no text plans no edit", () => {
  const sound = planRename(inputs('m4aSoundMain', 'SoundMain'));
  assert.ok(sound.ok);
  assert.ok(sound.tomlText.includes('0x08000200 = "SoundMain"\n'));
  assert.deepEqual(sound.edits, []);
  const alias = planRename(inputs('ThirdAlias', 'Third2'));
  assert.ok(alias.ok && alias.tomlText.includes('0x08000300 = { name = "Third", aliases = ["Third2"] }\n'));
  const symbol = planRename(inputs('gMain', 'gMainState'));
  assert.ok(symbol.ok && symbol.tomlText.includes('0x03000000 = "gMainState"\n'));
});

test('refusals: an invalid new name, an unknown old one, a name the project has; each plans nothing', () => {
  for (const bad of ['', '1abc', 'with space', 'a.b', 'int', 'static', '__attribute__', 'a'.repeat(201), 'naïve']) {
    const plan = planRename(inputs('sub_08000100', bad));
    assert.equal(plan.ok, false, bad);
    assert.deepEqual(codes(plan), ['E_RENAME_INVALID'], bad);
  }
  assert.deepEqual(codes(planRename(inputs('NoSuchName', 'Other'))), ['E_RENAME_UNKNOWN']);
  for (const taken of ['Third', 'ThirdAlias', 'gMain', 'main', 'sub_08000100']) assert.deepEqual(codes(planRename(inputs('m4aSoundMain', taken))), ['E_RENAME_EXISTS'], taken);
  assert.deepEqual(codes(planRename(inputs('NoSuchName', 'main'))), ['E_RENAME_UNKNOWN', 'E_RENAME_EXISTS'], 'every refusal at once');
  assert.deepEqual(renameProblems(config(), 'sub_08000100', 'InitGame'), []);
  assert.ok(isRenameTarget('_x9') && isRenameTarget('Foo_Bar') && !isRenameTarget('$x'));
});

test('a name the project\'s model emits is refused (correctness-1): a default orphan, a default data symbol, a local label', () => {
  for (const emitted of ['unk_0800032C', 'gUnk_0809B670', '_08004808']) {
    const plan = planRename(inputs('sub_08000100', emitted));
    assert.equal(plan.ok, false, emitted);
    assert.deepEqual(codes(plan), ['E_RENAME_EXISTS'], emitted);
    assert.match(plan.diagnostics[0]?.message ?? '', /the project's model already names 0x[0-9A-F]{8} /);
  }
  assert.deepEqual(renameProblems(config(), 'sub_08000100', 'unk_0800032C'), [], 'without the model names, only the TOML is read');
});

test('a file rename does not edit (a link, not UTF-8, binary) warns, or refuses when it names the old name (architecture-5)', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
  const clean = planRename({
    ...inputs('sub_08000100', 'InitGame'),
    skipped: [
      { path: 'include/linked.h', reason: 'link', bytes: bytes('int other;\n') },
      { path: 'include/gba', reason: 'link' },
      { path: 'include/blob.bin', reason: 'binary', bytes: bytes('sub_08000100x\0') },
    ],
  });
  assert.ok(clean.ok);
  assert.deepEqual(clean.diagnostics.map((d) => [d.code, d.path]), [
    ['W_RENAME_SKIPPED', 'include/linked.h'],
    ['W_RENAME_SKIPPED', 'include/gba'],
    ['W_RENAME_SKIPPED', 'include/blob.bin'],
  ], 'a longer token is not the name');
  for (const reason of ['link', 'not-utf8', 'binary'] as const) {
    const refused = planRename({ ...inputs('sub_08000100', 'InitGame'), skipped: [{ path: 'src/x.h', reason, bytes: bytes('void sub_08000100(void);\n') }] });
    assert.equal(refused.ok, false, reason);
    assert.deepEqual(codes(refused), ['E_RENAME_SKIPPED_FILE'], reason);
  }
});

test('a TOML entry one line cannot hold is refused with E_TOML_PATCH_REFUSED and plans no edit', () => {
  const restructured = TOML.replace('0x08000100 = "sub_08000100"\n', '').replace('[symbols]', '[functions.0x08000100]\nname = "sub_08000100"\n\n[symbols]');
  const plan = planRename({ ...inputs('sub_08000100', 'InitGame'), configText: restructured, config: config(restructured) });
  assert.equal(plan.ok, false);
  assert.deepEqual(codes(plan), ['E_TOML_PATCH_REFUSED']);
});

test('a text without its sha1 is a broken caller contract', () => {
  assert.throws(() => planRename({ ...inputs('sub_08000100', 'InitGame'), sha1s: new Map() }), /without its sha1/);
});

test('the journal and stale-config checks', () => {
  assert.deepEqual(renameJournalProblems(null), []);
  assert.deepEqual(renameJournalProblems({ schema: 1, ops: [] }).map((d) => d.code), ['E_RENAME_INTERRUPTED']);
  assert.deepEqual(staleRenameConfig('romlift.toml', 'a', 'a'), []);
  assert.deepEqual(staleRenameConfig('romlift.toml', 'a', 'b').map((d) => [d.code, d.path]), [['E_STALE_CONFIG', 'romlift.toml']]);
  assert.match(staleRenameConfig('romlift.toml', 'a', undefined)[0]?.message ?? '', /is gone since rename read it/);
});
