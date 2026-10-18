// The re-encode self-check (architecture §5, §6.4, D14): every `insn` item, the items the printer writes as
// mnemonics, passes the printing rule under the label resolver of its module (core/model/resolver.ts, the
// one the printer uses): no encoding reason of its row makes it raw, and its text, parsed and assembled at
// its run address, gives back its size and bytes. An item whose recorded row is not what its bytes decode
// to fails too. Raw-insn items print as data and are not checked. Each failure is E_SELF_CHECK_REENCODE at
// the item's load address; the result keeps the first MAX_REPORTED and counts the rest.
import { decode } from '../../foundation/isa/decode.ts';
import { printing } from '../../foundation/isa/roundtrip.ts';
import type { Insn, SymbolResolver } from '../../foundation/isa/types.ts';
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { contains, u16, u32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { specIdAt } from '../model/item-table.ts';
import { resolverFor } from '../model/resolver.ts';
import { ItemKind } from '../model/types.ts';
import type { Chunk, Model } from '../model/types.ts';
import { checkResult } from './report.ts';
import type { CheckResult } from './report.ts';
import { VerifyCodes } from './codes.ts';

/** How many failures one result lists; the rest are counted in its detail. */
export const MAX_REPORTED = 64;

/** The instruction of item `i` decoded at its run address, or why it cannot be. */
function decodeItem(rom: Rom, model: Model, i: number, runOffset: number): Insn | string {
  const start = model.items.start[i] ?? 0;
  const size = model.items.length[i] ?? 0;
  const specId = specIdAt(model.items.spec[i] ?? 0xffff);
  if (specId === undefined) return 'it records no isa row';
  if (!contains(rom, start, size)) return `its ${size} bytes are not in the ROM`;
  const mode = specId.startsWith('thumb.') ? 'thumb' : 'arm';
  const word = mode === 'arm' ? (size === 4 ? u32(rom, start) : undefined) : size === 2 ? u16(rom, start) : size === 4 ? (u16(rom, start) | (u16(rom, start + 2) << 16)) >>> 0 : undefined;
  if (word === undefined) return `a ${size}-byte ${mode} instruction cannot exist`;
  const insn = decode(mode, word, start + runOffset);
  if (insn.specId !== specId || insn.size !== size) return `it records ${specId} (${size} bytes) but its bytes decode as ${insn.specId} (${insn.size} bytes)`;
  return insn;
}

/** Why item `i` would not print as a mnemonic that assembles back, or undefined when it would. */
function failure(rom: Rom, model: Model, i: number, runOffset: number, resolver: SymbolResolver): string | undefined {
  const insn = decodeItem(rom, model, i, runOffset);
  if (typeof insn === 'string') return insn;
  const printed = printing(insn, resolver);
  return printed.kind === 'mnemonic' ? undefined : `${insn.specId} prints raw (${printed.reason})`;
}

function runOffsetOf(chunk: Chunk): number {
  return chunk.runAt === undefined ? 0 : chunk.runAt - chunk.span.start;
}

/** The re-encode check over every insn item of every chunk, under its module's resolver. */
export function checkReencode(rom: Rom, model: Model): CheckResult {
  const diagnostics: Diagnostic[] = [];
  let failed = 0;
  let checked = 0;
  for (const module of model.modules) {
    const resolver = resolverFor(model, module.name);
    for (const chunk of model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count)) {
      const end = Math.min(chunk.items.first + chunk.items.count, model.items.count);
      for (let i = Math.max(0, chunk.items.first); i < end; i++) {
        if (model.items.kind[i] !== ItemKind.insn) continue;
        checked++;
        const why = failure(rom, model, i, runOffsetOf(chunk), resolver);
        if (why === undefined) continue;
        failed++;
        const addr: Addr = model.items.start[i] ?? 0;
        if (diagnostics.length < MAX_REPORTED) {
          diagnostics.push(diagnostic(VerifyCodes, 'E_SELF_CHECK_REENCODE', `the instruction at ${hexAddr(addr)} in ${chunk.name} (module ${module.name}) does not re-encode: ${why}`, { addr }));
        }
      }
    }
  }
  const first = diagnostics[0]?.message;
  const detail = first === undefined ? `${checked} instructions re-encode` : failed > 1 ? `${first} (${failed} instructions in all)` : first;
  return checkResult('reencode', diagnostics, detail);
}
