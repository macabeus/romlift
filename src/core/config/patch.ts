// The only TOML patcher (architecture §6.5, D9, D23): applies proposals to a romlift.toml as line-level edits of
// its single-line [functions] and [symbols] entries, so every comment and every hand-written line it does not
// change survives byte for byte, then re-parses the result and compares it with the config it meant to write.
//
//   - An entry the proposals change is rewritten in place when it is one `0x… = value` line under [functions]
//     ([symbols]): the key and value are replaced, the indentation and a trailing comment kept.
//   - A new entry is inserted after the listed entry with the next lower address, or right after the table's
//     header, with the indentation of its neighbour.
//   - A new [[modules]] block (a module proposal at a start no module has: a border of a runs_at range, analyze
//     --update, §6.7) is inserted in its canonical lines before the block of the next module (above the comment
//     lines right over its header), or after the last module's block, with one blank line on each side.
//   - Anything else is refused with E_TOML_PATCH_REFUSED and the canonical text to paste, never guessed: an entry
//     restructured by hand (a `[functions.0x…]` table, dotted keys, a value over several lines), a missing table,
//     a module proposal that changes, moves or drops a listed module, an override proposal ([[modules]] and
//     [[overrides]] are blocks, not lines), and a result that does not re-parse to the intended config (for example
//     when `config` is not what `text` says).
//
// The intended config is applyProposals(config, proposals): a function or symbol proposal sets the fields it
// carries over the listed entry (name, mode, size, label, type), keeps its aliases, and records its source in
// `from` when that source is persisted (sourceKey; the analysis and module inference are not, and leave `from` as
// it was). A proposal never removes `label = true`: the startup code inside the cartridge entry's extent must
// keep it (D64 a, phase-3 known limitation). Pure; never throws.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { defaultFunctionName } from '../../foundation/util/project-files.ts';
import { compareNumbers, sortedEntries, sortedKeys } from '../../foundation/util/sorted.ts';
import { sourceKey } from '../proposals/types.ts';
import type { Proposal } from '../proposals/types.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';
import { addressDefinitions, addressKey, addressKeyUses, outlineToml } from './keys.ts';
import type { AddressDefinition, AddressKeyUse, AddressTable, TomlKeyValue, TomlOutline } from './keys.ts';
import { parseConfig } from './parse.ts';
import type { FunctionConfig, ModuleConfig, OverrideConfig, RomliftConfig, SymbolConfig } from './schema.ts';
import { functionLine, moduleLines, overrideLines, serializeConfig, symbolLine } from './serialize.ts';

export type ConfigPatchResult =
  | { readonly ok: true; readonly text: string; readonly diagnostics: readonly Diagnostic<ConfigCode>[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ConfigCode>[] };

function proposedFunction(existing: FunctionConfig | undefined, p: Extract<Proposal, { kind: 'function' }>): FunctionConfig {
  const size = p.size ?? existing?.size;
  const label = p.label === true || existing?.label === true;
  const from = sourceKey(p.source) ?? existing?.from;
  return {
    name: p.name ?? existing?.name ?? defaultFunctionName(p.addr),
    mode: p.mode,
    ...(size === undefined ? {} : { size }),
    ...(label ? { label: true } : {}),
    aliases: existing?.aliases ?? [],
    ...(from === undefined ? {} : { from }),
  };
}

function proposedSymbol(existing: SymbolConfig | undefined, p: Extract<Proposal, { kind: 'symbol' }>): SymbolConfig {
  const size = p.size ?? existing?.size;
  const type = p.type ?? existing?.type;
  const from = sourceKey(p.source) ?? existing?.from;
  return {
    name: p.name,
    ...(size === undefined ? {} : { size }),
    ...(type === undefined ? {} : { type }),
    aliases: existing?.aliases ?? [],
    ...(from === undefined ? {} : { from }),
  };
}

function proposedModule(existing: ModuleConfig | undefined, p: Extract<Proposal, { kind: 'module' }>): ModuleConfig {
  const kept: Partial<ModuleConfig> = existing ?? {};
  return {
    name: p.name,
    start: p.start,
    kind: p.moduleKind,
    generated: kept.generated ?? true,
    ...(p.library === undefined ? {} : { library: p.library.name, version: p.library.version }),
    ...(kept.compiler === undefined ? {} : { compiler: kept.compiler }),
    ...(kept.cflags === undefined ? {} : { cflags: kept.cflags }),
  };
}

function proposedOverride(p: Extract<Proposal, { kind: 'override' }>): OverrideConfig {
  const from = sourceKey(p.source);
  return {
    start: p.span.start,
    size: p.span.end - p.span.start,
    kind: p.overrideKind,
    ...(p.mode === undefined ? {} : { mode: p.mode }),
    ...(p.runsAt === undefined ? {} : { runsAt: p.runsAt }),
    ...(from === undefined ? {} : { from }),
  };
}

/**
 * The config the proposals mean, in order (a later proposal for the same address wins). A module proposal
 * replaces the module that starts at its address (keeping `generated`, `compiler` and `cflags`) or is inserted in
 * start order; an override proposal replaces the override with its span or is inserted in start order.
 */
export function applyProposals(config: RomliftConfig, proposals: readonly Proposal[]): RomliftConfig {
  const functions = new Map(config.functions);
  const symbols = new Map(config.symbols);
  let modules = [...config.modules];
  let overrides = [...config.overrides];
  for (const p of proposals) {
    switch (p.kind) {
      case 'function':
        functions.set(p.addr, proposedFunction(functions.get(p.addr), p));
        break;
      case 'symbol':
        symbols.set(p.addr, proposedSymbol(symbols.get(p.addr), p));
        break;
      case 'module': {
        const at = modules.findIndex((m) => m.start === p.start);
        const module = proposedModule(modules[at], p);
        if (at >= 0) modules[at] = module;
        else modules = [...modules.filter((m) => m.start < p.start), module, ...modules.filter((m) => m.start > p.start)];
        break;
      }
      case 'override': {
        const override = proposedOverride(p);
        const at = overrides.findIndex((o) => o.start === override.start && o.size === override.size);
        if (at >= 0) overrides[at] = override;
        else overrides = [...overrides.filter((o) => o.start <= override.start), override, ...overrides.filter((o) => o.start > override.start)];
        break;
      }
    }
  }
  return {
    ...config,
    modules,
    functions: new Map(sortedEntries(functions)),
    symbols: new Map(sortedEntries(symbols)),
    overrides,
  };
}

// ---------------------------------------------------------------------------------------------------
// Line edits.

/** One text edit: replace [start, end) with `text`. */
interface LineEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** An entry whose canonical line changed: its table, its address and the line to write. */
interface ChangedEntry {
  readonly table: AddressTable;
  readonly addr: Addr;
  readonly line: string;
}

export type LineEditResult =
  | { readonly ok: true; readonly text: string; readonly intended: RomliftConfig; readonly changed: number }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ConfigCode>[] };

function refused(message: string, addr?: Addr): Diagnostic<ConfigCode> {
  return diagnostic(ConfigCodes, 'E_TOML_PATCH_REFUSED', message, addr === undefined ? {} : { addr });
}

function changedEntries<V>(table: AddressTable, before: ReadonlyMap<Addr, V>, after: ReadonlyMap<Addr, V>, line: (addr: Addr, v: V) => string): ChangedEntry[] {
  const out: ChangedEntry[] = [];
  for (const addr of sortedKeys(after)) {
    const now = after.get(addr);
    if (now === undefined) continue;
    const was = before.get(addr);
    const text = line(addr, now);
    if (was === undefined || line(addr, was) !== text) out.push({ table, addr, line: text });
  }
  return out;
}

/** The statements of a table's own lines: `0x… = value` directly under `[<table>]`. */
function ownLines(uses: readonly AddressKeyUse[], table: AddressTable): { readonly addr: Addr; readonly statement: TomlKeyValue }[] {
  const out: { addr: Addr; statement: TomlKeyValue }[] = [];
  for (const use of uses) {
    const s = use.statement;
    if (use.table !== table || use.shape !== 'line' || use.addr === undefined || s === undefined) continue;
    if (s.table.length === 1 && s.table[0] === table && s.key.length === 1) out.push({ addr: use.addr, statement: s });
  }
  return out;
}

function eolAt(text: string, offset: number): string {
  return text.startsWith('\r\n', offset) ? '\r\n' : '\n';
}

function indentOf(text: string, statement: TomlKeyValue): string {
  return text.slice(statement.lineStart, statement.start);
}

/** The edits of one table's changed entries, or the refusals of those it cannot edit line by line. */
function tableEdits(
  text: string,
  outline: TomlOutline,
  uses: readonly AddressKeyUse[],
  table: AddressTable,
  changes: readonly ChangedEntry[],
): { readonly edits: LineEdit[]; readonly refusals: Diagnostic<ConfigCode>[] } {
  const edits: LineEdit[] = [];
  const refusals: Diagnostic<ConfigCode>[] = [];
  if (changes.length === 0) return { edits, refusals };
  const own = ownLines(uses, table);
  const ownByAddr = new Map(own.map((o) => [o.addr, o] as const));
  const ownSorted = [...own].sort((a, b) => compareNumbers(a.addr, b.addr));
  const header = outline.headers.find((h) => !h.array && h.path.length === 1 && h.path[0] === table);
  const definitions = new Map<Addr, AddressDefinition[]>();
  for (const d of addressDefinitions(uses)) {
    if (d.table !== table) continue;
    const list = definitions.get(d.addr);
    if (list === undefined) definitions.set(d.addr, [d]);
    else list.push(d);
  }
  const inserts = new Map<number, { readonly indent: string; readonly lines: string[] }>();
  for (const change of changes) {
    const key = addressKey(change.addr);
    const places = definitions.get(change.addr) ?? [];
    if (places.length > 0) {
      const line = ownByAddr.get(change.addr);
      const only = places.length === 1 && line !== undefined && line.statement.endLine === line.statement.line;
      if (!only || line === undefined) {
        const lines = places.map((p) => p.line);
        const where = `${lines.length === 1 ? 'line' : 'lines'} ${lines.join(', ')}`;
        refusals.push(
          refused(
            `${key} in [${table}] is not one single-line entry (${where}): it was restructured by hand, so the planner does not edit it; replace it with this line under [${table}]: ${change.line}`,
            change.addr,
          ),
        );
        continue;
      }
      edits.push({ start: line.statement.start, end: line.statement.valueEnd, text: change.line });
      continue;
    }
    if (header === undefined) {
      refusals.push(refused(`romlift.toml has no [${table}] table to add ${key} to; add the table with this line: ${change.line}`, change.addr));
      continue;
    }
    const before = ownSorted[lowerBound(ownSorted, change.addr, (o) => o.addr) - 1];
    const at = before === undefined ? header.lineEnd : before.statement.lineEnd;
    const indent = before === undefined ? (own[0] === undefined ? '' : indentOf(text, own[0].statement)) : indentOf(text, before.statement);
    const slot = inserts.get(at);
    if (slot === undefined) inserts.set(at, { indent, lines: [change.line] });
    else slot.lines.push(change.line);
  }
  for (const at of sortedKeys(inserts)) {
    const slot = inserts.get(at);
    if (slot === undefined) continue;
    const eol = eolAt(text, at);
    edits.push({ start: at, end: at, text: slot.lines.map((l) => `${eol}${slot.indent}${l}`).join('') });
  }
  return { edits, refusals };
}

/** The text with every edit applied; the edits do not overlap. */
function applyEdits(text: string, edits: readonly LineEdit[]): string {
  const pieces: string[] = [];
  let at = 0;
  for (const edit of [...edits].sort((a, b) => compareNumbers(a.start, b.start))) {
    pieces.push(text.slice(at, edit.start), edit.text);
    at = edit.end;
  }
  pieces.push(text.slice(at));
  return pieces.join('');
}

/** The canonical text of one module block. */
function moduleText(m: ModuleConfig): string {
  return moduleLines(m).join('\n');
}

/** The line ending of the line before offset `at` (a line start), or the text's own at its end. */
function eolBefore(text: string, at: number): string {
  if (at < text.length) return text.startsWith('\r\n', at - 2) ? '\r\n' : '\n';
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The start of the comment lines right above the line starting at `at` (they belong to its block), else `at`. */
function leadingCommentStart(text: string, at: number): number {
  let start = at;
  while (start > 0) {
    const prev = text.lastIndexOf('\n', start - 2) + 1;
    if (!text.slice(prev, start).trimStart().startsWith('#')) break;
    start = prev;
  }
  return start;
}

/** The offset of the first character of 1-based line `line` of `text`. */
function lineOffset(text: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', at);
    if (next < 0) return text.length;
    at = next + 1;
  }
  return at;
}

/**
 * The insertions of the new [[modules]] blocks: every module of `intended` whose start no module of `config` has, the
 * modules of `config` kept as they are and in their order. Undefined when the change is anything else (a listed module
 * changed, moved or dropped) or the text's [[modules]] headers are not one per module of `config`: blockRefusals then
 * refuses it.
 */
function moduleInsertions(text: string, outline: TomlOutline, config: RomliftConfig, intended: RomliftConfig): LineEdit[] | undefined {
  const listed = new Set(config.modules.map((m) => m.start));
  const kept = intended.modules.filter((m) => listed.has(m.start));
  const same = (m: ModuleConfig, i: number): boolean => {
    const listedModule = config.modules[i];
    return listedModule !== undefined && moduleText(m) === moduleText(listedModule);
  };
  if (kept.length !== config.modules.length || !kept.every(same)) return undefined;
  const headers = outline.headers.filter((h) => h.array && h.path.length === 1 && h.path[0] === 'modules');
  const last = headers[headers.length - 1];
  if (last === undefined || headers.length !== config.modules.length) return undefined;
  const afterLast = outline.headers.find((h) => h.line > last.line);
  const blocks = new Map<number, string[]>();
  for (const m of intended.modules) {
    if (listed.has(m.start)) continue;
    const next = config.modules.findIndex((c) => c.start > m.start);
    const header = next < 0 ? afterLast : headers[next];
    const at = header === undefined ? text.length : leadingCommentStart(text, lineOffset(text, header.line));
    const slot = blocks.get(at);
    if (slot === undefined) blocks.set(at, [moduleText(m)]);
    else slot.push(moduleText(m));
  }
  const edits: LineEdit[] = [];
  for (const at of sortedKeys(blocks)) {
    const eol = eolBefore(text, at);
    const body = (blocks.get(at) ?? []).map((b) => b.split('\n').join(eol)).join(`${eol}${eol}`);
    if (at < text.length) edits.push({ start: at, end: at, text: `${body}${eol}${eol}` });
    else edits.push({ start: at, end: at, text: `${text.endsWith('\n') ? '' : eol}${eol}${body}${eol}` });
  }
  return edits;
}

function blockRefusals(config: RomliftConfig, intended: RomliftConfig, moduleEdits: readonly LineEdit[] | undefined): Diagnostic<ConfigCode>[] {
  const out: Diagnostic<ConfigCode>[] = [];
  const modules = (c: RomliftConfig): string => c.modules.map(moduleText).join('\n\n');
  const overrides = (c: RomliftConfig): string => c.overrides.map((o) => overrideLines(o).join('\n')).join('\n\n');
  if (moduleEdits === undefined && modules(intended) !== modules(config)) {
    out.push(refused(`[[modules]] are blocks, which the planner edits only to insert a new module; make the [[modules]] read, in link order:\n${modules(intended)}`));
  }
  if (overrides(intended) !== overrides(config)) {
    out.push(refused(`[[overrides]] are blocks, which the planner does not edit; make the [[overrides]] read:\n${overrides(intended)}`));
  }
  return out;
}

/**
 * The line edits alone: the text with the changed entries rewritten or inserted, and the config it is meant to
 * parse to, without the re-parse comparison of planPatch (exported for the patch-planner mutation test).
 */
export function planLineEdits(text: string, config: RomliftConfig, proposals: readonly Proposal[]): LineEditResult {
  const intended = applyProposals(config, proposals);
  const outline = outlineToml(text);
  const modules = moduleInsertions(text, outline, config, intended);
  const refusals = blockRefusals(config, intended, modules);
  const uses = addressKeyUses(outline);
  const functions = tableEdits(text, outline, uses, 'functions', changedEntries('functions', config.functions, intended.functions, functionLine));
  const symbols = tableEdits(text, outline, uses, 'symbols', changedEntries('symbols', config.symbols, intended.symbols, symbolLine));
  refusals.push(...functions.refusals, ...symbols.refusals);
  if (refusals.length > 0) return { ok: false, diagnostics: refusals };
  const edits = [...(modules ?? []), ...functions.edits, ...symbols.edits];
  return { ok: true, text: applyEdits(text, edits), intended, changed: edits.length };
}

function firstDifference(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) return `the patched file reads ${JSON.stringify(x[i] ?? '(nothing)')} where the intended config reads ${JSON.stringify(y[i] ?? '(nothing)')}`;
  }
  return 'no canonical line differs';
}

/** The entries to paste when a patched text does not mean the intended config: every changed line. */
function pasteText(config: RomliftConfig, intended: RomliftConfig): string {
  const lines = [
    ...changedEntries('functions', config.functions, intended.functions, functionLine).map((c) => `[functions] ${c.line}`),
    ...changedEntries('symbols', config.symbols, intended.symbols, symbolLine).map((c) => `[symbols] ${c.line}`),
  ];
  return lines.length === 0 ? '' : `; paste these entries by hand:\n${lines.join('\n')}`;
}

/**
 * Re-parses a patched text and compares it with the intended config: undefined when they agree, else the
 * E_TOML_PATCH_REFUSED that says where they part.
 */
export function verifyPatched(patched: string, config: RomliftConfig, intended: RomliftConfig): Diagnostic<ConfigCode> | undefined {
  const reparsed = parseConfig(patched);
  if (!reparsed.ok) {
    const codes = reparsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ');
    return refused(`the patched text does not parse (${codes})${pasteText(config, intended)}`);
  }
  const got = serializeConfig(reparsed.value);
  const want = serializeConfig(intended);
  if (got === want) return undefined;
  return refused(`the patched text does not mean the intended config: ${firstDifference(got, want)}${pasteText(config, intended)}`);
}

/**
 * Applies `proposals` to `text`, the romlift.toml that `config` was parsed from, as line edits that keep every
 * comment; the result re-parses to applyProposals(config, proposals) or the patch is refused. An empty change
 * returns `text` itself.
 */
export function planPatch(text: string, config: RomliftConfig, proposals: readonly Proposal[]): ConfigPatchResult {
  const planned = planLineEdits(text, config, proposals);
  if (!planned.ok) return planned;
  const mismatch = verifyPatched(planned.text, config, planned.intended);
  if (mismatch !== undefined) return { ok: false, diagnostics: [mismatch] };
  return { ok: true, text: planned.text, diagnostics: [] };
}
