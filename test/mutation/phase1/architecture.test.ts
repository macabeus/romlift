// Fault injection into the architecture rules (g1.checks-fail, architecture §10, D117): each fault, added to an
// otherwise clean mini-repository that carries the repository's eslint.config.js and lint/, must make ESLint report
// exactly one problem, of the expected rule.
import { ESLint } from 'eslint';
import assert from 'node:assert/strict';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
// The real path: macOS's tmpdir is a symlink, and ESLint and boundaries must see one spelling of each file.
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'romlift-arch-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A clean tree that exercises the allowed side of every rule the faults below break. */
const CLEAN: Readonly<Record<string, string>> = {
  'src/foundation/util/sorted.ts': [
    'export function sortedKeys<K extends string | number>(map: ReadonlyMap<K, unknown>): K[] {',
    '  const keys: K[] = [];',
    '  map.forEach((_, key) => keys.push(key));',
    '  return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));',
    '}',
    '',
  ].join('\n'),
  'src/foundation/util/numbers.ts': [
    'export const limits = { max: Number.MAX_SAFE_INTEGER, nan: NaN, bytes: new Uint8Array(4) };',
    'export function biggest(values: readonly number[]): number {',
    '  return Math.max(...values, -Infinity);',
    '}',
    'export function ordered(values: readonly number[]): number[] {',
    '  return [...values].sort((a, b) => a - b);',
    '}',
    'export type Clock = typeof Date;',
    '',
  ].join('\n'),
  'src/core/profile/types.ts': 'export interface Profile { readonly name: string }\n',
  'src/core/profile/agbcc.ts':
    "import type { Profile } from './types.ts';\nexport const agbcc: Profile = { name: 'agbcc' };\n",
  'src/core/analysis/types.ts': 'export type Claim = number;\n',
  'src/core/config/parse.ts': 'export const parse = (text: string): number => text.length;\n',
  'src/core/analysis/rules/define-rule.ts': 'export function defineRule<T>(rule: T): T {\n  return rule;\n}\n',
  'src/core/analysis/rules/seed/entry.ts': [
    "import type { Profile } from '../../../profile/types.ts';",
    "import type { Claim } from '../../types.ts';",
    "import { defineRule } from '../define-rule.ts';",
    "export const entry = defineRule({ id: 'seed.entry', claim: (p: Profile): Claim => p.name.length });",
    '',
  ].join('\n'),
  'src/core/analysis/rules/seed/index.ts': "import { entry } from './entry.ts';\nexport const seedRules = [entry];\n",
  'src/core/analysis/rules/index.ts':
    "import { seedRules } from './seed/index.ts';\nexport const rules = [...seedRules];\n",
  'src/core/analysis/driver/run.ts': "import { rules } from '../rules/index.ts';\nexport const count = rules.length;\n",
  'src/core/model/names.ts': [
    "import { sortedKeys } from '../../foundation/util/sorted.ts';",
    'export function names(map: ReadonlyMap<string, number>): string[] {',
    '  return sortedKeys(map);',
    '}',
    '',
  ].join('\n'),
  'src/shell/fs.ts': [
    "import { readdirSync } from 'node:fs';",
    'export function listDir(dir: string): string[] {',
    '  return readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));',
    '}',
    '',
  ].join('\n'),
  'src/shell/project/locate.ts':
    "import { listDir } from '../fs.ts';\nexport const here = (): string[] => listDir('.');\n",
  'src/api/rom.ts': "export { biggest } from '../foundation/util/numbers.ts';\n",
  'src/api/files.ts': "export { listDir } from '../shell/fs.ts';\n",
  'src/api/project.ts': "export { here } from '../shell/project/locate.ts';\n",
  'src/index.ts': "export * from './api/rom.ts';\n",
  'src/node.ts': "export * from './api/files.ts';\nexport * from './api/project.ts';\n",
  'src/isa.ts': 'export {};\n',
  'src/internal.ts': 'export {};\n',
  'bench/src/load.ts': [
    "export async function load(name: 'romlift' | 'romlift/node'): Promise<unknown> {",
    "  return name === 'romlift' ? import('romlift') : import('romlift/node');",
    '}',
    "export const fs = import('node:fs');",
    '',
  ].join('\n'),
  'test/gates/gate.ts': "import { test } from 'node:test';\nexport const register = test;\n",
};

interface Fault {
  readonly name: string;
  /** The ESLint rule that reports it. */
  readonly rule: string;
  readonly file: string;
  readonly text: string;
}

const FAULTS: readonly Fault[] = [
  {
    name: 'foundation imports node:fs',
    rule: 'boundaries/dependencies',
    file: 'src/foundation/util/read.ts',
    text: "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
  },
  {
    name: 'core imports the shell',
    rule: 'boundaries/dependencies',
    file: 'src/core/model/list.ts',
    text: "import { listDir } from '../../shell/fs.ts';\nexport const list = listDir;\n",
  },
  {
    name: 'a rule file imports core/profile/agbcc.ts',
    rule: 'boundaries/dependencies',
    file: 'src/core/analysis/rules/seed/tuned.ts',
    text: "import { agbcc } from '../../../profile/agbcc.ts';\nexport const tuned = agbcc.name;\n",
  },
  {
    name: 'Date.now() in core',
    rule: 'romlift/globals',
    file: 'src/core/model/clock.ts',
    text: 'export function stamp(): number {\n  return Date.now();\n}\n',
  },
  {
    name: '.sort() without a comparator',
    rule: '@typescript-eslint/require-array-sort-compare',
    file: 'src/foundation/util/order.ts',
    text: 'export function order(values: readonly string[]): string[] {\n  return [...values].sort();\n}\n',
  },
  {
    name: 'for...of over a Map in core/model',
    rule: 'romlift/map-iteration',
    file: 'src/core/model/walk.ts',
    text: [
      'export function total(map: ReadonlyMap<string, number>): number {',
      '  let sum = 0;',
      '  for (const [, value] of map) sum += value;',
      '  return sum;',
      '}',
      '',
    ].join('\n'),
  },
  {
    name: 'readdir in shell/project/x.ts',
    rule: 'no-restricted-syntax',
    file: 'src/shell/project/x.ts',
    text: "import * as fs from 'node:fs';\nexport const names = (): string[] => fs.readdirSync('.');\n",
  },
  {
    name: 'a barrel with a non-export line',
    rule: 'romlift/barrel',
    file: 'src/node.ts',
    text: "export * from './api/files.ts';\nexport * from './api/project.ts';\nexport const version = '1';\n",
  },
  {
    name: 'a non-literal dynamic import in bench/src',
    rule: 'romlift/dynamic-import',
    file: 'bench/src/plugin.ts',
    text: 'export async function plugin(specifier: string): Promise<unknown> {\n  return import(specifier);\n}\n',
  },
  // Beyond the nine faults of the roadmap: one per remaining branch of the rules.
  {
    name: 'Math.random in foundation',
    rule: 'no-restricted-properties',
    file: 'src/foundation/util/dice.ts',
    text: 'export const roll = (): number => Math.random();\n',
  },
  {
    name: 'localeCompare in the shell',
    rule: 'no-restricted-properties',
    file: 'src/shell/compare.ts',
    text: 'export const compare = (a: string, b: string): number => a.localeCompare(b);\n',
  },
  {
    name: 'process in core',
    rule: 'romlift/globals',
    file: 'src/core/model/env.ts',
    text: "export const debug = (): boolean => process.env['DEBUG'] === '1';\n",
  },
  {
    name: 'a rule file importing another rule file',
    rule: 'boundaries/dependencies',
    file: 'src/core/analysis/rules/seed/second.ts',
    text: "import { entry } from './entry.ts';\nexport const second = entry;\n",
  },
  {
    name: 'rules/index.ts imported outside driver/',
    rule: 'boundaries/dependencies',
    file: 'src/core/analysis/explain.ts',
    text: "import { rules } from './rules/index.ts';\nexport const ruleCount = rules.length;\n",
  },
  {
    name: 'a spread over a Set in core/layout',
    rule: 'romlift/map-iteration',
    file: 'src/core/layout/spread.ts',
    text: 'export const all = (set: ReadonlySet<number>): number[] => [...set];\n',
  },
  {
    name: 'core/model importing a config value outside compilers.ts',
    rule: 'boundaries/dependencies',
    file: 'src/core/model/config.ts',
    text: "import { parse } from '../config/parse.ts';\nexport const load = parse;\n",
  },
  {
    name: 'an api file re-exported by two barrels',
    rule: 'romlift/barrel',
    file: 'src/internal.ts',
    text: "export * from './api/rom.ts';\n",
  },
  {
    name: 'a browser-safe api file reaching the shell',
    rule: 'romlift/barrel',
    file: 'src/api/rom.ts',
    text: "export { listDir } from '../shell/fs.ts';\n",
  },
  {
    // final-review architecture-1: the verify composition is core/workflow's and the shell's, so the CLI may take
    // only types from the project, verify and write-plan barrels.
    name: 'the CLI importing a value of an api barrel outside its list',
    rule: 'boundaries/dependencies',
    file: 'src/cli/commands/list.ts',
    text: "import { listDir } from '../../api/files.ts';\nimport { biggest } from '../../api/rom.ts';\nimport { here } from '../../api/project.ts';\nexport const all = [listDir, biggest, here];\n",
  },
  {
    name: '.toString(16) outside the hex helpers',
    rule: 'no-restricted-syntax',
    file: 'src/core/model/size.ts',
    text: 'export const size = (n: number): string => `0x${n.toString(16)}`;\n',
  },
  {
    name: 'bench/src importing src directly',
    rule: 'boundaries/dependencies',
    file: 'bench/src/direct.ts',
    text: "import { biggest } from '../../src/foundation/util/numbers.ts';\nexport const top = biggest;\n",
  },
  // D117: the forms the edge rule reads the kind of, and the comment that would switch a rule off.
  {
    name: 'a type-only import written with inline type specifiers',
    rule: '@typescript-eslint/no-import-type-side-effects',
    file: 'src/core/model/inline.ts',
    text: "import { type Claim } from '../analysis/types.ts';\nexport const none: Claim[] = [];\n",
  },
  {
    name: 'an import type expression reaching the shell from core',
    rule: 'boundaries/dependencies',
    file: 'src/core/model/listing.ts',
    text: "export type Lister = typeof import('../../shell/fs.ts').listDir;\n",
  },
];

function miniRepository(name: string, files: Readonly<Record<string, string>>): string {
  const root = path.join(scratch, name.replace(/[^a-z0-9]+/gi, '-'));
  mkdirSync(root, { recursive: true });
  copyFileSync(path.join(repoRoot, 'tsconfig.json'), path.join(root, 'tsconfig.json'));
  copyFileSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
  copyFileSync(path.join(repoRoot, 'eslint.config.js'), path.join(root, 'eslint.config.js'));
  cpSync(path.join(repoRoot, 'lint'), path.join(root, 'lint'), { recursive: true });
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

interface Problem {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

async function lint(root: string): Promise<Problem[]> {
  const results = await new ESLint({ cwd: root }).lintFiles(['.']);
  return results.flatMap((r) =>
    r.messages.map((m) => ({
      file: path.relative(root, r.filePath).split(path.sep).join('/'),
      line: m.line,
      rule: m.ruleId ?? 'eslint',
      message: m.message,
    })),
  );
}

test('the clean mini-repository has no violation', async () => {
  assert.deepEqual(await lint(miniRepository('clean', CLEAN)), []);
});

for (const fault of FAULTS) {
  test(`ESLint reports ${fault.name}`, async () => {
    const problems = await lint(miniRepository(fault.name, { ...CLEAN, [fault.file]: fault.text }));
    assert.equal(problems.length, 1, JSON.stringify(problems, null, 2));
    assert.equal(problems[0]?.rule, fault.rule, JSON.stringify(problems[0]));
    assert.equal(problems[0]?.file, fault.file);
  });
}

test('an eslint-disable comment switches no rule off, and is itself reported', async () => {
  const file = 'src/core/model/disabled.ts';
  const text = '// eslint-disable-next-line romlift/globals\nexport const stamp = (): number => Date.now();\n';
  const problems = await lint(miniRepository('disabled', { ...CLEAN, [file]: text }));
  assert.deepEqual(
    problems.map((p) => [p.file, p.line, p.rule]),
    [
      [file, 1, 'eslint'],
      [file, 2, 'romlift/globals'],
    ],
    JSON.stringify(problems, null, 2),
  );
});
