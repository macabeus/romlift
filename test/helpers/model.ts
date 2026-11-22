// Small hand-made Models for the unit tests of the printer, the writers, the self-checks and the write
// plan (D62), so they need neither buildModel nor a fixture: a ROM from placed bytes (analysis.ts's
// romWith), modules made of chunks made of items, and the labels a test names. Spans are derived from the
// items: a chunk spans its items, a module its chunks. Nothing here checks the tiling; a test that wants a
// broken model builds one.
import { decode } from '@match-kit/isa/armv4t';
import type { Insn } from '@match-kit/isa/armv4t';

import { itemTableBuilder } from '../../src/core/model/item-table.ts';
import type { ItemInput } from '../../src/core/model/item-table.ts';
import type {
  Chunk,
  ChunkKind,
  Label,
  LabelKind,
  Model,
  ModelFunction,
  ModelSymbol,
  Module,
} from '../../src/core/model/types.ts';
import { thumbWordAt } from '../../src/foundation/rom/rom.ts';
import { u32 } from '../../src/foundation/rom/rom.ts';
import type { Rom } from '../../src/foundation/rom/rom.ts';
import type { Addr, Mode } from '../../src/foundation/rom/span.ts';

export { romWith, words } from './analysis.ts';
export type { ItemInput } from '../../src/core/model/item-table.ts';

export interface ChunkSpec {
  /** Default 'function'. */
  readonly kind?: ChunkKind;
  readonly name: string;
  /** Default 'thumb' for function, orphan and startup chunks, null for header and data chunks. */
  readonly mode?: Mode | null;
  /** In address order; at least one. */
  readonly items: readonly ItemInput[];
  readonly innerLabels?: readonly Label[];
  readonly runAt?: Addr;
}

export interface ModuleSpec {
  readonly name: string;
  /** Default 'asm'. */
  readonly kind?: Module['kind'];
  /** Default true. */
  readonly generated?: boolean;
  /** A hand-written source (Module.source, D109). */
  readonly source?: string;
  /** Default 'agbcc'. */
  readonly compiler?: string;
  readonly cflags?: readonly string[];
  readonly library?: { readonly name: string; readonly version: string };
  readonly runAt?: Addr;
  /** In address order; at least one. */
  readonly chunks: readonly ChunkSpec[];
}

export interface ModelSpec {
  /** In ROM order. */
  readonly modules: readonly ModuleSpec[];
  /** Any order; the Model holds them sorted by addr, then name. */
  readonly labels?: readonly Label[];
  readonly functions?: readonly ModelFunction[];
  readonly symbols?: readonly ModelSymbol[];
  /** Default 'test'. */
  readonly build?: string;
}

function endOf(item: ItemInput): Addr {
  switch (item.kind) {
    case 'pool':
    case 'table-entry':
      return item.start + 4;
    default:
      return item.start + item.length;
  }
}

function byAddrThenName(
  a: { readonly addr: Addr; readonly name: string },
  b: { readonly addr: Addr; readonly name: string },
): number {
  return a.addr - b.addr || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** A Model of the given modules, chunks and items over `rom`. */
export function modelOf(rom: Rom, spec: ModelSpec): Model {
  const items = itemTableBuilder();
  const chunks: Chunk[] = [];
  const modules: Module[] = [];
  for (const m of spec.modules) {
    const firstChunk = chunks.length;
    for (const c of m.chunks) {
      const first = items.count;
      for (const item of c.items) items.append(item);
      const head = c.items[0];
      const tail = c.items[c.items.length - 1];
      if (head === undefined || tail === undefined) throw new Error(`chunk ${c.name} has no items`);
      const kind = c.kind ?? 'function';
      chunks.push({
        span: { start: head.start, end: endOf(tail) },
        kind,
        name: c.name,
        mode: c.mode !== undefined ? c.mode : kind === 'header' || kind === 'data' ? null : 'thumb',
        module: m.name,
        items: { first, count: c.items.length },
        innerLabels: [...(c.innerLabels ?? [])].sort(byAddrThenName),
        ...(c.runAt === undefined ? {} : { runAt: c.runAt }),
      });
    }
    const own = chunks.slice(firstChunk);
    const head = own[0];
    const tail = own[own.length - 1];
    if (head === undefined || tail === undefined) throw new Error(`module ${m.name} has no chunks`);
    modules.push({
      name: m.name,
      span: { start: head.span.start, end: tail.span.end },
      kind: m.kind ?? 'asm',
      generated: m.generated ?? true,
      ...(m.source === undefined ? {} : { source: m.source }),
      compiler: m.compiler ?? 'agbcc',
      cflags: m.cflags ?? [],
      ...(m.library === undefined ? {} : { library: m.library }),
      ...(m.runAt === undefined ? {} : { runAt: m.runAt }),
      chunks: { first: firstChunk, count: own.length },
    });
  }
  return {
    schema: 'romlift/model@1',
    rom: { sha1: rom.sha1, end: rom.end },
    build: { name: spec.build ?? 'test' },
    functions: [...(spec.functions ?? [])].sort((a, b) => a.entry - b.entry),
    chunks,
    modules,
    items: items.finish(),
    labels: [...(spec.labels ?? [])].sort(byAddrThenName),
    symbols: [...(spec.symbols ?? [])].sort(byAddrThenName),
    unlisted: [],
    diagnostics: [],
  };
}

/** A label; default kind 'func', Thumb, module scope. */
export function label(
  name: string,
  addr: Addr,
  opts: { readonly kind?: LabelKind; readonly thumb?: boolean; readonly scope?: Label['scope'] } = {},
): Label {
  return { addr, name, kind: opts.kind ?? 'func', thumb: opts.thumb ?? true, scope: opts.scope ?? 'module' };
}

/** The instruction at `at` as the ROM decodes it (Thumb: a bl pair is one instruction). */
export function insnAt(rom: Rom, at: Addr, mode: Mode): Insn {
  return decode(mode, mode === 'thumb' ? thumbWordAt(rom, at) : u32(rom, at), at);
}

/** One insn item per instruction of [start, end), decoded in `mode`. */
export function codeItems(rom: Rom, start: Addr, end: Addr, mode: Mode): ItemInput[] {
  const out: ItemInput[] = [];
  for (let at = start; at < end; ) {
    const insn = insnAt(rom, at, mode);
    out.push({ kind: 'insn', start: at, length: insn.size, specId: insn.specId });
    at += insn.size;
  }
  return out;
}

/** A data item. */
export function dataItem(start: Addr, length: number, note?: 'dead' | 'mixer-hole' | 'unreached'): ItemInput {
  return note === undefined ? { kind: 'data', start, length } : { kind: 'data', start, length, note };
}

/** A pool item holding the ROM's word at `start`. */
export function poolItem(rom: Rom, start: Addr): ItemInput {
  return { kind: 'pool', start, value: u32(rom, start) };
}
