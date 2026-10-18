// The model's public JSON (architecture §3.4, §9.4, D19, D62 d): `model --json` is NDJSON, the ModelJsonHeader
// line, then one ModelJsonChunk line per chunk in ROM order, each with its items inline as
// [kind, start, length, specId | null, aux]. Every line is canonical JSON (keys sorted by code unit, addresses
// '0x' and eight upper-case hex digits, optional members left out when absent), so equal models encode to the
// same text. Each yielded string is one line with its newline: their concatenation is the document, and no
// chunk line is ever built beside another.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import { canonicalJson } from '../../foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../foundation/formats/types.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Span } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import type { UnlistedFinding } from '../analysis/types.ts';
import { specIdAt } from './item-table.ts';
import type {
  Chunk,
  ItemKindCode,
  Label,
  Model,
  ModelFunction,
  ModelJsonChunk,
  ModelJsonDiagnostic,
  ModelJsonFunction,
  ModelJsonHeader,
  ModelJsonItem,
  ModelJsonLabel,
  ModelJsonModule,
  ModelJsonSpan,
  ModelJsonSymbol,
  ModelJsonUnlisted,
  ModelSymbol,
  Module,
  NameSource,
} from './types.ts';
import { NO_SPEC } from './types.ts';

/** The schema of the header line. */
export const MODEL_JSON_SCHEMA: ModelJsonHeader['schema'] = 'romlift/model-json@1';

// Each value is an object literal checked against its ModelJson type with `satisfies`: it keeps its literal
// type, which canonicalJson accepts (an interface has no index signature).

function span(s: Span) {
  return { start: hexAddr(s.start), end: hexAddr(s.end) } satisfies ModelJsonSpan;
}

function label(l: Label) {
  return { addr: hexAddr(l.addr), name: l.name, kind: l.kind, thumb: l.thumb, scope: l.scope } satisfies ModelJsonLabel;
}

function moduleJson(m: Module) {
  return {
    name: m.name,
    span: span(m.span),
    kind: m.kind,
    generated: m.generated,
    compiler: m.compiler,
    cflags: [...m.cflags],
    ...(m.library === undefined ? {} : { library: { name: m.library.name, version: m.library.version } }),
    ...(m.runAt === undefined ? {} : { runAt: hexAddr(m.runAt) }),
    chunks: { first: m.chunks.first, count: m.chunks.count },
  } satisfies ModelJsonModule;
}

function nameSource(n: NameSource) {
  if (n.kind === 'default') return { kind: 'default' } satisfies NameSource;
  return (n.from === undefined ? { kind: 'toml' } : { kind: 'toml', from: n.from }) satisfies NameSource;
}

function functionJson(f: ModelFunction) {
  return {
    entry: hexAddr(f.entry),
    extent: span(f.extent),
    mode: f.mode,
    name: f.name,
    aliases: [...f.aliases],
    ...(f.runAt === undefined ? {} : { runAt: hexAddr(f.runAt) }),
    source: { name: nameSource(f.source.name), extent: f.source.extent },
  } satisfies ModelJsonFunction;
}

function symbolJson(s: ModelSymbol) {
  return { addr: hexAddr(s.addr), name: s.name, ...(s.size === undefined ? {} : { size: s.size }) } satisfies ModelJsonSymbol;
}

function unlistedJson(u: UnlistedFinding) {
  const p = u.provenance;
  return {
    entry: hexAddr(u.entry),
    mode: u.mode,
    origin: u.origin,
    provenance: { rule: p.rule, round: p.round, cites: p.cites.map(hexAddr), ...(p.note === undefined ? {} : { note: p.note }) },
  } satisfies ModelJsonUnlisted;
}

function diagnosticJson(d: Diagnostic) {
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    ...(d.addr === undefined ? {} : { addr: hexAddr(d.addr) }),
    ...(d.span === undefined ? {} : { span: span(d.span) }),
    ...(d.path === undefined ? {} : { path: d.path }),
    ...(d.cites === undefined ? {} : { cites: d.cites.map(hexAddr) }),
    ...(d.rule === undefined ? {} : { rule: d.rule }),
  } satisfies ModelJsonDiagnostic;
}

/** The header line's value. */
function headerJson(model: Model) {
  return {
    schema: MODEL_JSON_SCHEMA,
    rom: { sha1: model.rom.sha1, end: hexAddr(model.rom.end) },
    build: { name: model.build.name },
    modules: model.modules.map(moduleJson),
    functions: model.functions.map(functionJson),
    labels: model.labels.map(label),
    symbols: model.symbols.map(symbolJson),
    unlisted: model.unlisted.map(unlistedJson),
    diagnostics: model.diagnostics.map(diagnosticJson),
  } satisfies ModelJsonHeader;
}

/** One item row of the table, as JSON. */
function itemJson(model: Model, i: number): ModelJsonItem {
  const { items } = model;
  const spec = items.spec[i] ?? NO_SPEC;
  return [(items.kind[i] ?? 0) as ItemKindCode, hexAddr(items.start[i] ?? 0), items.length[i] ?? 0, spec === NO_SPEC ? null : (specIdAt(spec) ?? null), items.aux[i] ?? 0];
}

/** A chunk line's value, its items inline. */
function chunkJson(model: Model, chunk: Chunk) {
  const items: ModelJsonItem[] = [];
  for (let i = chunk.items.first; i < chunk.items.first + chunk.items.count; i++) items.push(itemJson(model, i));
  return {
    span: span(chunk.span),
    kind: chunk.kind,
    name: chunk.name,
    mode: chunk.mode,
    module: chunk.module,
    innerLabels: chunk.innerLabels.map(label),
    ...(chunk.runAt === undefined ? {} : { runAt: hexAddr(chunk.runAt) }),
    items,
  } satisfies ModelJsonChunk;
}

/** One NDJSON line: the canonical JSON of `value` and a newline. */
function line(value: JsonValue): string {
  return `${[...canonicalJson(value)].join('')}\n`;
}

/**
 * The NDJSON of `model` over `rom`: the ModelJsonHeader line, then one ModelJsonChunk line per chunk in ROM
 * order. Lazy: each line is built when it is asked for. `rom` must be the ROM the model was built from.
 */
export function* encodeModel(model: Model, rom: Rom): Iterable<string> {
  if (rom.sha1 !== model.rom.sha1 || rom.end !== model.rom.end) {
    throw new RomliftInvariantError(`encodeModel: the model was built from ROM ${model.rom.sha1}, not ${rom.sha1}`);
  }
  yield line(headerJson(model));
  for (const chunk of model.chunks) yield line(chunkJson(model, chunk));
}
