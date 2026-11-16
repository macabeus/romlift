// The architecture rules of architecture §2 (D5, D117), checked by `npm run lint`, by test/architecture.test.ts in
// `npm test`, and in an editor with the ESLint extension. ESLint checks nothing else: no style rule, no recommended
// set. Each rule below says what it protects; the import edges are lint/edges.ts and romlift's own rules
// lint/plugin.ts.
//
// No file can switch a rule off: `noInlineConfig` ignores every `eslint-disable` comment, and the warning ESLint gives
// for one fails `npm run lint` (`--max-warnings 0`). An exception is a change to this file, reviewed as such.
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { ELEMENTS, MESSAGE, POLICIES } from './lint/edges.ts';
import romlift from './lint/plugin.ts';

/** The directories whose import edges are checked (architecture §2). */
const SCANNED = ['src', 'bench/src', 'bench/tools', 'test/gates', 'test/local', 'test/corpus'].map((dir) => `${dir}/**/*.ts`);
const PURE = ['src/foundation/**/*.ts', 'src/core/**/*.ts'];
/** Where Map and Set iteration must be sorted (architecture §2). */
const MAP_ITERATION = ['analysis', 'model', 'emit', 'layout', 'signatures'].map((dir) => `src/core/${dir}/**/*.ts`);
/**
 * Where `.toString(16)` may format a number (architecture §4.4, final-review architecture-4): the hex helpers, and the
 * instruction formatter and corpus, whose operand spelling (lower case, `#0x12`) is the printer's own.
 */
const HEX_FORMATTERS = ['src/foundation/util/hex.ts', 'src/foundation/isa/operand-text.ts', 'src/foundation/corpus/layout.ts'];

// no-restricted-syntax takes one list per file, so each block below repeats the selectors of the blocks before it.
const HEX = {
  selector: "CallExpression[arguments.length=1][arguments.0.raw='16'][callee.property.name='toString']",
  message: '.toString(16) formats hex outside foundation/util/hex.ts; use hex, hexAddr or hexSize',
};
const IMPORT_META = { selector: "MetaProperty[meta.name='import']", message: 'import.meta is not available to foundation or core' };
const READDIR = {
  selector: "Identifier[name=/^(readdir|readdirSync|opendir|opendirSync)$/], MemberExpression[computed=true] > Literal[value=/^(readdir|readdirSync|opendir|opendirSync)$/]",
  message: 'a directory listing outside shell/fs.ts; use listDir, which sorts',
};

export default defineConfig(
  {
    ignores: ['**/node_modules/**', 'dist/**', 'bench/.local/**', 'signatures/**'],
  },
  {
    files: SCANNED,
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries, romlift, '@typescript-eslint': tseslint.plugin },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'boundaries/elements-single-match': true,
      'boundaries/elements': ELEMENTS,
      // `import('./x.ts').T` in a type is a type-only edge too.
      'boundaries/additional-dependency-nodes': [{ selector: 'TSImportType > Literal.source', kind: 'type', name: 'import-type' }],
    },
    rules: {
      // The import edges (lint/edges.ts).
      'boundaries/dependencies': ['error', { default: 'disallow', checkAllOrigins: true, checkInternals: true, message: MESSAGE, policies: POLICIES }],
      // Type-only imports and exports say so at the top, where the edge rule reads the kind.
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'romlift/dynamic-import': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // A sort without a comparator compares as strings (10 sorts before 9).
      '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
      // Locale-dependent members: their result depends on the machine.
      'no-restricted-properties': [
        'error',
        ...['localeCompare', 'toLocaleString', 'toLocaleLowerCase', 'toLocaleUpperCase'].map((property) => ({
          property,
          message: `.${property} depends on the locale`,
        })),
      ],
      'no-restricted-syntax': ['error', HEX],
      'romlift/barrel': 'error',
    },
  },
  {
    files: PURE,
    rules: {
      'romlift/globals': 'error',
      'no-restricted-properties': [
        'error',
        ...['localeCompare', 'toLocaleString', 'toLocaleLowerCase', 'toLocaleUpperCase'].map((property) => ({
          property,
          message: `.${property} depends on the locale`,
        })),
        { object: 'Math', property: 'random', message: 'Math.random is not deterministic' },
      ],
      'no-restricted-syntax': ['error', HEX, IMPORT_META],
    },
  },
  {
    files: HEX_FORMATTERS,
    rules: { 'no-restricted-syntax': ['error', IMPORT_META] },
  },
  {
    files: ['src/shell/**/*.ts'],
    ignores: ['src/shell/fs.ts'],
    rules: { 'no-restricted-syntax': ['error', HEX, READDIR] },
  },
  {
    files: MAP_ITERATION,
    rules: { 'romlift/map-iteration': 'error' },
  },
);
