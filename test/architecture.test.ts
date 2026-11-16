// g1.architecture's ci-tier evidence (architecture §2, D5, D117): ESLint, with eslint.config.js, reports nothing on
// the repository (the import edges of lint/edges.ts, the foundation/core globals allowlist, no locale member, bare
// sort or stray hex formatting in src, sorted Map/Set iteration where §2 asks for it, one directory listing in the
// shell, well-formed barrels, literal dynamic imports, and no inline disable comment), and
// `tsc --noEmit -p tsconfig.json` passes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

test('the repository typechecks', { timeout: 120_000 }, () => {
  const configPath = path.join(root, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors, []);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const text = ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  });
  assert.equal(text, '', 'tsc --noEmit -p tsconfig.json');
});

test('the repository follows every architecture rule (eslint.config.js)', { timeout: 600_000 }, async () => {
  const results = await new ESLint({ cwd: root }).lintFiles(['.']);
  const lines = results.flatMap((r) => r.messages.map((m) => `${path.relative(root, r.filePath)}:${m.line} [${m.ruleId ?? 'eslint'}] ${m.message}`));
  assert.deepEqual(lines, []);
  assert.ok(results.length > 400, `ESLint checked ${results.length} files; eslint.config.js no longer reaches the repository`);
});
