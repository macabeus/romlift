// The architecture checker (architecture §2, D5): import edges against the edge table, the globals
// allowlist of foundation and core, deterministic-sort members, the Map/Set iteration rule, the single
// `readdir` site of the shell, barrel shape and dynamic-import specifiers. It reads the repository
// with the TypeScript compiler API and returns every violation; `test/architecture.test.ts` asserts
// there are none and `test/mutation/phase1/architecture.test.ts` proves each rule fires.
//
// The edge table below is the table of architecture §2 written as data, including the layers that do
// not exist yet, so a file that lands later is checked from its first commit.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

export type ArchitectureRule =
  | 'edge'
  | 'global'
  | 'member'
  | 'bare-sort'
  | 'map-iteration'
  | 'readdir'
  | 'rule-file'
  | 'barrel'
  | 'dynamic-import';

export interface ArchitectureViolation {
  /** Repository-relative path with `/` separators. */
  readonly file: string;
  /** 1-based line of the offending node. */
  readonly line: number;
  readonly rule: ArchitectureRule;
  readonly message: string;
}

export interface ArchitectureReport {
  readonly violations: readonly ArchitectureViolation[];
}

export interface ArchitectureOptions {
  /**
   * A program already built from the repository's tsconfig (for example the one the typecheck used).
   * Files outside the scanned directories are ignored. Without it the checker builds its own program
   * over the scanned directories.
   */
  readonly program?: ts.Program;
}

/** The directories whose files are checked, relative to the repository root. */
export const SCANNED_DIRS: readonly string[] = ['src', 'bench/src', 'bench/tools', 'test/gates', 'test/local', 'test/corpus'];

// ---------------------------------------------------------------------------------------------------
// Patterns. A target is a repository-relative path (`src/core/model/x.ts`), `npm:<specifier>` for a
// package (`npm:zod`, `npm:romlift/node`) or `node:<name>` for a builtin. A pattern is a small glob:
// `*` matches one path segment and is captured as $1, $2, ...; `**` matches anything; `{a,b}` is an
// alternation. An allow pattern may refer to the captures of its row's `from` pattern.

interface EdgeRow {
  /** Which files this row governs; the first matching row applies. */
  readonly from: string;
  /** Targets any import may reach. */
  readonly allow: readonly string[];
  /** Targets only a type-only import may reach. */
  readonly allowTypes?: readonly string[];
  /** The rule a forbidden edge from this row reports. */
  readonly rule?: ArchitectureRule;
}

interface TargetGuard {
  /** Which targets this guard protects; the first matching guard applies. */
  readonly target: string;
  /** The only importers allowed (patterns over the importer; may use the target's captures). */
  readonly onlyFrom: readonly string[];
  readonly rule: ArchitectureRule;
  readonly why: string;
}

const FOUNDATION = 'src/foundation/**';
const RUNTIME_DEPS: readonly string[] = ['npm:smol-toml{,/**}', 'npm:zod{,/**}', 'npm:@match-kit/decomp-yaml{,/**}'];
const ENTRY_POINTS: readonly string[] = ['npm:romlift', 'npm:romlift/node', 'npm:romlift/isa', 'npm:romlift/internal'];

/** What a rule file may import (architecture §2, `core/analysis/rules/<family>/<rule>.ts`). */
const RULE_FILE_DEPS: readonly string[] = [
  FOUNDATION,
  'src/core/provenance/**',
  'src/core/profile/types.ts',
  'src/core/analysis/types.ts',
  'src/core/analysis/walk/**',
  'src/core/analysis/walk.ts',
  'src/core/analysis/pointers.ts',
  'src/core/analysis/address-map.ts',
  'src/core/analysis/limits.ts',
  'src/core/analysis/rules/define-rule.ts',
];

export const EDGE_TABLE: readonly EdgeRow[] = [
  { from: 'src/foundation/**', allow: [FOUNDATION] },
  { from: 'src/core/provenance/**', allow: [FOUNDATION, 'src/core/provenance/**'] },
  { from: 'src/core/profile/**', allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/profile/**'] },
  { from: 'src/core/analysis/rules/index.ts', allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/profile/**', 'src/core/analysis/**'] },
  { from: 'src/core/analysis/rules/define-rule.ts', allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/profile/**', 'src/core/analysis/**'] },
  { from: 'src/core/analysis/rules/*/index.ts', allow: [...RULE_FILE_DEPS, 'src/core/analysis/rules/$1/*.ts'], rule: 'rule-file' },
  { from: 'src/core/analysis/rules/*/*.ts', allow: RULE_FILE_DEPS, rule: 'rule-file' },
  { from: 'src/core/analysis/rules/**', allow: RULE_FILE_DEPS, rule: 'rule-file' },
  { from: 'src/core/analysis/**', allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/profile/**', 'src/core/analysis/**'] },
  { from: 'src/core/proposals/**', allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/proposals/**'] },
  {
    from: 'src/core/layout/**',
    allow: [FOUNDATION, 'src/core/profile/types.ts', 'src/core/analysis/types.ts', 'src/core/proposals/**', 'src/core/layout/**'],
  },
  {
    from: 'src/core/signatures/**',
    allow: [FOUNDATION, 'src/core/provenance/**', 'src/core/analysis/types.ts', 'src/core/proposals/**', 'npm:zod{,/**}', 'src/core/signatures/**'],
  },
  { from: 'src/core/config/**', allow: [FOUNDATION, 'src/core/proposals/**', ...RUNTIME_DEPS, 'src/core/config/**'] },
  {
    from: 'src/core/model/**',
    allow: [
      FOUNDATION,
      'src/core/provenance/**',
      'src/core/profile/types.ts',
      'src/core/analysis/types.ts',
      'src/core/config/compilers.ts',
      'src/core/layout/borders.ts',
      'src/core/model/**',
    ],
    // "core/config (types and compilers.ts)": the rest of the config module is reachable for types only.
    allowTypes: ['src/core/config/**'],
  },
  { from: 'src/core/reconcile/**', allow: [FOUNDATION, 'src/core/reconcile/**'] },
  { from: 'src/core/scaffold/**', allow: [FOUNDATION, 'src/core/scaffold/**'] },
  { from: 'src/core/emit/**', allow: [FOUNDATION, 'src/core/model/**', 'src/core/reconcile/**', 'src/core/emit/**'] },
  {
    from: 'src/core/verify/**',
    // core/reconcile and core/config/compilers.ts: the text-layout check reads a C stub's INCLUDE_ASM statements with
    // the one C tokenizer (no regex runs over code, §6.6) and a C unit's compiler (D74).
    allow: [FOUNDATION, 'src/core/model/**', 'src/core/emit/tree.ts', 'src/core/reconcile/**', 'src/core/config/compilers.ts', 'src/core/verify/**'],
  },
  { from: 'src/core/write-plan/**', allow: [FOUNDATION, 'src/core/emit/tree.ts', 'src/core/write-plan/**'] },
  {
    from: 'src/core/diagnostic-codes.ts',
    allow: ['src/core/**/codes.ts', 'src/foundation/rom/codes.ts', 'src/foundation/diagnostics/**'],
  },
  { from: 'src/core/workflow/**', allow: [FOUNDATION, 'src/core/**'] },
  // Any other core file has no row: the table must be extended in the commit that adds the module.
  { from: 'src/core/**', allow: [] },
  { from: 'src/shell/**', allow: ['src/core/**', FOUNDATION, 'src/shell/**', 'node:**', ...RUNTIME_DEPS] },
  { from: 'src/cli/commands/index.ts', allow: ['src/cli/commands/lists/*.ts'], rule: 'barrel' },
  {
    from: 'src/cli/**',
    allow: [
      'src/shell/**',
      'src/core/workflow/**',
      'src/core/diagnostic-codes.ts',
      'src/foundation/diagnostics/**',
      'src/api/**',
      'src/cli/**',
    ],
  },
  { from: 'src/api/*.ts', allow: [FOUNDATION, 'src/core/**', 'src/shell/**'] },
  { from: 'src/{index,node,isa,internal}.ts', allow: ['src/api/*.ts'], rule: 'barrel' },
  { from: 'src/**', allow: [] },
  { from: 'bench/src/**', allow: [...ENTRY_POINTS, 'node:**', 'bench/src/**'] },
  { from: 'bench/tools/**', allow: [...ENTRY_POINTS, 'node:**', 'bench/tools/**', 'bench/src/**'] },
  { from: 'test/gates/**', allow: [...ENTRY_POINTS, 'node:**', 'test/gates/**'] },
  { from: 'test/local/**', allow: [...ENTRY_POINTS, 'node:**', 'test/local/**'] },
  // The corpus driver: romlift through its entry points, and the bench's argument parser (D55).
  { from: 'test/corpus/**', allow: [...ENTRY_POINTS, 'node:**', 'test/corpus/**', 'bench/src/args.ts'] },
];

export const TARGET_GUARDS: readonly TargetGuard[] = [
  {
    target: 'src/core/analysis/rules/index.ts',
    onlyFrom: ['src/core/analysis/driver/**'],
    rule: 'rule-file',
    why: 'only driver/ imports rules/index.ts',
  },
  { target: 'src/core/analysis/rules/define-rule.ts', onlyFrom: ['**'], rule: 'rule-file', why: '' },
  {
    target: 'src/core/analysis/rules/*/index.ts',
    onlyFrom: ['src/core/analysis/rules/index.ts'],
    rule: 'rule-file',
    why: 'only rules/index.ts imports a family index',
  },
  {
    target: 'src/core/analysis/rules/*/**',
    onlyFrom: ['src/core/analysis/rules/$1/index.ts'],
    rule: 'rule-file',
    why: "only the family's index.ts imports its rule files",
  },
  { target: '**/*.test.ts', onlyFrom: [], rule: 'edge', why: 'a test file is never imported' },
];

/** Non-literal dynamic imports are allowed only here: these files load the read-only PoC. */
export const DYNAMIC_IMPORT_ALLOWLIST: readonly string[] = ['bench/tools/export-poc-child.ts', 'test/local/**'];

/** The globals foundation and core may reference (architecture §2). */
export const GLOBALS_ALLOWLIST: ReadonlySet<string> = new Set([
  'Math',
  'Number',
  'String',
  'Boolean',
  'BigInt',
  'Symbol',
  'Array',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'ArrayBuffer',
  'DataView',
  'Map',
  'Set',
  'WeakMap',
  'Object',
  'JSON',
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'TextEncoder',
  'TextDecoder',
  'Infinity',
  'NaN',
  'undefined',
]);

/** Locale-dependent members, banned anywhere in src. */
const LOCALE_MEMBERS: ReadonlySet<string> = new Set(['localeCompare', 'toLocaleString', 'toLocaleLowerCase', 'toLocaleUpperCase']);
const SORT_MEMBERS: ReadonlySet<string> = new Set(['sort', 'toSorted']);
const ITERATING_MEMBERS: ReadonlySet<string> = new Set(['forEach', 'keys', 'values', 'entries']);
const MAP_SET_TYPES: ReadonlySet<string> = new Set(['Map', 'Set', 'ReadonlyMap', 'ReadonlySet']);
const READDIR_NAMES: ReadonlySet<string> = new Set(['readdir', 'readdirSync', 'opendir', 'opendirSync']);
const SORTED_HELPERS: ReadonlySet<string> = new Set(['sortedKeys', 'sortedEntries']);
const SORTED_MODULE = 'src/foundation/util/sorted.ts';
const MAP_ITERATION_SCOPES: readonly string[] = [
  'src/core/analysis/**',
  'src/core/model/**',
  'src/core/emit/**',
  'src/core/layout/**',
  'src/core/signatures/**',
];
const ENTRY_BARRELS: readonly string[] = ['src/index.ts', 'src/node.ts', 'src/isa.ts', 'src/internal.ts'];
/** Entry points that must stay browser-safe: their api files never reach the shell or `node:*`. */
const PURE_BARRELS: ReadonlySet<string> = new Set(['src/index.ts', 'src/isa.ts']);

// ---------------------------------------------------------------------------------------------------
// Glob patterns with captures.

const compiled = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const cached = compiled.get(pattern);
  if (cached) return cached;
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? '';
    if (c === '*' && pattern[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (c === '*') {
      source += '([^/]+)';
    } else if (c === '{') {
      const close = pattern.indexOf('}', i);
      const options = pattern.slice(i + 1, close).split(',');
      source += `(?:${options.map(escapeAll).join('|')})`;
      i = close;
    } else {
      source += escapeAll(c);
    }
  }
  const regex = new RegExp(`^${source}$`);
  compiled.set(pattern, regex);
  return regex;
}

function escapeAll(text: string): string {
  return text.replace(/[.+?^$()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]+');
}

function match(pattern: string, value: string): readonly string[] | undefined {
  const m = compile(pattern).exec(value);
  return m ? m.slice(1) : undefined;
}

function substitute(pattern: string, captures: readonly string[]): string {
  return pattern.replace(/\$(\d)/g, (_, digit: string) => captures[Number(digit) - 1] ?? '');
}

function matchesAny(patterns: readonly string[], value: string, captures: readonly string[]): boolean {
  return patterns.some((pattern) => match(substitute(pattern, captures), value) !== undefined);
}

// ---------------------------------------------------------------------------------------------------
// Files and program.

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function listTsFiles(root: string, dir: string): string[] {
  const absolute = path.join(root, dir);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return [];
  const out: string[] = [];
  const names = readdirSync(absolute).sort(byCodeUnit);
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const relative = `${dir}/${name}`;
    const full = path.join(root, relative);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(root, relative));
    else if (name.endsWith('.ts') || name.endsWith('.mts') || name.endsWith('.cts')) out.push(relative);
  }
  return out;
}

/** Every checked file of the repository, repository-relative, sorted by code unit. */
export function scannedFiles(root: string): readonly string[] {
  return SCANNED_DIRS.flatMap((dir) => listTsFiles(root, dir)).sort(byCodeUnit);
}

/** The compiler options of the repository's tsconfig.json. */
export function readCompilerOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, (file) => readFileSync(file, 'utf8'));
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, { noEmit: true }, configPath);
  return parsed.options;
}

// Library and @types source files never change during a test run, so programs share them; this is
// what keeps the mutation test's many small programs fast.
const sharedSourceFiles = new Map<string, ts.SourceFile>();

function cachingHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const shareable = fileName.includes('/node_modules/');
    if (!shareable) return getSourceFile(fileName, languageVersion, onError, shouldCreate);
    const key = `${fileName}\0${JSON.stringify(languageVersion)}`;
    const cached = sharedSourceFiles.get(key);
    if (cached) return cached;
    const file = getSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (file) sharedSourceFiles.set(key, file);
    return file;
  };
  return host;
}

/** A program over the given files with the repository's compiler options. */
export function createRepositoryProgram(root: string, files: readonly string[]): ts.Program {
  const options = readCompilerOptions(root);
  return ts.createProgram({
    rootNames: files.map((file) => path.join(root, file)),
    options,
    host: cachingHost(options),
  });
}

// ---------------------------------------------------------------------------------------------------
// The checker.

interface FileContext {
  readonly file: string;
  readonly source: ts.SourceFile;
  readonly checker: ts.TypeChecker;
  readonly program: ts.Program;
  readonly root: string;
  readonly report: (node: ts.Node, rule: ArchitectureRule, message: string) => void;
}

interface Edge {
  readonly node: ts.Node;
  readonly specifier: string;
  readonly typeOnly: boolean;
}

export function checkArchitecture(root: string, options: ArchitectureOptions = {}): ArchitectureReport {
  const files = scannedFiles(root);
  const program = options.program ?? createRepositoryProgram(root, files);
  const checker = program.getTypeChecker();
  const violations: ArchitectureViolation[] = [];
  const seen = new Set<string>();

  const sources = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const source = program.getSourceFile(path.join(root, file));
    if (source) sources.set(file, source);
  }

  for (const file of files) {
    const source = sources.get(file);
    if (!source) continue;
    const report = (node: ts.Node, rule: ArchitectureRule, message: string): void => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const key = `${file}\0${line}\0${rule}\0${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({ file, line, rule, message });
    };
    const cx: FileContext = { file, source, checker, program, root, report };
    checkEdges(cx, collectEdges(cx));
    if (file.startsWith('src/')) checkSourceRules(cx);
  }
  checkBarrels(root, files, sources, violations);

  violations.sort(
    (a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || byCodeUnit(a.rule, b.rule) || byCodeUnit(a.message, b.message),
  );
  return { violations };
}

function stringLiteralValues(type: ts.Type): readonly string[] | undefined {
  if (type.isStringLiteral()) return [type.value];
  if (type.isUnion() && type.types.length > 0) {
    const values: string[] = [];
    for (const member of type.types) {
      if (!member.isStringLiteral()) return undefined;
      values.push(member.value);
    }
    return values;
  }
  return undefined;
}

function collectEdges(cx: FileContext): Edge[] {
  const edges: Edge[] = [];
  const dynamicAllowed = DYNAMIC_IMPORT_ALLOWLIST.some((pattern) => match(pattern, cx.file) !== undefined);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (ts.isTypeOnlyImportOrExportDeclaration(clause) ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      edges.push({ node, specifier: node.moduleSpecifier.text, typeOnly });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
      edges.push({ node, specifier: node.moduleSpecifier.text, typeOnly });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      edges.push({ node, specifier: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      edges.push({ node, specifier: node.argument.literal.text, typeOnly: true });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        edges.push({ node, specifier: argument.text, typeOnly: false });
      } else if (!dynamicAllowed) {
        // A specifier whose type is a string literal or a union of them is still known statically:
        // each literal is checked as an edge. Anything else could load any module.
        const values = argument ? stringLiteralValues(cx.checker.getTypeAtLocation(argument)) : undefined;
        if (values) {
          for (const specifier of values) edges.push({ node, specifier, typeOnly: false });
        } else {
          cx.report(node, 'dynamic-import', 'dynamic import with a specifier that is not a string literal (or a union of them)');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cx.source);
  return edges;
}

/** The edge-table form of a specifier: a repository path, `npm:<specifier>` or `node:<name>`. */
function targetOf(file: string, specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  }
  return `npm:${specifier}`;
}

function checkEdges(cx: FileContext, edges: readonly Edge[]): void {
  let row: EdgeRow | undefined;
  let captures: readonly string[] = [];
  for (const candidate of EDGE_TABLE) {
    const m = match(candidate.from, cx.file);
    if (m) {
      row = candidate;
      captures = m;
      break;
    }
  }
  for (const edge of edges) {
    const target = targetOf(cx.file, edge.specifier);
    if (!row) {
      cx.report(edge.node, 'edge', `no edge-table row covers ${cx.file}`);
      continue;
    }
    const allowed =
      matchesAny(row.allow, target, captures) || (edge.typeOnly && matchesAny(row.allowTypes ?? [], target, captures));
    if (!allowed) {
      const hint = target.startsWith('npm:') && isBuiltin(edge.specifier) ? ' (a builtin needs the node: prefix)' : '';
      cx.report(edge.node, row.rule ?? 'edge', `${row.from} may not import '${edge.specifier}'${hint}`);
      continue;
    }
    for (const guard of TARGET_GUARDS) {
      const m = match(guard.target, target);
      if (!m) continue;
      if (!matchesAny(guard.onlyFrom, cx.file, m)) {
        cx.report(edge.node, guard.rule, `'${edge.specifier}': ${guard.why}`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// Rules on the bodies of src files.

function isUnder(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => match(pattern, file) !== undefined);
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function memberReceiver(node: ts.Node): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return node.expression;
  return undefined;
}

/** True when `node` is a name that does not denote a value of the enclosing scope. */
function isNonReferenceName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  if (ts.isMetaProperty(parent)) return true;
  // Declaration names resolve to the declared (user) symbol, so they never look global.
  return false;
}

function isAmbientLibraryFile(program: ts.Program, file: ts.SourceFile): boolean {
  return file.isDeclarationFile && (program.isSourceFileDefaultLibrary(file) || file.fileName.includes('/node_modules/'));
}

function isGlobalSymbol(program: ts.Program, symbol: ts.Symbol): boolean {
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return symbol.name === 'globalThis';
  return declarations.every((declaration) => isAmbientLibraryFile(program, declaration.getSourceFile()));
}

function resolvesToGlobal(cx: FileContext, expression: ts.Expression, name: string): boolean {
  if (!ts.isIdentifier(expression) || expression.text !== name) return false;
  const symbol = cx.checker.getSymbolAtLocation(expression);
  return symbol !== undefined && isGlobalSymbol(cx.program, symbol);
}

function isMapOrSet(cx: FileContext, type: ts.Type, depth = 0): boolean {
  if (depth > 8) return false;
  if (type.isUnionOrIntersection()) return type.types.some((member) => isMapOrSet(cx, member, depth + 1));
  const apparent = type.isTypeParameter() ? (cx.checker.getBaseConstraintOfType(type) ?? type) : type;
  if (apparent !== type) return isMapOrSet(cx, apparent, depth + 1);
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  if (symbol && MAP_SET_TYPES.has(symbol.name) && isGlobalSymbol(cx.program, symbol)) return true;
  if (type.isClassOrInterface()) {
    return cx.checker.getBaseTypes(type).some((base) => isMapOrSet(cx, base, depth + 1));
  }
  return false;
}

function iteratesMapOrSet(cx: FileContext, expression: ts.Expression): boolean {
  return isMapOrSet(cx, cx.checker.getTypeAtLocation(expression));
}

/** True when `node` is passed directly to `sortedKeys`/`sortedEntries` of foundation/util/sorted.ts. */
function isSortedHelperArgument(cx: FileContext, node: ts.Node): boolean {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || !call.arguments.some((argument) => argument === node)) return false;
  const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
  let symbol = cx.checker.getSymbolAtLocation(callee);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = cx.checker.getAliasedSymbol(symbol);
  if (!symbol || !SORTED_HELPERS.has(symbol.name)) return false;
  return (symbol.declarations ?? []).some((declaration) => {
    const relative = path.relative(cx.root, declaration.getSourceFile().fileName).split(path.sep).join('/');
    return relative === SORTED_MODULE;
  });
}

function checkSourceRules(cx: FileContext): void {
  const pure = cx.file.startsWith('src/foundation/') || cx.file.startsWith('src/core/');
  const mapScope = isUnder(cx.file, MAP_ITERATION_SCOPES);
  const shellReaddir = cx.file.startsWith('src/shell/') && cx.file !== 'src/shell/fs.ts';

  const mapIteration = (node: ts.Node, what: string): void => {
    if (isSortedHelperArgument(cx, node)) return;
    cx.report(node, 'map-iteration', `${what} iterates a Map or Set; go through sortedKeys/sortedEntries`);
  };

  const visit = (node: ts.Node): void => {
    // Members banned everywhere in src.
    const member = memberName(node);
    if (member !== undefined && LOCALE_MEMBERS.has(member)) {
      cx.report(node, 'member', `.${member} depends on the locale`);
    }
    if (ts.isCallExpression(node) && node.arguments.length === 0) {
      const callee = memberName(node.expression);
      if (callee !== undefined && SORT_MEMBERS.has(callee)) {
        cx.report(node, 'bare-sort', `.${callee}() without an explicit comparator`);
      }
    }

    if (pure) {
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
        cx.report(node, 'global', 'import.meta is not available to foundation or core');
      }
      if (member === 'random') {
        const receiver = memberReceiver(node);
        if (receiver && resolvesToGlobal(cx, receiver, 'Math')) cx.report(node, 'member', 'Math.random is not deterministic');
      }
      if (ts.isIdentifier(node)) checkGlobalIdentifier(cx, node);
    }

    if (mapScope) {
      if (ts.isForOfStatement(node) && iteratesMapOrSet(cx, node.expression)) mapIteration(node, 'for...of');
      if (ts.isSpreadElement(node) && iteratesMapOrSet(cx, node.expression)) mapIteration(node.parent, 'a spread');
      if (ts.isCallExpression(node) && memberName(node.expression) === 'from') {
        const receiver = memberReceiver(node.expression);
        const first = node.arguments[0];
        if (receiver && first && resolvesToGlobal(cx, receiver, 'Array') && iteratesMapOrSet(cx, first)) {
          mapIteration(node, 'Array.from');
        }
      }
      if (member !== undefined && ITERATING_MEMBERS.has(member)) {
        const receiver = memberReceiver(node);
        if (receiver && iteratesMapOrSet(cx, receiver)) {
          const site = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : node;
          mapIteration(site, `.${member}`);
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isArrayBindingPattern(node.name) &&
        node.initializer &&
        iteratesMapOrSet(cx, node.initializer)
      ) {
        mapIteration(node, 'array destructuring');
      }
    }

    if (shellReaddir) {
      const name = ts.isIdentifier(node) ? node.text : ts.isStringLiteral(node) && ts.isElementAccessExpression(node.parent) ? node.text : undefined;
      if (name !== undefined && READDIR_NAMES.has(name)) {
        cx.report(node, 'readdir', `${name} outside shell/fs.ts; use listDir`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(cx.source);
}

/** True inside `typeof X` in a type: a type position, although the compiler resolves X as a value. */
function isInTypeQuery(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (ts.isQualifiedName(current.parent) || ts.isPropertyAccessExpression(current.parent)) current = current.parent;
  return ts.isTypeQueryNode(current.parent);
}

function checkGlobalIdentifier(cx: FileContext, node: ts.Identifier): void {
  if (ts.isPartOfTypeNode(node) || isInTypeQuery(node) || isNonReferenceName(node)) return;
  if (GLOBALS_ALLOWLIST.has(node.text)) return;
  const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
    ? cx.checker.getShorthandAssignmentValueSymbol(node.parent)
    : cx.checker.getSymbolAtLocation(node);
  if (!symbol || !isGlobalSymbol(cx.program, symbol)) return;
  // Only value references count; a name that is a type alone cannot be read at run time.
  if (!(symbol.flags & ts.SymbolFlags.Value) && symbol.name !== 'globalThis') return;
  cx.report(node, 'global', `global '${node.text}' is not on the foundation/core allowlist`);
}

// ---------------------------------------------------------------------------------------------------
// Barrels.

function checkBarrels(
  root: string,
  files: readonly string[],
  sources: ReadonlyMap<string, ts.SourceFile>,
  violations: ArchitectureViolation[],
): void {
  const push = (source: ts.SourceFile, file: string, node: ts.Node | undefined, message: string): void => {
    const line = node ? source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 : 1;
    violations.push({ file, line, rule: 'barrel', message });
  };
  const reexportedBy = new Map<string, string[]>();
  const firstSite = new Map<string, ts.Node>();

  for (const barrel of ENTRY_BARRELS) {
    const source = sources.get(barrel);
    if (!source) continue;
    const statements = source.statements;
    if (statements.length === 1 && isEmptyExport(statements[0])) continue;
    for (const statement of statements) {
      const ok =
        ts.isExportDeclaration(statement) &&
        !statement.isTypeOnly &&
        statement.exportClause === undefined &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        /^\.\/api\/[a-z0-9-]+\.ts$/.test(statement.moduleSpecifier.text);
      if (!ok) {
        push(source, barrel, statement, "an entry barrel holds only `export * from './api/<name>.ts';` lines, or `export {};`");
        continue;
      }
      const target = `src/api/${(statement.moduleSpecifier as ts.StringLiteral).text.slice('./api/'.length)}`;
      const list = reexportedBy.get(target) ?? [];
      list.push(barrel);
      reexportedBy.set(target, list);
      if (!firstSite.has(target)) firstSite.set(target, statement);
      if (list.length > 1) push(source, barrel, statement, `${target} is already re-exported by ${list[0] ?? ''}`);
    }
  }

  for (const file of files) {
    if (!/^src\/api\/[^/]+\.ts$/.test(file)) continue;
    const source = sources.get(file);
    if (!source) continue;
    for (const statement of source.statements) {
      const ok =
        ts.isExportDeclaration(statement) &&
        ((statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) || isEmptyExport(statement));
      if (!ok) push(source, file, statement, 'an api file holds only re-export statements, or `export {};`');
    }
    const barrels = reexportedBy.get(file) ?? [];
    if (barrels.length === 0) push(source, file, undefined, `${file} is re-exported by no entry barrel`);
    if (barrels.some((barrel) => PURE_BARRELS.has(barrel))) {
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = targetOf(file, statement.moduleSpecifier.text);
        if (target.startsWith('src/shell/') || target.startsWith('node:')) {
          push(source, file, statement, `${file} is re-exported by a browser-safe entry point and may not reach '${statement.moduleSpecifier.text}'`);
        }
      }
    }
  }

  // An entry barrel must name only api files that exist.
  for (const [target, barrels] of reexportedBy) {
    if (!existsSync(path.join(root, target))) {
      const barrel = barrels[0] ?? '';
      const source = sources.get(barrel);
      if (source) push(source, barrel, firstSite.get(target), `${target} does not exist`);
    }
  }
}

function isEmptyExport(statement: ts.Statement | undefined): boolean {
  return (
    statement !== undefined &&
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier === undefined &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause) &&
    statement.exportClause.elements.length === 0
  );
}
