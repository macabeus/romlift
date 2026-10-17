// Fault injection into the architecture checker (g1.checks-fail, architecture §10): each fault, added
// to an otherwise clean mini-repository, must produce exactly one violation, of the expected rule.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkArchitecture, type ArchitectureRule } from '../../helpers/architecture.ts';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const scratch = mkdtempSync(path.join(tmpdir(), 'romlift-arch-'));
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
  'src/core/profile/agbcc.ts': "import type { Profile } from './types.ts';\nexport const agbcc: Profile = { name: 'agbcc' };\n",
  'src/core/analysis/types.ts': 'export type Claim = number;\n',
  'src/core/analysis/rules/define-rule.ts': 'export function defineRule<T>(rule: T): T {\n  return rule;\n}\n',
  'src/core/analysis/rules/seed/entry.ts': [
    "import type { Profile } from '../../../profile/types.ts';",
    "import type { Claim } from '../../types.ts';",
    "import { defineRule } from '../define-rule.ts';",
    "export const entry = defineRule({ id: 'seed.entry', claim: (p: Profile): Claim => p.name.length });",
    '',
  ].join('\n'),
  'src/core/analysis/rules/seed/index.ts': "import { entry } from './entry.ts';\nexport const seedRules = [entry];\n",
  'src/core/analysis/rules/index.ts': "import { seedRules } from './seed/index.ts';\nexport const rules = [...seedRules];\n",
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
  'src/shell/project/locate.ts': "import { listDir } from '../fs.ts';\nexport const here = (): string[] => listDir('.');\n",
  'src/api/rom.ts': "export { biggest } from '../foundation/util/numbers.ts';\n",
  'src/api/files.ts': "export { listDir } from '../shell/fs.ts';\n",
  'src/index.ts': "export * from './api/rom.ts';\n",
  'src/node.ts': "export * from './api/files.ts';\n",
  'src/isa.ts': 'export {};\n',
  'src/internal.ts': 'export {};\n',
  'bench/src/load.ts': [
    "const ENTRIES = ['romlift', 'romlift/node'] as const;",
    'export async function load(name: (typeof ENTRIES)[number]): Promise<unknown> {',
    '  return import(name);',
    '}',
    "export const fs = import('node:fs');",
    '',
  ].join('\n'),
  'test/gates/gate.ts': "import { test } from 'node:test';\nexport const register = test;\n",
};

interface Fault {
  readonly name: string;
  readonly rule: ArchitectureRule;
  readonly file: string;
  readonly text: string;
}

const FAULTS: readonly Fault[] = [
  {
    name: 'foundation imports node:fs',
    rule: 'edge',
    file: 'src/foundation/util/read.ts',
    text: "import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\n",
  },
  {
    name: 'core imports the shell',
    rule: 'edge',
    file: 'src/core/model/list.ts',
    text: "import { listDir } from '../../shell/fs.ts';\nexport const list = listDir;\n",
  },
  {
    name: 'a rule file imports core/profile/agbcc.ts',
    rule: 'rule-file',
    file: 'src/core/analysis/rules/seed/tuned.ts',
    text: "import { agbcc } from '../../../profile/agbcc.ts';\nexport const tuned = agbcc.name;\n",
  },
  {
    name: 'Date.now() in core',
    rule: 'global',
    file: 'src/core/model/clock.ts',
    text: 'export function stamp(): number {\n  return Date.now();\n}\n',
  },
  {
    name: '.sort() without a comparator',
    rule: 'bare-sort',
    file: 'src/foundation/util/order.ts',
    text: 'export function order(values: readonly string[]): string[] {\n  return [...values].sort();\n}\n',
  },
  {
    name: 'for...of over a Map in core/model',
    rule: 'map-iteration',
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
    rule: 'readdir',
    file: 'src/shell/project/x.ts',
    text: "import * as fs from 'node:fs';\nexport const names = (): string[] => fs.readdirSync('.');\n",
  },
  {
    name: 'a barrel with a non-export line',
    rule: 'barrel',
    file: 'src/node.ts',
    text: "export * from './api/files.ts';\nexport const version = '1';\n",
  },
  {
    name: 'a non-literal dynamic import in bench/src',
    rule: 'dynamic-import',
    file: 'bench/src/plugin.ts',
    text: 'export async function plugin(specifier: string): Promise<unknown> {\n  return import(specifier);\n}\n',
  },
  // Beyond the nine faults of the roadmap: one per remaining branch of the rules.
  {
    name: 'Math.random in foundation',
    rule: 'member',
    file: 'src/foundation/util/dice.ts',
    text: 'export const roll = (): number => Math.random();\n',
  },
  {
    name: 'localeCompare in the shell',
    rule: 'member',
    file: 'src/shell/compare.ts',
    text: "export const compare = (a: string, b: string): number => a.localeCompare(b);\n",
  },
  {
    name: 'process in core',
    rule: 'global',
    file: 'src/core/model/env.ts',
    text: "export const debug = (): boolean => process.env['DEBUG'] === '1';\n",
  },
  {
    name: 'a rule file importing another rule file',
    rule: 'rule-file',
    file: 'src/core/analysis/rules/seed/second.ts',
    text: "import { entry } from './entry.ts';\nexport const second = entry;\n",
  },
  {
    name: 'rules/index.ts imported outside driver/',
    rule: 'rule-file',
    file: 'src/core/analysis/explain.ts',
    text: "import { rules } from './rules/index.ts';\nexport const ruleCount = rules.length;\n",
  },
  {
    name: 'a spread over a Set in core/layout',
    rule: 'map-iteration',
    file: 'src/core/layout/spread.ts',
    text: 'export const all = (set: ReadonlySet<number>): number[] => [...set];\n',
  },
  {
    name: 'core/model importing a config value outside compilers.ts',
    rule: 'edge',
    file: 'src/core/model/config.ts',
    text: "import { parse } from '../config/parse.ts';\nexport const load = parse;\n",
  },
  {
    name: 'an api file re-exported by two barrels',
    rule: 'barrel',
    file: 'src/internal.ts',
    text: "export * from './api/rom.ts';\n",
  },
  {
    name: 'a browser-safe api file reaching the shell',
    rule: 'barrel',
    file: 'src/api/rom.ts',
    text: "export { listDir } from '../shell/fs.ts';\n",
  },
  {
    name: 'bench/src importing src directly',
    rule: 'edge',
    file: 'bench/src/direct.ts',
    text: "import { biggest } from '../../src/foundation/util/numbers.ts';\nexport const top = biggest;\n",
  },
];

function miniRepository(name: string, files: Readonly<Record<string, string>>): string {
  const root = path.join(scratch, name.replace(/[^a-z0-9]+/gi, '-'));
  mkdirSync(root, { recursive: true });
  copyFileSync(path.join(repoRoot, 'tsconfig.json'), path.join(root, 'tsconfig.json'));
  copyFileSync(path.join(repoRoot, 'package.json'), path.join(root, 'package.json'));
  symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('the clean mini-repository has no violation', () => {
  const { violations } = checkArchitecture(miniRepository('clean', CLEAN));
  assert.deepEqual(violations, []);
});

for (const fault of FAULTS) {
  test(`the checker reports ${fault.name}`, () => {
    const { violations } = checkArchitecture(miniRepository(fault.name, { ...CLEAN, [fault.file]: fault.text }));
    assert.equal(violations.length, 1, JSON.stringify(violations, null, 2));
    assert.equal(violations[0]?.rule, fault.rule, JSON.stringify(violations[0]));
    assert.equal(violations[0]?.file, fault.file);
  });
}
