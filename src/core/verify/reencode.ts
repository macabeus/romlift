// The re-encode self-check (architecture §5, §6.4, D14): every `insn` item, the items the printer writes as
// mnemonics, passes the printing rule under the label resolver of its module (core/model/resolver.ts, the
// one the printer uses): no encoding reason of its row makes it raw, and its text, parsed and assembled at
// its run address, gives back its size and bytes. An item whose recorded row is not what its bytes decode
// to fails too. Raw-insn items print as data and are not checked. Each failure is E_SELF_CHECK_REENCODE at
// the item's load address; the result keeps the first MAX_REPORTED and counts the rest.
//
// The check is independent of the shortcut the model classified its items through (core/model/printing-cache.ts
// printingCache): every instruction whose text names an address runs the round trip itself (foundation/isa
// rawReason). Only an instruction that names no address goes through a cache, addressFreeReasons, whose key is
// its mode and exact word, so the cache can change no answer. The decode of each item is not cached: the check
// still compares every item's recorded row with what its bytes decode to.
import type { SymbolResolver } from '@match-kit/isa/armv4t';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { rawReason } from '../../foundation/isa.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { decodeItemAt } from '../model/item-table.ts';
import { runOffsetOf } from '../model/modules.ts';
import { addressFreeReasons, namesNoAddress } from '../model/printing-cache.ts';
import type { AddressFreeReasons } from '../model/printing-cache.ts';
import { resolverFor } from '../model/resolver.ts';
import { ItemKind } from '../model/types.ts';
import type { Model } from '../model/types.ts';
import { VerifyCodes } from './codes.ts';
import { checkResult } from './report.ts';
import type { CheckResult } from './report.ts';

/** How many failures one result lists; the rest are counted in its detail. */
const MAX_REPORTED = 64;

/** Why item `i` would not print as a mnemonic that assembles back, or undefined when it would. */
function failure(
  rom: Rom,
  model: Model,
  i: number,
  runOffset: number,
  resolver: SymbolResolver,
  cache: AddressFreeReasons,
): string | undefined {
  const insn = decodeItemAt(rom, model.items, i, runOffset);
  if (typeof insn === 'string') return insn;
  const reason = namesNoAddress(insn) ? cache.reasonOf(insn, resolver) : rawReason(insn, resolver);
  return reason === null ? undefined : `${insn.specId} prints raw (${reason})`;
}

/** The re-encode check over every insn item of every chunk, under its module's resolver. */
export function checkReencode(rom: Rom, model: Model): CheckResult {
  const diagnostics: Diagnostic[] = [];
  let failed = 0;
  let checked = 0;
  const cache = addressFreeReasons();
  for (const module of model.modules) {
    const resolver = resolverFor(model, module.name);
    for (const chunk of model.chunks.slice(module.chunks.first, module.chunks.first + module.chunks.count)) {
      const end = Math.min(chunk.items.first + chunk.items.count, model.items.count);
      for (let i = Math.max(0, chunk.items.first); i < end; i++) {
        if (model.items.kind[i] !== ItemKind.insn) continue;
        checked++;
        const why = failure(rom, model, i, runOffsetOf(chunk), resolver, cache);
        if (why === undefined) continue;
        failed++;
        const addr: Addr = model.items.start[i] ?? 0;
        if (diagnostics.length < MAX_REPORTED) {
          diagnostics.push(
            diagnostic(
              VerifyCodes,
              'E_SELF_CHECK_REENCODE',
              `the instruction at ${hexAddr(addr)} in ${chunk.name} (module ${module.name}) does not re-encode: ${why}`,
              { addr },
            ),
          );
        }
      }
    }
  }
  const first = diagnostics[0]?.message;
  const detail =
    first === undefined
      ? `${checked} instructions re-encode`
      : failed > 1
        ? `${first} (${failed} instructions in all)`
        : first;
  return checkResult('reencode', diagnostics, detail);
}
