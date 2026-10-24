// The reconciler's C-in, C-out goldens (architecture §6.6, g6.reconciler, D92): each reconcile/<case>/ holds the C a
// user has (input.c), what the module wants of it (case.json) and what planIncludeAsm makes of it (expected.c, and
// diagnostics.txt when the plan raises any: one `CODE message` per line). Case names start with add-, remove- or move-:
// a stub added at its ROM-order place, a stub whose function left the module removed, and a function that changed
// module (its old directory's stub removed, the new one added). Between them they hold comments, strings and character
// literals that name the functions, `#if` regions, a CRLF file, a byte order mark and an INCLUDE_ASM in an #included
// fragment; every edit is an insertion between tokens or the removal of a whole statement, so the comment, string and
// character-literal tokens of expected.c are those of input.c (g6.reconciler checks that too). UPDATE_GOLDEN=1
// rewrites expected.c and diagnostics.txt.
//
// case.json: { module, path?, chunks: (name | {name, stub})[] in ROM order, tree?: {files, userDirs}, retired?,
// previousStubs?, fragments?: {<project path>: <file of the case directory>}, headers?: likewise, sources?:
// {<project path>: <module>} }.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { tokenizeC } from '../../../src/core/reconcile/c-tokens.ts';
import { planIncludeAsm } from '../../../src/core/reconcile/include-asm.ts';
import type { IncludeAsmWanted, WantedChunk } from '../../../src/core/reconcile/include-asm.ts';
import { applyTextEdits } from '../../../src/core/reconcile/text-edit.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const KINDS: readonly string[] = ['add-', 'remove-', 'move-'];

const CASES = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

interface CaseFile {
  readonly module: string;
  readonly path?: string;
  readonly chunks: readonly (string | WantedChunk)[];
  readonly tree?: { readonly files: readonly string[]; readonly userDirs: readonly string[] };
  readonly retired?: readonly string[];
  readonly previousStubs?: readonly string[];
  readonly fragments?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly sources?: Readonly<Record<string, string>>;
}

/** A map of project paths to the texts of the case directory's files. */
function filesOf(dir: string, files: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.keys(files).sort().map((path) => [path, readFileSync(join(dir, files[path] ?? ''), 'utf8')] as const));
}

/** case.json as planIncludeAsm's wanted chunks. */
function wantedOf(dir: string): IncludeAsmWanted {
  const spec = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')) as CaseFile;
  return {
    module: spec.module,
    chunks: spec.chunks.map((c) => (typeof c === 'string' ? { name: c, stub: c } : c)),
    ...(spec.path === undefined ? {} : { path: spec.path }),
    ...(spec.tree === undefined ? {} : { tree: { files: new Set(spec.tree.files), userDirs: new Set(spec.tree.userDirs) } }),
    ...(spec.retired === undefined ? {} : { retired: spec.retired }),
    ...(spec.previousStubs === undefined ? {} : { previousStubs: spec.previousStubs }),
    ...(spec.fragments === undefined ? {} : { fragments: filesOf(dir, spec.fragments) }),
    ...(spec.headers === undefined ? {} : { headers: filesOf(dir, spec.headers) }),
    ...(spec.sources === undefined ? {} : { sources: new Map(Object.entries(spec.sources)) }),
  };
}

/**
 * The comment, string and character-literal tokens of a text, which no edit may reach into: all of them but the
 * directory string of each INCLUDE_ASM statement (`INCLUDE_ASM ( "<dir>"`), which an added or removed stub brings or
 * takes with it.
 */
function untouchable(text: string): readonly string[] {
  const tokens = tokenizeC(text);
  return tokens
    .filter((t, k) => t.kind === 'comment' || t.kind === 'char' || (t.kind === 'string' && !(tokens[k - 1]?.text === '(' && tokens[k - 2]?.text === 'INCLUDE_ASM')))
    .map((t) => `${t.kind}:${t.text}`);
}

test('the reconciler goldens hold at least two add-, remove- and move- cases, and nothing else', () => {
  for (const kind of KINDS) assert.ok(CASES.filter((name) => name.startsWith(kind)).length >= 2, `fewer than two ${kind} cases: ${CASES.join(', ')}`);
  assert.deepEqual(CASES.filter((name) => !KINDS.some((kind) => name.startsWith(kind))), []);
});

test('between them the cases hold comments, strings, character literals, #if regions, CRLF, a BOM and a fragment stub', () => {
  const inputs = CASES.map((name) => readFileSync(join(DIR, name, 'input.c'), 'utf8'));
  const kinds = new Set(inputs.flatMap((text) => tokenizeC(text).map((t) => t.kind)));
  for (const kind of ['comment', 'string', 'char'] as const) assert.ok(kinds.has(kind), `no case holds a ${kind} token`);
  assert.ok(inputs.some((text) => tokenizeC(text).some((t) => t.kind === 'preprocessor' && /^#\s*if/.test(t.text))), 'no case holds an #if region');
  assert.ok(inputs.some((text) => text.includes('\r\n')), 'no CRLF case');
  assert.ok(inputs.some((text) => text.charCodeAt(0) === 0xfeff), 'no case starts with a byte order mark');
  const fragmentStub = CASES.some((name) => {
    const spec = JSON.parse(readFileSync(join(DIR, name, 'case.json'), 'utf8')) as CaseFile;
    return Object.values(spec.fragments ?? {}).some((file) => readFileSync(join(DIR, name, file), 'utf8').includes('INCLUDE_ASM('));
  });
  assert.ok(fragmentStub, 'no case has an INCLUDE_ASM in an #included fragment');
});

for (const name of CASES) {
  test(`reconcile golden ${name}`, () => {
    const dir = join(DIR, name);
    const input = readFileSync(join(dir, 'input.c'), 'utf8');
    const plan = planIncludeAsm(input, wantedOf(dir));
    const actual = applyTextEdits(input, plan.edits);
    const diagnostics = plan.diagnostics.map((d) => `${d.code} ${d.message}\n`).join('');
    const expectedFile = join(dir, 'expected.c');
    const diagnosticsFile = join(dir, 'diagnostics.txt');
    if (UPDATE) {
      writeFileSync(expectedFile, actual);
      if (diagnostics === '') rmSync(diagnosticsFile, { force: true });
      else writeFileSync(diagnosticsFile, diagnostics);
    }
    assert.equal(actual, readFileSync(expectedFile, 'utf8'), `${name}/expected.c differs; UPDATE_GOLDEN=1 rewrites it`);
    assert.equal(diagnostics, existsSync(diagnosticsFile) ? readFileSync(diagnosticsFile, 'utf8') : '', `${name}/diagnostics.txt differs; UPDATE_GOLDEN=1 rewrites it`);
    assert.notEqual(actual, input, `${name} edits nothing`);
    assert.deepEqual(untouchable(actual), untouchable(input), `${name}: a comment, string or character literal changed`);
    // Reconciling the result again changes nothing: the planner reaches its fixpoint in one run.
    assert.deepEqual(planIncludeAsm(actual, wantedOf(dir)).edits, [], `${name}: a second run still edits`);
  });
}
