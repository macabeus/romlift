// The references that bound the legal module borders (architecture §6.2, D15, D63): every short Thumb branch
// (b, bcc), which cannot reach across objects on every binutils version, and every PC-relative load and adr, for
// which GNU as has no relocation into another object. One scan of the analysis' function spans.
import { decode, thumbMayName } from '../../foundation/isa/decode.ts';
import type { Flow } from '../../foundation/isa/types.ts';
import { peek16, peek32 } from '../../foundation/rom/rom.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { alignWord } from './align.ts';

/** A short Thumb branch (b, bcc): its site and target. */
export interface ShortBranch {
  readonly site: Addr;
  readonly target: Addr;
}

/** The references that bound the legal borders: the short Thumb branches and the PC-relative loads and adrs. */
export interface BorderRefs {
  readonly shortBranches: readonly ShortBranch[];
  readonly pcRelative: readonly ShortBranch[];
}

/**
 * One scan of the code spans of the analysis' functions, decoded with foundation/isa at load addresses (a
 * reference inside a runs_at range has the same offset in run space): every short Thumb branch (b, bcc), and
 * every PC-relative load and adr with the address it names (the pool word or the adr target). The PC-relative
 * ones are the references codeRefs (core/model/labels.ts) names (test/unit/layout/refs-agree.test.ts checks it on
 * every committed fixture), so a border none of them crosses never leaves
 * the model a PC-relative instruction whose label lies in another object, which `as` cannot assemble (D63). A
 * bl half never looks like any of the Thumb forms (foundation/isa thumbMayName), so every halfword of a Thumb
 * span is a candidate; an ARM span is decoded word by word.
 */
export function borderRefs(rom: Rom, analysis: Pick<AnalysisResult, 'functions'>): BorderRefs {
  const shortBranches: ShortBranch[] = [];
  const pcRelative: ShortBranch[] = [];
  const pcRef = (site: Addr, flow: Flow): void => {
    if (flow.kind === 'pool-load') pcRelative.push({ site, target: flow.pool });
    else if (flow.kind === 'adr') pcRelative.push({ site, target: flow.target });
  };
  for (const f of analysis.functions) {
    for (const span of f.code) {
      const end = Math.min(span.end, rom.end);
      if (f.mode === 'arm') {
        for (let a = alignWord(Math.max(span.start, rom.base)); a + 4 <= end; a += 4) pcRef(a, decode('arm', peek32(rom, a), a).flow);
        continue;
      }
      for (let a = Math.max(span.start, rom.base); a + 2 <= end; a += 2) {
        const hw = peek16(rom, a);
        if (!thumbMayName(hw)) continue;
        const flow = decode('thumb', hw, a).flow;
        if (flow.kind === 'branch') shortBranches.push({ site: a, target: flow.target });
        else pcRef(a, flow);
      }
    }
  }
  return { shortBranches, pcRelative };
}

