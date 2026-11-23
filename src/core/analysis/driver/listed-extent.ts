// The validity of a listed extent (phase-6.md Q10, the owner's option (c), D100): the confirm run judges a listed Thumb
// entry that asks for validation (`Seed.validate`) over its listed extent, per inner label's mode, and takes a
// fall-through into the next listed function as the path's exit.
//
// - Per mode. The listed extent [entry, end) (extentEndOf) may hold inner labels ([entry_points] entries, D116) of mode arm: m4a's
//   umul3232H32 and SoundMainRAM are Thumb entries that switch to ARM in place, their ARM code folded in as such
//   labels. The Thumb walk leaves that ARM code unwalked (walk.inline-arm-switch), so the entry's reading alone counts
//   it as holes. The entry is judged by its Thumb reading with the bytes each such label's ARM reading covers counted
//   as covered; each such label that is not a function yet is then judged as ARM, by the validity slot over its own
//   ARM reading (validity.ts firstInvalid). An extent without such a label is judged exactly as whyInvalid judges the
//   entry, but for the fall-through.
// - Fall-through. A reading falls through into the next listed function when its last instruction ends exactly at the
//   extent's end, a listed entry that is not a label, and flows on into it (no exit there, no unconditional branch,
//   return or register jump): m4a's `ldrb_r3_r2`, two bytes before `chk_adr_r2`. The judged reading then gains the
//   fall-through as a tail exit, as a branch to the next function would be. Anything else (an extent that ends
//   elsewhere, a gap before the next function, a last instruction that does not flow on) gains nothing.
import type { Insn } from '@match-kit/isa/armv4t';

import type { Addr, Mode } from '../../../foundation/rom/span.ts';
import { lowerBound } from '../../../foundation/util/arrays.ts';
import { hexAddr } from '../../../foundation/util/hex.ts';
import { makeReading } from '../reading.ts';
import type { Reading, Seed, ValidityFailure } from '../types.ts';
import { decodeArmAt } from '../walk/arm.ts';
import { decodeThumbAt } from '../walk/thumb.ts';
import { extentEndOf } from './facts.ts';
import { read } from './settle.ts';
import { isListedBoundary } from './state.ts';
import type { DriverState } from './state.ts';
import { firstInvalid } from './validity.ts';

/** The inner labels of [entry, end) whose mode is not `mode`, ascending. */
export function otherModeLabels(
  s: Pick<DriverState, 'listed' | 'listedOrder'>,
  entry: Addr,
  mode: Mode,
  end: Addr,
): readonly Seed[] {
  const out: Seed[] = [];
  const order = s.listedOrder;
  for (let i = lowerBound(order, entry + 1, (x) => x); i < order.length; i++) {
    const a = order[i] as Addr;
    if (a >= end) break;
    const seed = s.listed.get(a);
    if (seed?.label === true && seed.mode !== mode) out.push(seed);
  }
  return out;
}

/** Whether `insn`'s path goes on to the next address: no exit at it, and a flow that continues. */
function flowsOn(insn: Insn, r: Reading): boolean {
  if (r.exits.some((e) => e.at === insn.addr)) return false;
  const flow = insn.flow;
  switch (flow.kind) {
    case 'next':
    case 'adr':
    case 'call':
      return true;
    case 'branch':
      return flow.conditional;
    case 'pool-load':
      return flow.rd !== 15;
    default:
      return false;
  }
}

/**
 * The instruction of `r` that falls through into the listed function at `end`, if any: `r`'s last instruction, ending
 * exactly at `end`, a listed entry that is not a label, and flowing on into it.
 */
export function fallThroughAt(s: DriverState, r: Reading, end: Addr): Addr | undefined {
  if (!isListedBoundary(s, end) || r.codeEnd !== end) return undefined;
  const last = r.insns[r.insns.length - 1];
  if (last === undefined || last.addr + last.len !== end) return undefined;
  const insn = r.mode === 'thumb' ? decodeThumbAt(s.walkEnv, last.addr) : decodeArmAt(s.walkEnv, last.addr);
  return flowsOn(insn, r) ? last.addr : undefined;
}

/** `r` with the bytes `others` cover counted as covered, and a fall-through into the function at `end` as a tail exit. */
function extentReading(s: DriverState, r: Reading, others: readonly Reading[], end: Addr): Reading {
  const falls = [r, ...others].map((x) => fallThroughAt(s, x, end)).find((at) => at !== undefined);
  if (others.length === 0 && falls === undefined) return r;
  return makeReading(
    {
      ...r,
      insns: [...r.insns, ...others.flatMap((o) => o.insns)],
      pools: [...r.pools, ...others.flatMap((o) => o.pools)],
      tables: [...r.tables, ...others.flatMap((o) => o.tables)],
      // A fall-through is the path's exit into the next function, as a tail branch to it would be.
      ...(falls === undefined
        ? {}
        : {
            returns: r.returns + 1,
            tailExits: r.tailExits + 1,
            exits: [...r.exits, { at: falls, kind: 'tail', rule: 'seed.listed' }],
          }),
    },
    s.rom,
  );
}

/**
 * The first validity failure of the listed Thumb entry's extent (Q10); undefined when it is valid. The entry is judged
 * as whyInvalid judges it (a `checkEntry` rule before any reading), by its Thumb reading with the bytes of the
 * extent's ARM labels' readings counted as covered and a fall-through into the next listed function as an exit; then
 * each ARM label that is not a function yet is judged by its ARM reading, with a fall-through as an exit too.
 */
export function whyListedInvalid(s: DriverState, entry: Addr): ValidityFailure | undefined {
  let extent: { readonly end: Addr; readonly labels: readonly Seed[]; readonly reading: Reading } | undefined;
  const extentOf = (): { readonly end: Addr; readonly labels: readonly Seed[]; readonly reading: Reading } => {
    if (extent !== undefined) return extent;
    const r = read(s, entry, 'thumb');
    const end = extentEndOf(s, r);
    const labels = otherModeLabels(s, entry, 'thumb', end);
    extent = {
      end,
      labels,
      reading: extentReading(
        s,
        r,
        labels.map((l) => read(s, l.entry, l.mode)),
        end,
      ),
    };
    return extent;
  };
  const head = firstInvalid(s, entry, 'thumb', () => extentOf().reading);
  if (head !== undefined) return head;
  const { end, labels } = extentOf();
  for (const label of labels) {
    if (s.funcs.has(label.entry)) continue;
    const failure = firstInvalid(s, label.entry, label.mode, () =>
      extentReading(s, read(s, label.entry, label.mode), [], end),
    );
    if (failure !== undefined)
      return { ...failure, detail: `its ${label.mode} label ${hexAddr(label.entry)}: ${failure.detail}` };
  }
  return undefined;
}
