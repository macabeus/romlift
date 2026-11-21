// The import edges of architecture §2 as eslint-plugin-boundaries settings (D5, D117).
//
// An element is a folder: every scanned file belongs to the first descriptor of ELEMENTS whose folder holds it
// (`boundaries/elements-single-match`). POLICIES say what each element may import; anything they do not allow is
// refused (`default: 'disallow'`). boundaries applies the last policy that matches a dependency, so the order is:
//
// 1. One allow policy per element.
// 2. The files whose rights differ from their folder's (a barrel, the codes registry, a family's index.ts): each first
//    loses every right of its folder, then gets its own.
// 3. The guards: who may import the rule registry, a family's index.ts and its rule files, whatever the importer's
//    own policy allows.
//
// A target is a file (`file.path`), an element, or a package (`module.source`; `module.origin: 'core'` is a Node
// builtin, which must be spelled `node:<name>`). `dependency.kind: 'type'` allows a target to type-only imports and
// exports alone; `no-import-type-side-effects` and `consistent-type-exports` (eslint.config.js) make every type-only
// import and export say so at the top, which is where boundaries reads the kind.

interface Descriptor {
  readonly type: string;
  readonly pattern: string;
  readonly partialMatch: false;
  readonly capture?: readonly string[];
}

const folder = (type: string, pattern: string, capture?: readonly string[]): Descriptor =>
  capture === undefined ? { type, pattern, partialMatch: false } : { type, pattern, partialMatch: false, capture };

/** The elements, most specific first: a file belongs to the first folder that holds it. */
export const ELEMENTS: readonly Descriptor[] = [
  folder('foundation', 'src/foundation'),
  folder('provenance', 'src/core/provenance'),
  folder('profile', 'src/core/profile'),
  // core/analysis/rules/<family>/: a family index.ts and its rule files.
  folder('rule-family', 'src/core/analysis/rules/*', ['family']),
  folder('analysis', 'src/core/analysis'),
  folder('proposals', 'src/core/proposals'),
  folder('layout', 'src/core/layout'),
  folder('signatures', 'src/core/signatures'),
  folder('config', 'src/core/config'),
  folder('model', 'src/core/model'),
  folder('reconcile', 'src/core/reconcile'),
  folder('scaffold', 'src/core/scaffold'),
  folder('emit', 'src/core/emit'),
  folder('verify', 'src/core/verify'),
  folder('write-plan', 'src/core/write-plan'),
  folder('workflow', 'src/core/workflow'),
  // Any other core file (core/diagnostic-codes.ts has its own policy below): the commit that adds a core module adds
  // its element and policy.
  folder('core-unlisted', 'src/core'),
  folder('shell', 'src/shell'),
  folder('cli', 'src/cli'),
  folder('api', 'src/api'),
  // The entry barrels (src/index.ts, ...) have their own policy below.
  folder('src-unlisted', 'src'),
  folder('bench', 'bench/src'),
  folder('bench-tools', 'bench/tools'),
  folder('test-gates', 'test/gates'),
  folder('test-local', 'test/local'),
  folder('test-corpus', 'test/corpus'),
  // Everything else in the repository (test/unit, test/helpers, docs, ...): a target, which no policy allows.
  folder('other', '**'),
];

type Selector = Record<string, unknown>;

interface Policy {
  readonly from: Selector;
  readonly allow?: Selector;
  readonly disallow?: Selector;
  readonly message?: string;
}

const types = (...names: string[]): Selector => ({ element: { type: names } });
const files = (...paths: string[]): Selector => ({ file: { path: paths } });
const packages = (...sources: string[]): Selector => ({ module: { origin: 'external', source: sources } });
const NODE_BUILTINS: Selector = { module: { origin: 'core', source: 'node:*' } };
const RUNTIME_DEPS = packages(
  'smol-toml',
  'smol-toml/**',
  'zod',
  'zod/**',
  '@match-kit/decomp-yaml',
  '@match-kit/decomp-yaml/**',
);
const ENTRY_POINTS = packages('romlift', 'romlift/node', 'romlift/isa', 'romlift/internal');
const FOUNDATION = types('foundation');
const ALL_CORE = files('src/core/**');

const RULES = 'src/core/analysis/rules';
const RULES_INDEX = `${RULES}/index.ts`;
const DEFINE_RULE = `${RULES}/define-rule.ts`;
const FAMILY_INDEX = `${RULES}/*/index.ts`;
/** A file directly in rules/ besides index.ts and define-rule.ts belongs to no family. */
const LOOSE_RULE_FILE = `${RULES}/!(index|define-rule).ts`;

/** What a rule file may import (architecture §2, `core/analysis/rules/<family>/<rule>.ts`). */
const RULE_FILE_DEPS: readonly Selector[] = [
  FOUNDATION,
  types('provenance'),
  files(
    'src/core/profile/types.ts',
    'src/core/analysis/types.ts',
    'src/core/analysis/walk/**',
    'src/core/analysis/walk.ts',
    'src/core/analysis/pointers.ts',
    'src/core/analysis/address-map.ts',
    'src/core/analysis/limits.ts',
    DEFINE_RULE,
  ),
];

const may = (from: string, to: readonly Selector[]): Policy => ({ from: types(from), allow: { to } });
const mayForTypes = (from: string, to: readonly Selector[]): Policy => ({
  from: types(from),
  allow: { to, dependency: { kind: 'type' } },
});
/** A file whose rights are not its folder's: none of its folder's, then exactly `to`. */
const only = (from: readonly string[], to: readonly Selector[]): Policy[] => [
  { from: files(...from), disallow: { dependency: { kind: '*' } } },
  ...(to.length === 0 ? [] : [{ from: files(...from), allow: { to } }]),
];

const ELEMENT_POLICIES: readonly Policy[] = [
  may('foundation', [FOUNDATION]),
  may('provenance', [FOUNDATION, types('provenance')]),
  may('profile', [FOUNDATION, types('provenance', 'profile')]),
  may('rule-family', RULE_FILE_DEPS),
  may('analysis', [FOUNDATION, types('provenance', 'profile', 'analysis', 'rule-family')]),
  may('proposals', [FOUNDATION, types('provenance', 'proposals')]),
  may('layout', [
    FOUNDATION,
    files('src/core/profile/types.ts', 'src/core/analysis/types.ts'),
    types('proposals', 'layout'),
  ]),
  may('signatures', [
    FOUNDATION,
    types('provenance', 'proposals', 'signatures'),
    files('src/core/analysis/types.ts'),
    packages('zod', 'zod/**'),
  ]),
  may('config', [FOUNDATION, types('proposals', 'config'), RUNTIME_DEPS]),
  may('model', [
    FOUNDATION,
    types('provenance', 'model'),
    files(
      'src/core/profile/types.ts',
      'src/core/analysis/types.ts',
      'src/core/config/compilers.ts',
      'src/core/layout/borders.ts',
    ),
  ]),
  // "core/config (types and compilers.ts)": the rest of the config module is reachable for types only.
  mayForTypes('model', [types('config')]),
  may('reconcile', [FOUNDATION, types('reconcile')]),
  may('scaffold', [FOUNDATION, types('scaffold')]),
  may('emit', [FOUNDATION, types('model', 'reconcile', 'emit')]),
  // core/reconcile and core/config/compilers.ts: the text-layout check reads a C stub's INCLUDE_ASM statements with the
  // one C tokenizer (no regex runs over code, §6.6) and a C unit's compiler (D74).
  may('verify', [
    FOUNDATION,
    types('model', 'reconcile', 'verify'),
    files('src/core/emit/tree.ts', 'src/core/config/compilers.ts'),
  ]),
  may('write-plan', [FOUNDATION, types('write-plan'), files('src/core/emit/tree.ts')]),
  may('workflow', [FOUNDATION, ALL_CORE]),
  may('shell', [FOUNDATION, ALL_CORE, types('shell'), NODE_BUILTINS, RUNTIME_DEPS]),
  may('cli', [
    types('shell', 'workflow', 'cli'),
    files('src/core/diagnostic-codes.ts', 'src/foundation/diagnostics/**'),
    // The api files whose values the CLI may use: reading files and ROMs, formatting and codecs. The verify, project
    // and write-plan barrels are composition, which lives in core/workflow and the shell's runners (D36; final-review
    // architecture-1), so the CLI reaches them only for types.
    files('src/api/{analysis,config,config-types,files,formats,isa,model,rom,toolchain,workflow-one-shot}.ts'),
  ]),
  mayForTypes('cli', [types('api')]),
  may('api', [FOUNDATION, ALL_CORE, types('shell')]),
  may('bench', [ENTRY_POINTS, NODE_BUILTINS, types('bench')]),
  may('bench-tools', [ENTRY_POINTS, NODE_BUILTINS, types('bench-tools', 'bench')]),
  may('test-gates', [ENTRY_POINTS, NODE_BUILTINS, types('test-gates')]),
  may('test-local', [ENTRY_POINTS, NODE_BUILTINS, types('test-local')]),
  // The corpus driver: romlift through its entry points, and the bench's argument parser (D55).
  may('test-corpus', [ENTRY_POINTS, NODE_BUILTINS, types('test-corpus'), files('bench/src/args.ts')]),
];

const FILE_POLICIES: readonly Policy[] = [
  // A family's index.ts also imports its own rule files.
  { from: files(FAMILY_INDEX), allow: { to: files(`${RULES}/{{from.element.captured.family}}/*.ts`) } },
  ...only([LOOSE_RULE_FILE], RULE_FILE_DEPS),
  ...only(
    ['src/core/diagnostic-codes.ts'],
    [files('src/core/**/codes.ts', 'src/foundation/rom/codes.ts', 'src/foundation/diagnostics/**')],
  ),
  ...only(['src/cli/commands/index.ts'], [files('src/cli/commands/*.ts', 'src/cli/registry.ts')]),
  ...only(['src/{index,node,isa,internal}.ts'], [files('src/api/*.ts')]),
  // An api file lives directly in src/api/.
  ...only(['src/api/*/**'], []),
];

const GUARDS: readonly Policy[] = [
  {
    from: files('!src/core/analysis/driver/**'),
    disallow: { to: files(RULES_INDEX) },
    message: 'only core/analysis/driver/ imports rules/index.ts',
  },
  {
    from: files(`!${RULES_INDEX}`),
    disallow: { to: files(FAMILY_INDEX) },
    message: 'only rules/index.ts imports a family index',
  },
  {
    from: files(`!${FAMILY_INDEX}`),
    disallow: { to: files(`${RULES}/*/!(index).ts`, LOOSE_RULE_FILE) },
    message: "only the family's index.ts imports its rule files",
  },
  {
    from: files(FAMILY_INDEX),
    disallow: {
      to: [
        { element: { type: 'rule-family', captured: { family: '!{{from.element.captured.family}}' } } },
        files(LOOSE_RULE_FILE),
      ],
    },
    message: "only the family's index.ts imports its rule files",
  },
  { from: files('**'), disallow: { to: files('**/*.test.ts') }, message: 'a test file is never imported' },
];

export const POLICIES: readonly Policy[] = [...ELEMENT_POLICIES, ...FILE_POLICIES, ...GUARDS];

export const MESSAGE =
  "a {{from.element.types}} file may not import '{{dependency.source}}' (architecture §2, lint/edges.ts)";
