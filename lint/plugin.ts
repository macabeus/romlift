// romlift's own ESLint rules (D5, D117): the checks no built-in or typescript-eslint rule makes.
//
// - romlift/globals: in foundation and core, every identifier that resolves to a global is on GLOBALS_ALLOWLIST
//   (an allowlist, so `crypto`, `Intl`, timers and `globalThis` fail too, not only the globals someone thought of).
// - romlift/map-iteration: Map and Set iteration goes through sortedKeys/sortedEntries of foundation/util/sorted.ts,
//   so output order never depends on the order entries were inserted in.
// - romlift/barrel: the entry barrels hold only `export * from './api/<name>.ts';`, each api file holds only
//   re-exports and is re-exported by exactly one barrel, and an api file of a browser-safe barrel reaches no shell
//   file and no `node:*` module.
// - romlift/dynamic-import: a dynamic import names its module with a string literal, which boundaries checks as an
//   edge; only the files that load the read-only PoC (DYNAMIC_IMPORT_ALLOWLIST) may compute one.
//
// The type-aware rules read the TypeScript program typescript-eslint builds (parserServices).
import { ESLintUtils, type TSESTree } from '@typescript-eslint/utils';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/macabeus/romlift/blob/main/lint/plugin.ts#${name}`,
);

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

/** Non-literal dynamic imports are allowed only here: these files load the read-only PoC. */
export const DYNAMIC_IMPORT_ALLOWLIST: readonly string[] = ['bench/tools/export-poc-child.ts', 'test/local/'];

const MAP_SET_TYPES: ReadonlySet<string> = new Set(['Map', 'Set', 'ReadonlyMap', 'ReadonlySet']);
const ITERATING_MEMBERS: ReadonlySet<string> = new Set(['forEach', 'keys', 'values', 'entries']);
const SORTED_HELPERS: ReadonlySet<string> = new Set(['sortedKeys', 'sortedEntries']);
const SORTED_MODULE = 'src/foundation/util/sorted.ts';
const ENTRY_BARRELS: readonly string[] = ['src/index.ts', 'src/node.ts', 'src/isa.ts', 'src/internal.ts'];
/** Entry points that must stay browser-safe: their api files never reach the shell or `node:*`. */
const PURE_BARRELS: ReadonlySet<string> = new Set(['src/index.ts', 'src/isa.ts']);

/** The repository-relative path of a file, with `/` separators. */
function relative(cwd: string, file: string): string {
  return path.relative(cwd, file).split(path.sep).join('/');
}

function isAmbientLibraryFile(program: ts.Program, file: ts.SourceFile): boolean {
  return (
    file.isDeclarationFile && (program.isSourceFileDefaultLibrary(file) || file.fileName.includes('/node_modules/'))
  );
}

function isGlobalSymbol(program: ts.Program, symbol: ts.Symbol): boolean {
  if (symbol.flags & ts.SymbolFlags.Alias) return false;
  const declarations = symbol.declarations ?? [];
  if (declarations.length === 0) return symbol.name === 'globalThis';
  return declarations.every((declaration) => isAmbientLibraryFile(program, declaration.getSourceFile()));
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

/** True inside `typeof X` in a type: a type position, although the compiler resolves X as a value. */
function isInTypeQuery(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (ts.isQualifiedName(current.parent) || ts.isPropertyAccessExpression(current.parent)) current = current.parent;
  return ts.isTypeQueryNode(current.parent);
}

/** The location ESLint reports for a TypeScript node. */
function locOf(source: ts.SourceFile, node: ts.Node): TSESTree.SourceLocation {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    start: { line: start.line + 1, column: start.character },
    end: { line: end.line + 1, column: end.character },
  };
}

export const globals = createRule({
  name: 'globals',
  meta: {
    type: 'problem',
    docs: { description: 'foundation and core reference only the globals of the allowlist (architecture §2)' },
    messages: {
      global: "global '{{name}}' is not on the foundation/core allowlist (lint/plugin.ts GLOBALS_ALLOWLIST)",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const program = services.program;
    const checker = program.getTypeChecker();
    return {
      Program() {
        const source = program.getSourceFile(context.filename);
        if (source === undefined) return;
        const visit = (node: ts.Node): void => {
          if (ts.isIdentifier(node)) check(node);
          ts.forEachChild(node, visit);
        };
        const check = (node: ts.Identifier): void => {
          if (ts.isPartOfTypeNode(node) || isInTypeQuery(node) || isNonReferenceName(node)) return;
          if (GLOBALS_ALLOWLIST.has(node.text)) return;
          const symbol =
            ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
              ? checker.getShorthandAssignmentValueSymbol(node.parent)
              : checker.getSymbolAtLocation(node);
          if (!symbol || !isGlobalSymbol(program, symbol)) return;
          // Only value references count; a name that is a type alone cannot be read at run time.
          if (!(symbol.flags & ts.SymbolFlags.Value) && symbol.name !== 'globalThis') return;
          context.report({ loc: locOf(source, node), messageId: 'global', data: { name: node.text } });
        };
        visit(source);
      },
    };
  },
});

export const mapIteration = createRule({
  name: 'map-iteration',
  meta: {
    type: 'problem',
    docs: { description: 'Map and Set iteration goes through sortedKeys/sortedEntries (architecture §2)' },
    messages: { iteration: '{{what}} iterates a Map or Set; go through sortedKeys/sortedEntries' },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const program = services.program;
    const checker = program.getTypeChecker();
    const cwd = context.cwd;

    const isMapOrSet = (type: ts.Type, depth = 0): boolean => {
      if (depth > 8) return false;
      if (type.isUnionOrIntersection()) return type.types.some((member) => isMapOrSet(member, depth + 1));
      const apparent = type.isTypeParameter() ? (checker.getBaseConstraintOfType(type) ?? type) : type;
      if (apparent !== type) return isMapOrSet(apparent, depth + 1);
      const symbol = type.getSymbol() ?? type.aliasSymbol;
      if (symbol && MAP_SET_TYPES.has(symbol.name) && isGlobalSymbol(program, symbol)) return true;
      if (type.isClassOrInterface()) return checker.getBaseTypes(type).some((base) => isMapOrSet(base, depth + 1));
      return false;
    };
    const iterates = (expression: ts.Expression): boolean => isMapOrSet(checker.getTypeAtLocation(expression));

    /** True when `node` is passed directly to `sortedKeys`/`sortedEntries` of foundation/util/sorted.ts. */
    const isSortedHelperArgument = (node: ts.Node): boolean => {
      const call = node.parent;
      if (!call || !ts.isCallExpression(call) || !call.arguments.some((argument) => argument === node)) return false;
      const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
      let symbol = checker.getSymbolAtLocation(callee);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (!symbol || !SORTED_HELPERS.has(symbol.name)) return false;
      return (symbol.declarations ?? []).some(
        (declaration) => relative(cwd, declaration.getSourceFile().fileName) === SORTED_MODULE,
      );
    };
    const isGlobal = (expression: ts.Expression, name: string): boolean => {
      if (!ts.isIdentifier(expression) || expression.text !== name) return false;
      const symbol = checker.getSymbolAtLocation(expression);
      return symbol !== undefined && isGlobalSymbol(program, symbol);
    };
    const memberName = (node: ts.Node): string | undefined => {
      if (ts.isPropertyAccessExpression(node)) return node.name.text;
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
        return node.argumentExpression.text;
      return undefined;
    };

    return {
      Program() {
        const source = program.getSourceFile(context.filename);
        if (source === undefined) return;
        const report = (node: ts.Node, what: string): void => {
          if (isSortedHelperArgument(node)) return;
          context.report({ loc: locOf(source, node), messageId: 'iteration', data: { what } });
        };
        const visit = (node: ts.Node): void => {
          if (ts.isForOfStatement(node) && iterates(node.expression)) report(node, 'for...of');
          if (ts.isSpreadElement(node) && iterates(node.expression)) report(node.parent, 'a spread');
          if (ts.isCallExpression(node) && memberName(node.expression) === 'from') {
            const access = node.expression;
            const first = node.arguments[0];
            if (
              (ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) &&
              first &&
              isGlobal(access.expression, 'Array') &&
              iterates(first)
            ) {
              report(node, 'Array.from');
            }
          }
          const member = memberName(node);
          if (
            member !== undefined &&
            ITERATING_MEMBERS.has(member) &&
            (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
          ) {
            if (iterates(node.expression))
              report(
                ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : node,
                `.${member}`,
              );
          }
          if (
            ts.isVariableDeclaration(node) &&
            ts.isArrayBindingPattern(node.name) &&
            node.initializer &&
            iterates(node.initializer)
          ) {
            report(node, 'array destructuring');
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      },
    };
  },
});

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

/** The api files an entry barrel re-exports, `src/api/<name>.ts`, in its order; undefined when it is not one. */
function barrelTargets(source: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const text = statement.moduleSpecifier.text;
      if (/^\.\/api\/[a-z0-9-]+\.ts$/.test(text)) out.push(`src/api/${text.slice('./api/'.length)}`);
    }
  }
  return out;
}

export const barrel = createRule({
  name: 'barrel',
  meta: {
    type: 'problem',
    docs: { description: 'entry barrels and api files have the shape architecture §2 gives them' },
    messages: {
      barrelLine: "an entry barrel holds only `export * from './api/<name>.ts';` lines, or `export {};`",
      twice: '{{target}} is already re-exported by {{barrel}}',
      missing: '{{target}} does not exist',
      apiLine: 'an api file holds only re-export statements, or `export {};`',
      orphan: '{{file}} is re-exported by no entry barrel',
      impure: "{{file}} is re-exported by a browser-safe entry point and may not reach '{{specifier}}'",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const program = services.program;
    const cwd = context.cwd;
    const file = relative(cwd, context.filename);
    const sourceOf = (repoFile: string): ts.SourceFile | undefined => program.getSourceFile(path.join(cwd, repoFile));

    /** Which barrels re-export each api file, in ENTRY_BARRELS order. */
    const reexporters = (): Map<string, string[]> => {
      const by = new Map<string, string[]>();
      for (const name of ENTRY_BARRELS) {
        const source = sourceOf(name);
        if (source === undefined) continue;
        for (const target of barrelTargets(source)) by.set(target, [...(by.get(target) ?? []), name]);
      }
      return by;
    };

    return {
      Program() {
        const source = program.getSourceFile(context.filename);
        if (source === undefined) return;
        if (ENTRY_BARRELS.includes(file)) {
          if (source.statements.length === 1 && isEmptyExport(source.statements[0])) return;
          const earlier = new Map<string, string>();
          for (const name of ENTRY_BARRELS) {
            if (name === file) break;
            const other = sourceOf(name);
            if (other !== undefined)
              for (const target of barrelTargets(other)) if (!earlier.has(target)) earlier.set(target, name);
          }
          for (const statement of source.statements) {
            const ok =
              ts.isExportDeclaration(statement) &&
              !statement.isTypeOnly &&
              statement.exportClause === undefined &&
              statement.moduleSpecifier !== undefined &&
              ts.isStringLiteral(statement.moduleSpecifier) &&
              /^\.\/api\/[a-z0-9-]+\.ts$/.test(statement.moduleSpecifier.text);
            if (!ok) {
              context.report({ loc: locOf(source, statement), messageId: 'barrelLine' });
              continue;
            }
            const target = `src/api/${(statement.moduleSpecifier as ts.StringLiteral).text.slice('./api/'.length)}`;
            const first = earlier.get(target);
            if (first !== undefined)
              context.report({ loc: locOf(source, statement), messageId: 'twice', data: { target, barrel: first } });
            else earlier.set(target, file);
            if (!existsSync(path.join(cwd, target)))
              context.report({ loc: locOf(source, statement), messageId: 'missing', data: { target } });
          }
          return;
        }
        if (!/^src\/api\/[^/]+\.ts$/.test(file)) return;
        for (const statement of source.statements) {
          const ok =
            ts.isExportDeclaration(statement) &&
            ((statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) ||
              isEmptyExport(statement));
          if (!ok) context.report({ loc: locOf(source, statement), messageId: 'apiLine' });
        }
        const barrels = reexporters().get(file) ?? [];
        if (barrels.length === 0) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'orphan', data: { file } });
          return;
        }
        if (!barrels.some((name) => PURE_BARRELS.has(name))) return;
        for (const statement of source.statements) {
          if (
            !ts.isExportDeclaration(statement) ||
            !statement.moduleSpecifier ||
            !ts.isStringLiteral(statement.moduleSpecifier)
          )
            continue;
          const specifier = statement.moduleSpecifier.text;
          const target = specifier.startsWith('.')
            ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
            : specifier;
          if (target.startsWith('src/shell/') || target.startsWith('node:')) {
            context.report({ loc: locOf(source, statement), messageId: 'impure', data: { file, specifier } });
          }
        }
      },
    };
  },
});

export const dynamicImport = createRule({
  name: 'dynamic-import',
  meta: {
    type: 'problem',
    docs: { description: 'a dynamic import names its module with a string literal, which the edge rules check' },
    messages: {
      computed: 'dynamic import with a specifier that is not a string literal, which no edge rule can check',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const file = relative(context.cwd, context.filename);
    if (DYNAMIC_IMPORT_ALLOWLIST.some((prefix) => (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix)))
      return {};
    return {
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') return;
        context.report({ node, messageId: 'computed' });
      },
    };
  },
});

const plugin = {
  meta: { name: 'romlift' },
  rules: { globals, 'map-iteration': mapIteration, barrel, 'dynamic-import': dynamicImport },
};

export default plugin;
