// The proposal screen (architecture §7.4, D9, D91 d, D93; roadmap 6.D): checkProposals and what it reads, nothing else
// (the signature layer that feeds it is signature-layer.ts, architecture-1). checkProposals screens proposals, in order, against the discover analysis and, when there is one, the config. A
// proposal contradicts
//   - the analysis when it places a function where the analysis found a function of the other mode, or on bytes the
//     analysis claims as a pool, a table or data (its entry instruction), or a table over bytes it claims as code;
//   - the config when the config lists the address in the other mode, a [[overrides]] entry of kind "data" covers a
//     proposed function's entry, one of kind "code" overlaps a proposed table, or a module border it proposes lies
//     strictly inside a runs_at range (a library region would cut code that runs from RAM, §6.7);
//   - the config or an earlier kept proposal when it gives a name another address already has (a function, a symbol
//     or an alias of either), which the model would refuse (E_NAME_COLLISION).
// Each contradicting proposal is one W_EVIDENCE_CONFLICT warning at its address, naming both sides, and is dropped;
// every other proposal is kept unchanged, in its input order. A contradiction is reported, never resolved. Pure.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Addr, Span } from '../../foundation/rom/span.ts';
import { insnUnit } from '../../foundation/rom/span.ts';
import { lowerBound } from '../../foundation/util/arrays.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { sortedEntries } from '../../foundation/util/sorted.ts';
import { Claim, claimName, functionAt } from '../analysis/types.ts';
import type { AnalysisResult, ClaimKind, ClaimRun } from '../analysis/types.ts';
import { listedEntries } from '../config/schema.ts';
import type { RomliftConfig } from '../config/schema.ts';
import { runsAtSpans } from '../model/modules.ts';
import type { Proposal, ProposalSource } from '../proposals/types.ts';
import { WorkflowCodes } from './codes.ts';
import type { CheckProposalsContext, ProposalCheck } from './types.ts';

// ---------------------------------------------------------------------------------------------------
// The screen.

/** The bytes the analysis claims as data a function cannot start on. */
const NOT_CODE: ReadonlySet<ClaimKind> = new Set<ClaimKind>([Claim.pool, Claim.table, Claim.data]);

/** Who made a proposal, as a contradiction names it. */
function sourceText(source: ProposalSource): string {
  switch (source.kind) {
    case 'signature':
      return `the signature ${source.library}@${source.version} (${source.rule})`;
    case 'analysis':
      return `the analysis (${source.rule})`;
    case 'layout':
      return `module inference (${source.reason})`;
  }
}

/** The address a proposal is about: its entry, symbol address, module start or override start. */
export function proposalAddr(p: Proposal): Addr {
  switch (p.kind) {
    case 'function':
    case 'symbol':
      return p.addr;
    case 'module':
      return p.start;
    case 'override':
      return p.span.start;
  }
}

/** What a proposal says, as a contradiction names it. */
function proposalText(p: Proposal): string {
  switch (p.kind) {
    case 'function':
      return `${p.name ?? 'a function'} as a ${p.mode} function at ${hexAddr(p.addr)}`;
    case 'symbol':
      return `the ${p.type === 'pointers' ? 'pointer table' : 'table'} ${p.name} at ${hexAddr(p.addr)}`;
    case 'module':
      return `the module ${p.name} at ${hexAddr(p.start)}`;
    case 'override':
      return `a ${p.overrideKind} override [${hexAddr(p.span.start)}, ${hexAddr(p.span.end)})`;
  }
}

/** The claim runs of `claims` (sorted, disjoint) that overlap `span`. */
function claimsOver(claims: readonly ClaimRun[], span: Span): readonly ClaimRun[] {
  const out: ClaimRun[] = [];
  for (let i = lowerBound(claims, span.start + 1, (c) => c.span.end); i < claims.length; i++) {
    const c = claims[i];
    if (c === undefined || c.span.start >= span.end) break;
    out.push(c);
  }
  return out;
}

/** One side a proposal contradicts: what it says, and where (for the diagnostic's span and cites). */
interface Contradiction {
  readonly text: string;
  readonly at?: Addr;
  readonly span?: Span;
}

/** What the discover analysis says against `p`. */
function againstAnalysis(p: Proposal, analysis: AnalysisResult): readonly Contradiction[] {
  if (p.kind === 'function') {
    const found = functionAt(analysis.functions, p.addr);
    if (found !== undefined && found.mode !== p.mode) {
      return [
        {
          text: `the analysis found a ${found.mode} function there (${found.accepted.rule})`,
          at: found.entry,
          span: found.extent,
        },
      ];
    }
    const entry = { start: p.addr, end: p.addr + insnUnit(p.mode) };
    const data = claimsOver(analysis.claims, entry).find((c) => NOT_CODE.has(c.kind));
    if (data !== undefined)
      return [
        {
          text: `the analysis claims [${hexAddr(data.span.start)}, ${hexAddr(data.span.end)}) as ${claimName(data.kind)}`,
          at: data.span.start,
          span: data.span,
        },
      ];
    return [];
  }
  if (p.kind === 'symbol') {
    const span = { start: p.addr, end: p.addr + Math.max(p.size ?? 1, 1) };
    const code = claimsOver(analysis.claims, span).find((c) => c.kind === Claim.code);
    if (code !== undefined) {
      const owner = code.owner === undefined ? '' : ` of the function at ${hexAddr(code.owner)}`;
      return [
        {
          text: `the analysis claims [${hexAddr(code.span.start)}, ${hexAddr(code.span.end)}) as code${owner}`,
          at: code.owner ?? code.span.start,
          span: code.span,
        },
      ];
    }
  }
  return [];
}

/** Whether [a, b) and `span` overlap. */
function overlaps(a: Addr, b: Addr, span: Span): boolean {
  return a < span.end && span.start < b;
}

/** What the config says against `p`. */
function againstConfig(p: Proposal, config: RomliftConfig): readonly Contradiction[] {
  const out: Contradiction[] = [];
  if (p.kind === 'function') {
    const listed = listedEntries(config).get(p.addr);
    if (listed !== undefined && listed.mode !== p.mode)
      out.push({ text: `romlift.toml lists ${listed.name} there as a ${listed.mode} function`, at: p.addr });
    for (const o of config.overrides) {
      const span = { start: o.start, end: o.start + o.size };
      if (o.kind === 'data' && p.addr >= span.start && p.addr < span.end)
        out.push({
          text: `a data override of romlift.toml covers [${hexAddr(span.start)}, ${hexAddr(span.end)})`,
          at: o.start,
          span,
        });
    }
  } else if (p.kind === 'symbol') {
    const end = p.addr + Math.max(p.size ?? 1, 1);
    for (const o of config.overrides) {
      const span = { start: o.start, end: o.start + o.size };
      if (o.kind === 'code' && overlaps(p.addr, end, span))
        out.push({
          text: `a code override of romlift.toml covers [${hexAddr(span.start)}, ${hexAddr(span.end)})`,
          at: o.start,
          span,
        });
    }
  } else if (p.kind === 'module') {
    for (const span of runsAtSpans(config)) {
      if (p.start > span.start && p.start < span.end) {
        out.push({
          text: `it would cut the runs_at range [${hexAddr(span.start)}, ${hexAddr(span.end)}) of romlift.toml, which is its own module`,
          at: span.start,
          span,
        });
      }
    }
  }
  return out;
}

/** The name a function or symbol proposal gives, when it gives one. */
function proposedName(p: Proposal): string | undefined {
  return p.kind === 'function' || p.kind === 'symbol' ? p.name : undefined;
}

/** Every name the config gives to an address: functions, symbols and their aliases. */
function configNames(config: RomliftConfig | undefined): Map<string, Addr> {
  const names = new Map<string, Addr>();
  if (config === undefined) return names;
  for (const [addr, f] of sortedEntries(listedEntries(config)))
    for (const n of [f.name, ...f.aliases]) if (!names.has(n)) names.set(n, addr);
  for (const [addr, s] of sortedEntries(config.symbols))
    for (const n of [s.name, ...s.aliases]) if (!names.has(n)) names.set(n, addr);
  return names;
}

/**
 * The screen (architecture §7.4, CheckProposals of types.ts): the proposals that contradict neither the analysis nor
 * the config, in their input order, and one W_EVIDENCE_CONFLICT per proposal that does (see the header).
 */
export function checkProposals(proposals: readonly Proposal[], cx: CheckProposalsContext): ProposalCheck {
  const kept: Proposal[] = [];
  const conflicts: Diagnostic[] = [];
  const names = configNames(cx.config);
  for (const p of proposals) {
    const addr = proposalAddr(p);
    const found: Contradiction[] = [
      ...againstAnalysis(p, cx.analysis),
      ...(cx.config === undefined ? [] : againstConfig(p, cx.config)),
    ];
    const name = proposedName(p);
    const holder = name === undefined ? undefined : names.get(name);
    if (name !== undefined && holder !== undefined && holder !== addr)
      found.push({ text: `the name ${name} is already given to ${hexAddr(holder)}`, at: holder });
    if (found.length === 0) {
      kept.push(p);
      if (name !== undefined && holder === undefined) names.set(name, addr);
      continue;
    }
    const first = found[0];
    const cites = [addr, ...found.flatMap((c) => (c.at === undefined || c.at === addr ? [] : [c.at]))].filter(
      (a, i, all) => all.indexOf(a) === i,
    );
    const message = `${sourceText(p.source)} proposes ${proposalText(p)}, but ${found.map((c) => c.text).join('; and ')}; the proposal is dropped`;
    conflicts.push(
      diagnostic(WorkflowCodes, 'W_EVIDENCE_CONFLICT', message, {
        addr,
        ...(first?.span === undefined ? {} : { span: first.span }),
        cites,
      }),
    );
  }
  return { kept, conflicts };
}
