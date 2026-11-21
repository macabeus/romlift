// romlift.toml (schema 1) to the in-memory config (architecture §3.4, §6.5, D22): the address-key checks of keys.ts,
// then smol-toml, then the TOML spelling to the in-memory shape (snake_case `runs_at` is `runsAt`, `data_start`
// `dataStart`; a function or
// symbol written as a bare string is its name; `mode` defaults to thumb, `aliases` to none, `generated` to true),
// then the zod schema (schema.ts). Codes: E_TOML_KEY_SPELLING and E_DUPLICATE_ADDRESS (keys.ts), E_TOML_PARSE
// (smol-toml refused the text), E_TOML_SCHEMA (TOML, but not schema 1), E_UNKNOWN_COMPILER (`[build] compiler` or a
// module's `compiler` names no build compiler), each with its line where the outline knows it. A `[functions.0x…]` table restructured by hand is valid TOML and parses to the same entry. Whether module
// starts are legal borders is the model's question (E_MODULE_BORDER), not the parser's. Pure; never throws.
import { TomlError, parse } from 'smol-toml';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { compareNumbers, sortedKeys } from '../../foundation/util/sorted.ts';
import { ConfigCodes } from './codes.ts';
import type { ConfigCode } from './codes.ts';
import {
  addressKey,
  addressKeyUses,
  checkAddressKeys,
  duplicateDefinitions,
  isAddressKey,
  misalignedFunctionKeys,
  outlineToml,
} from './keys.ts';
import type { TomlOutline } from './keys.ts';
import { type ConfigIssue, validateConfig } from './schema.ts';
import type { RomliftConfig } from './schema.ts';

export type ConfigParseResult =
  | { readonly ok: true; readonly value: RomliftConfig; readonly diagnostics: readonly Diagnostic<ConfigCode>[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic<ConfigCode>[] };

type Segment = string | number;
type Table = Readonly<Record<string, unknown>>;

/** TOML key -> in-memory key, per kind of table; a key not listed is E_TOML_SCHEMA. */
const KEYS = {
  root: {
    schema: 'schema',
    rom: 'rom',
    build: 'build',
    signatures: 'signatures',
    modules: 'modules',
    functions: 'functions',
    entry_points: 'entryPoints',
    symbols: 'symbols',
    overrides: 'overrides',
  },
  rom: { path: 'path', sha1: 'sha1' },
  build: { name: 'name', compiler: 'compiler' },
  signatures: { enabled: 'enabled', libraries: 'libraries' },
  module: {
    name: 'name',
    start: 'start',
    kind: 'kind',
    data_start: 'dataStart',
    generated: 'generated',
    source: 'source',
    library: 'library',
    version: 'version',
    compiler: 'compiler',
    cflags: 'cflags',
  },
  function: { name: 'name', mode: 'mode', size: 'size', aliases: 'aliases', from: 'from' },
  entryPoint: { name: 'name', mode: 'mode', size: 'size', aliases: 'aliases', from: 'from' },
  symbol: { name: 'name', size: 'size', type: 'type', aliases: 'aliases', from: 'from' },
  override: { start: 'start', size: 'size', kind: 'kind', mode: 'mode', runs_at: 'runsAt', from: 'from' },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

/** In-memory key -> TOML key, for messages (`runsAt` is written `runs_at`, `dataStart` `data_start`). */
const TOML_SPELLING: Readonly<Record<string, string>> = {
  runsAt: 'runs_at',
  dataStart: 'data_start',
  entryPoints: 'entry_points',
};

function isTable(value: unknown): value is Table {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The 1-based line of the deepest header or key whose path is a prefix of `path`, or undefined. */
export function lineOfPath(outline: TomlOutline, path: readonly Segment[]): number | undefined {
  let best: { readonly length: number; readonly line: number } | undefined;
  const consider = (candidate: readonly Segment[], line: number): void => {
    if (candidate.length > path.length || (best !== undefined && candidate.length <= best.length)) return;
    if (candidate.every((segment, i) => String(segment) === String(path[i]))) best = { length: candidate.length, line };
  };
  for (const h of outline.headers) consider(h.array ? [...h.path, h.index] : h.path, h.line);
  for (const k of outline.keys) consider([...k.table, ...(k.tableIndex >= 0 ? [k.tableIndex] : []), ...k.key], k.line);
  return best?.line;
}

function pathText(path: readonly Segment[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

/** The schema diagnostics of one parse, with the outline that gives them their lines. */
interface Collector {
  readonly outline: TomlOutline;
  readonly diagnostics: Diagnostic<ConfigCode>[];
  /** The paths already reported, so zod does not report a value the conversion refused a second time. */
  readonly reported: Set<string>;
}

function schemaIssue(out: Collector, path: readonly Segment[], message: string, code?: ConfigIssue['code']): void {
  if (out.reported.has(pathText(path))) return;
  out.reported.add(pathText(path));
  const line = lineOfPath(out.outline, path);
  const where = path.length === 0 ? '' : `${pathText(path)}: `;
  out.diagnostics.push(
    diagnostic(ConfigCodes, code ?? 'E_TOML_SCHEMA', `${line === undefined ? '' : `line ${line}: `}${where}${message}`),
  );
}

/** The members of `table` renamed to their in-memory keys; every other key is reported. */
function pick(
  table: Table,
  keys: Readonly<Record<string, string>>,
  path: readonly Segment[],
  out: Collector,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(table)) {
    const target = keys[key];
    if (target === undefined)
      schemaIssue(out, [...path, key], `unknown key \`${key}\` (schema 1 has ${Object.keys(keys).join(', ')})`);
    else picked[target] = table[key];
  }
  return picked;
}

/** A table member that must itself be a table (or absent: undefined). */
function subTable(parent: Table, key: string, path: readonly Segment[], out: Collector): Table | undefined {
  const value = parent[key];
  if (value === undefined) return undefined;
  if (isTable(value)) return value;
  schemaIssue(out, [...path, key], `must be a table`);
  return undefined;
}

function entryOf(
  value: unknown,
  keys: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, unknown>>,
  path: readonly Segment[],
  out: Collector,
): unknown {
  if (typeof value === 'string') return { ...defaults, name: value };
  if (isTable(value)) return { ...defaults, ...pick(value, keys, path, out) };
  schemaIssue(out, path, 'must be a name string or a table');
  return undefined;
}

/** [functions], [entry_points] or [symbols]: a Map in address order (the keys were checked by keys.ts). */
function addressMap(
  root: Table,
  name: 'functions' | 'entry_points' | 'symbols',
  keys: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, unknown>>,
  out: Collector,
): Map<Addr, unknown> {
  const table = subTable(root, name, [], out) ?? {};
  const entries: [Addr, unknown][] = [];
  for (const key of Object.keys(table)) {
    if (!isAddressKey(key)) {
      schemaIssue(out, [name, key], 'not an address key');
      continue;
    }
    const addr = Number.parseInt(key.slice(2), 16);
    entries.push([addr, entryOf(table[key], keys, defaults, [name, key], out)]);
  }
  return new Map(entries.sort((a, b) => compareNumbers(a[0], b[0])));
}

/** [[modules]] or [[overrides]]: an array of tables (absent: empty). */
function tableArray(
  root: Table,
  name: 'modules' | 'overrides',
  keys: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, unknown>>,
  out: Collector,
): unknown[] {
  const value = root[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    schemaIssue(out, [name], `must be an array of tables ([[${name}]])`);
    return [];
  }
  return value.map((item: unknown, i) => {
    if (isTable(item)) return { ...defaults, ...pick(item, keys, [name, i], out) };
    schemaIssue(out, [name, i], 'must be a table');
    return undefined;
  });
}

/** The parsed document in the in-memory shape, unvalidated. */
function candidateOf(root: Table, out: Collector): unknown {
  pick(root, KEYS.root, [], out);
  const rom = subTable(root, 'rom', [], out);
  const build = subTable(root, 'build', [], out);
  const signatures = subTable(root, 'signatures', [], out);
  return {
    schema: root['schema'],
    rom: rom === undefined ? undefined : pick(rom, KEYS.rom, ['rom'], out),
    build: build === undefined ? undefined : pick(build, KEYS.build, ['build'], out),
    signatures: signatures === undefined ? undefined : pick(signatures, KEYS.signatures, ['signatures'], out),
    modules: tableArray(root, 'modules', KEYS.module, { generated: true }, out),
    functions: addressMap(root, 'functions', KEYS.function, { mode: 'thumb', aliases: [] }, out),
    entryPoints: addressMap(root, 'entry_points', KEYS.entryPoint, { mode: 'thumb', aliases: [] }, out),
    symbols: addressMap(root, 'symbols', KEYS.symbol, { aliases: [] }, out),
    overrides: tableArray(root, 'overrides', KEYS.override, {}, out),
  };
}

const ISSUE_SEGMENT = /([A-Za-z_$][\w$]*)|\[(-?\d+)\]/g;

/** A validateConfig issue path (`functions[134218864].name`) in TOML segments (`functions`, `0x08000470`, `name`). */
function issueSegments(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const m of path.matchAll(ISSUE_SEGMENT)) {
    if (m[1] !== undefined) segments.push(TOML_SPELLING[m[1]] ?? m[1]);
    else if (m[2] !== undefined) {
      const n = Number.parseInt(m[2], 10);
      const parent = segments[segments.length - 1];
      segments.push(
        (parent === 'functions' || parent === 'entry_points' || parent === 'symbols') && segments.length === 1 && n >= 0
          ? addressKey(n)
          : n,
      );
    }
  }
  return segments;
}

/** The first line of smol-toml's message, without its generic prefix. */
function tomlReason(error: TomlError): string {
  const first = error.message.split('\n')[0] ?? error.message;
  return first.replace(/^Invalid TOML document:\s*/, '');
}

/** E_DUPLICATE_ADDRESS for an address both [functions] and [entry_points] list: an entry is one or the other (D116). */
function bothTables(config: RomliftConfig, outline: TomlOutline): Diagnostic<ConfigCode>[] {
  const lines = new Map<Addr, number>();
  for (const use of addressKeyUses(outline))
    if (use.table === 'entry_points' && use.addr !== undefined && !lines.has(use.addr)) lines.set(use.addr, use.line);
  const out: Diagnostic<ConfigCode>[] = [];
  for (const addr of sortedKeys(config.entryPoints)) {
    if (!config.functions.has(addr)) continue;
    const line = lines.get(addr);
    out.push(
      diagnostic(
        ConfigCodes,
        'E_DUPLICATE_ADDRESS',
        `${line === undefined ? '' : `line ${line}: `}${addressKey(addr)} is in both [functions] and [entry_points]; an entry is a function (a file of its own) or an entry point inside one, so keep one line`,
        { addr },
      ),
    );
  }
  return out;
}

/** Parses romlift.toml text into the in-memory config, or every diagnostic that stops it. */
export function parseConfig(text: string): ConfigParseResult {
  const outline = outlineToml(text);
  const diagnostics: Diagnostic<ConfigCode>[] = checkAddressKeys(outline);
  const duplicateLines = new Set(
    duplicateDefinitions(addressKeyUses(outline)).flatMap((list) => list.map((d) => d.line)),
  );
  let root: Table;
  try {
    root = parse(text, { unsafeKeyBehaviour: 'throw' });
  } catch (error) {
    if (!(error instanceof TomlError)) {
      diagnostics.push(
        diagnostic(ConfigCodes, 'E_TOML_PARSE', `not TOML: ${error instanceof Error ? error.message : String(error)}`),
      );
    } else if (!duplicateLines.has(error.line)) {
      // smol-toml refuses a repeated key at the repetition; when keys.ts already named it, that is the report.
      diagnostics.push(
        diagnostic(ConfigCodes, 'E_TOML_PARSE', `line ${error.line}, column ${error.column}: ${tomlReason(error)}`),
      );
    }
    return { ok: false, diagnostics };
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const out: Collector = { outline, diagnostics: [], reported: new Set() };
  const validated = validateConfig(candidateOf(root, out));
  if (!validated.ok)
    for (const issue of validated.issues) schemaIssue(out, issueSegments(issue.path), issue.message, issue.code);
  if (!validated.ok || out.diagnostics.length > 0) return { ok: false, diagnostics: out.diagnostics };
  const misaligned = [...misalignedFunctionKeys(validated.config, outline), ...bothTables(validated.config, outline)];
  if (misaligned.length > 0) return { ok: false, diagnostics: misaligned };
  return { ok: true, value: validated.config, diagnostics: [] };
}
