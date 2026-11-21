// The tiling self-check (architecture §6.2, §6.4): every ROM byte is in exactly one item, the items are in
// address order, the chunks tile the items (each chunk spans exactly its items, chunk after chunk), and the
// modules tile the ROM (each module spans exactly its chunks, module after module, from the ROM base to its
// end). Each level reports its first gap or overlap as E_SELF_CHECK_TILING, naming the address; the levels
// are checked independently, so one broken chunk does not hide a broken module. A module's C data range (§6.6) counts
// as the C unit's: the module spans and the data ranges tile the ROM together (core/model/modules.ts modulePieces),
// and the chunks between a range's ends are data chunks that name its module.
//
// verifyModel runs the three model checks (tiling, re-encode, module size) and lives here because the other
// two read the item table this check validates.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { ROM_BASE } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { modulePieces } from '../model/modules.ts';
import type { ModulePiece } from '../model/modules.ts';
import type { Chunk, Model, Module } from '../model/types.ts';
import { VerifyCodes } from './codes.ts';
import { checkModuleSize } from './module-size.ts';
import { checkReencode } from './reencode.ts';
import { checkResult } from './report.ts';
import type { CheckResult, VerifyReport } from './report.ts';

function tilingError(message: string, addr: Addr, span?: Span): Diagnostic {
  return diagnostic(VerifyCodes, 'E_SELF_CHECK_TILING', message, span === undefined ? { addr } : { addr, span });
}

function range(span: Span): string {
  return `${hexAddr(span.start)}..${hexAddr(span.end)}`;
}

/** Where `next` meets the running end `at`: undefined when it starts exactly there. */
function seam(what: string, at: Addr, next: Addr): Diagnostic | undefined {
  if (next === at) return undefined;
  return next > at
    ? tilingError(`gap ${range({ start: at, end: next })} before ${what}`, at, { start: at, end: next })
    : tilingError(`${what} overlaps the bytes before it: it starts at ${hexAddr(next)}, below ${hexAddr(at)}`, next, {
        start: next,
        end: at,
      });
}

/** The tail of a level: its running end must be the ROM end. */
function closing(what: string, at: Addr, end: Addr): Diagnostic | undefined {
  if (at === end) return undefined;
  return at < end
    ? tilingError(`gap ${range({ start: at, end })} at the end of the ROM: no ${what} covers it`, at, {
        start: at,
        end,
      })
    : tilingError(`the ${what} run past the ROM end ${hexAddr(end)} to ${hexAddr(at)}`, end, { start: end, end: at });
}

/** Items: in address order, back to back, from the ROM base to the ROM end. */
function itemsProblem(rom: Rom, model: Model): Diagnostic | undefined {
  const items = model.items;
  if (model.rom.end !== rom.end)
    return tilingError(`the model is of a ROM ending at ${hexAddr(model.rom.end)}, not ${hexAddr(rom.end)}`, rom.end);
  let at = ROM_BASE;
  for (let i = 0; i < items.count; i++) {
    const start = items.start[i] ?? 0;
    const length = items.length[i] ?? 0;
    const problem = seam(`item ${i} (${range({ start, end: start + length })})`, at, start);
    if (problem !== undefined) return problem;
    if (length === 0) return tilingError(`item ${i} at ${hexAddr(start)} is empty`, start);
    at = start + length;
  }
  return closing('item', at, rom.end);
}

function itemsSpan(model: Model, chunk: Chunk): Span | undefined {
  const { first, count } = chunk.items;
  const last = first + count - 1;
  if (count < 1 || first < 0 || last >= model.items.count) return undefined;
  const start = model.items.start[first] ?? 0;
  return { start, end: (model.items.start[last] ?? 0) + (model.items.length[last] ?? 0) };
}

/** Chunks: each spans exactly its items, the item ranges follow each other, the spans follow each other. */
function chunksProblem(rom: Rom, model: Model): Diagnostic | undefined {
  let item = 0;
  let at = ROM_BASE;
  for (const chunk of model.chunks) {
    const what = `chunk ${chunk.name} (${range(chunk.span)})`;
    if (chunk.items.first !== item) {
      return tilingError(
        `${what} holds items from ${chunk.items.first}, but the chunk before it ends at item ${item}`,
        chunk.span.start,
        chunk.span,
      );
    }
    const covered = itemsSpan(model, chunk);
    if (covered === undefined) return tilingError(`${what} holds no items of the table`, chunk.span.start, chunk.span);
    if (covered.start !== chunk.span.start || covered.end !== chunk.span.end) {
      return tilingError(`${what} does not span its items, ${range(covered)}`, chunk.span.start, chunk.span);
    }
    const problem = seam(what, at, chunk.span.start);
    if (problem !== undefined) return problem;
    item += chunk.items.count;
    at = chunk.span.end;
  }
  if (item !== model.items.count) {
    const start = model.items.start[item] ?? at;
    return tilingError(`items ${item} to ${model.items.count - 1} belong to no chunk`, start);
  }
  return closing('chunk', at, rom.end);
}

function chunksSpan(model: Model, module: Module): Span | undefined {
  const { first, count } = module.chunks;
  const head = model.chunks[first];
  const tail = model.chunks[first + count - 1];
  if (count < 1 || head === undefined || tail === undefined) return undefined;
  return { start: head.span.start, end: tail.span.end };
}

/** The problem of one module's text piece: it spans exactly its chunks, which name it, from chunk `chunk`. */
function textPieceProblem(model: Model, module: Module, chunk: number): Diagnostic | undefined {
  const what = `module ${module.name} (${range(module.span)})`;
  if (module.chunks.first !== chunk) {
    return tilingError(
      `${what} holds chunks from ${module.chunks.first}, but the module before it ends at chunk ${chunk}`,
      module.span.start,
      module.span,
    );
  }
  const covered = chunksSpan(model, module);
  if (covered === undefined) return tilingError(`${what} holds no chunks`, module.span.start, module.span);
  if (covered.start !== module.span.start || covered.end !== module.span.end) {
    return tilingError(`${what} does not span its chunks, ${range(covered)}`, module.span.start, module.span);
  }
  const stranger = model.chunks
    .slice(module.chunks.first, module.chunks.first + module.chunks.count)
    .find((c) => c.module !== module.name);
  if (stranger !== undefined) {
    return tilingError(
      `chunk ${stranger.name} lies in ${what} but names module ${stranger.module}`,
      stranger.span.start,
      stranger.span,
    );
  }
  return undefined;
}

/** How many chunks a data range holds from chunk `chunk` on: data chunks that name its module, back to back up to its end; or its problem. */
function dataPieceChunks(model: Model, module: Module, piece: ModulePiece, chunk: number): number | Diagnostic {
  const what = `module ${module.name}'s data range (${range(piece.span)})`;
  let at = piece.span.start;
  let count = 0;
  for (let c = chunk; c < model.chunks.length && at < piece.span.end; c++) {
    const next = model.chunks[c];
    if (next === undefined) break;
    if (next.span.start !== at || next.span.end > piece.span.end) break;
    if (next.module !== module.name || next.kind !== 'data') {
      return tilingError(
        `chunk ${next.name} lies in ${what} but is a ${next.kind} chunk of module ${next.module}`,
        next.span.start,
        next.span,
      );
    }
    at = next.span.end;
    count++;
  }
  if (count === 0 || at !== piece.span.end)
    return tilingError(`${what} is not spanned by data chunks from chunk ${chunk}`, piece.span.start, piece.span);
  return count;
}

/** Modules: each spans exactly its chunks, which name it; with the data ranges, the modules tile the ROM. */
function modulesProblem(rom: Rom, model: Model): Diagnostic | undefined {
  let chunk = 0;
  let at = ROM_BASE;
  for (const piece of modulePieces(model.modules)) {
    const module = model.modules[piece.module];
    if (module === undefined) continue;
    const what =
      piece.part === 'text'
        ? `module ${module.name} (${range(piece.span)})`
        : `module ${module.name}'s data range (${range(piece.span)})`;
    const held =
      piece.part === 'text'
        ? (textPieceProblem(model, module, chunk) ?? module.chunks.count)
        : dataPieceChunks(model, module, piece, chunk);
    if (typeof held !== 'number') return held;
    const problem = seam(what, at, piece.span.start);
    if (problem !== undefined) return problem;
    chunk += held;
    at = piece.span.end;
  }
  if (chunk !== model.chunks.length) {
    const orphan = model.chunks[chunk];
    return tilingError(`chunks ${chunk} to ${model.chunks.length - 1} belong to no module`, orphan?.span.start ?? at);
  }
  return closing('module', at, rom.end);
}

/** The tiling check: the first gap or overlap of the items, of the chunks and of the modules. */
export function checkTiling(rom: Rom, model: Model): CheckResult {
  const diagnostics = [itemsProblem(rom, model), chunksProblem(rom, model), modulesProblem(rom, model)].filter(
    (d): d is Diagnostic => d !== undefined,
  );
  const detail =
    diagnostics[0]?.message ??
    `${model.items.count} items, ${model.chunks.length} chunks and ${model.modules.length} modules tile ${range({ start: ROM_BASE, end: rom.end })}`;
  return checkResult('tiling', diagnostics, detail);
}

/** The three model self-checks of §6.4, before any file is emitted: tiling, re-encode and module size. */
export function verifyModel(rom: Rom, model: Model): VerifyReport {
  const checks = [checkTiling(rom, model), checkReencode(rom, model), checkModuleSize(model)];
  return { ok: checks.every((c) => c.ok), checks };
}
