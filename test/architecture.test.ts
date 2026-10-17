// g1.architecture's ci-tier evidence (architecture §2, D5): the repository has no import edge outside
// the edge table, no global outside the foundation/core allowlist, no locale member or bare sort in
// src, no Map/Set iteration where §2 forbids it, one readdir site in the shell, well-formed barrels,
// and `tsc --noEmit -p tsconfig.json` passes. The rules live in test/helpers/architecture.ts.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checkArchitecture, readCompilerOptions } from './helpers/architecture.ts';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

function typecheckProgram(): ts.Program {
  const configPath = path.join(root, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors, []);
  return ts.createProgram({ rootNames: parsed.fileNames, options: readCompilerOptions(root) });
}

test('the repository typechecks and follows every architecture rule', { timeout: 60_000 }, () => {
  const program = typecheckProgram();
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const text = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  });
  assert.equal(text, '', 'tsc --noEmit -p tsconfig.json');

  const { violations } = checkArchitecture(root, { program });
  const lines = violations.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`);
  assert.deepEqual(lines, []);
});
