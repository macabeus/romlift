// Signatures propose; the TOML decides (architecture §7.3, D9): the settled placements as Proposals with source
// {kind: 'signature', library, version, rule}. A function placement proposes its entry with the signature's name and,
// only where the signature's extent is larger than the analysis function at that entry (the signature restores an
// extent the analysis split), its size; a table proposes a symbol with its size, typed 'pointers' when its words name
// members, else 'bytes'. The folding into the config (label = true inside a restored extent, the library modules) is
// the workflow's (p6-proposals); nothing here knows the config.
import { lowerBound } from '../../foundation/util/arrays.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import type { AnalysisResult, FunctionFact } from '../analysis/types.ts';
import type { Proposal } from '../proposals/types.ts';
import { versionKey } from './match.ts';
import type { ResolvedSignatures } from './resolve.ts';

/** The analysis function whose entry is `addr`. */
function functionAt(functions: readonly FunctionFact[], addr: number): FunctionFact | undefined {
  const f = functions[lowerBound(functions, addr, (g) => g.entry)];
  return f?.entry === addr ? f : undefined;
}

/** The proposals of the settled placements, sorted by address, then kind, then name (code units). */
export function proposeFromSignatures(resolved: Pick<ResolvedSignatures, 'placements' | 'pointerTables'>, analysis: AnalysisResult): readonly Proposal[] {
  const pointers = new Set(resolved.pointerTables.map((t) => `${versionKey(t.library, t.version)}:${t.member}`));
  const out: { readonly addr: number; readonly kind: string; readonly name: string; readonly proposal: Proposal }[] = [];
  for (const p of resolved.placements) {
    const source = { kind: 'signature', library: p.library, version: p.version, rule: p.rule } as const;
    if (p.kind === 'function') {
      const found = functionAt(analysis.functions, p.addr);
      const restores = found !== undefined && p.size > found.extent.end - found.extent.start;
      const proposal: Proposal = { kind: 'function', addr: p.addr, mode: p.mode ?? 'thumb', name: p.name, ...(restores ? { size: p.size } : {}), source };
      out.push({ addr: p.addr, kind: proposal.kind, name: p.name, proposal });
    } else {
      const type = pointers.has(`${versionKey(p.library, p.version)}:${p.member}`) ? 'pointers' : 'bytes';
      const proposal: Proposal = { kind: 'symbol', addr: p.addr, name: p.name, size: p.size, type, source };
      out.push({ addr: p.addr, kind: proposal.kind, name: p.name, proposal });
    }
  }
  out.sort((x, y) => compareNumbers(x.addr, y.addr) || compareCodeUnits(x.kind, y.kind) || compareCodeUnits(x.name, y.name));
  return out.map((o) => o.proposal);
}
