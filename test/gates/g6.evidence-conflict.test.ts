// g6.evidence-conflict (architecture §7.4, §13, D9): contradicting facts give W_EVIDENCE_CONFLICT and change
// nothing. On every committed fixture with two found functions F and G, starting from a trace that only
// says G's first instruction executed (the unrelated fact U), two contradictions about F are merged:
//   - across sources: the trace says F's first halfword executed in F's mode, an ELF source says F is an
//     entry in the other mode;
//   - inside one source: the trace says the same bytes of F executed in both modes.
// Each time mergeEvidence must report W_EVIDENCE_CONFLICT at F (its addr, span or cites), and return
// exactly the seeds and proposals it returns for U alone: a contradiction is reported, never resolved.
//
// Calls, for the phase-6 lead to align (architecture §3.3, §7.4):
//   mergeEvidence(sources, analysis) -> {seeds, proposals, conflicts: Diagnostic[]}
//   romFromBytes, sha1Of, profileById('agbcc'), analyze(rom, profile, {mode: 'discover', seeds: [],
//   overrides: [], trail: 'off'}) -> {functions: [{entry, mode, …}], …}
import { readFile } from 'node:fs/promises';
import { gate } from './gate.ts';

type Mode = 'thumb' | 'arm';

interface Span {
  readonly start: number;
  readonly end: number;
}

type EvidenceFact =
  | { readonly kind: 'entry'; readonly addr: number; readonly mode?: Mode }
  | { readonly kind: 'executed'; readonly span: Span; readonly mode: Mode };

interface EvidenceSource {
  readonly id: 'trace' | 'elf' | 'map' | 'legacy';
  readonly facts: readonly EvidenceFact[];
}

interface Diagnostic {
  readonly code: string;
  readonly addr?: number;
  readonly span?: Span;
  readonly cites?: readonly number[];
}

interface Merged {
  readonly seeds: readonly unknown[];
  readonly proposals: readonly unknown[];
  readonly conflicts: readonly Diagnostic[];
}

interface Rom {
  readonly sha1: string;
}

interface AnalysisResult {
  readonly functions: readonly { readonly entry: number; readonly mode: Mode }[];
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (rom: Rom, profile: object, options: { readonly mode: 'discover'; readonly seeds: readonly never[]; readonly overrides: readonly never[]; readonly trail: 'off' }) => AnalysisResult;
type MergeEvidence = (sources: readonly EvidenceSource[], analysis: AnalysisResult) => Merged;

function other(mode: Mode): Mode {
  return mode === 'thumb' ? 'arm' : 'thumb';
}

function width(mode: Mode): number {
  return mode === 'thumb' ? 2 : 4;
}

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function at(d: Diagnostic, addr: number): boolean {
  return d.addr === addr || (d.span !== undefined && d.span.start <= addr && addr < d.span.end) || (d.cites ?? []).includes(addr);
}

gate({
  id: 'g6.evidence-conflict',
  phase: 6,
  tier: 'ci',
  needs: ['mergeEvidence', 'parseTrace', 'romFromBytes', 'sha1Of', 'profileById', 'analyze'],
  async run(cx) {
    const merge = cx.need<MergeEvidence>('mergeEvidence');
    const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
    const sha1Of = cx.need<Sha1Of>('sha1Of');
    const analyze = cx.need<Analyze>('analyze');
    const profile = cx.need<ProfileById>('profileById')('agbcc');
    if (profile === undefined) throw new Error("profileById('agbcc') returned nothing");
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');

    const problems: string[] = [];
    let cases = 0;
    for (const fixture of cx.fixtures) {
      const bytes = new Uint8Array(await readFile(fixture.rom));
      const analysis = analyze(romFromBytes(bytes, sha1Of(bytes)), profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
      const [f, g] = analysis.functions;
      if (f === undefined || g === undefined) continue;
      const unrelated: EvidenceFact = { kind: 'executed', span: { start: g.entry, end: g.entry + width(g.mode) }, mode: g.mode };
      const executedF: EvidenceFact = { kind: 'executed', span: { start: f.entry, end: f.entry + width(f.mode) }, mode: f.mode };
      const executedOther: EvidenceFact = { kind: 'executed', span: { start: f.entry, end: f.entry + width(f.mode) }, mode: other(f.mode) };
      const expected = merge([{ id: 'trace', facts: [unrelated] }], analysis);
      const scenarios: readonly { readonly label: string; readonly sources: readonly EvidenceSource[] }[] = [
        { label: 'trace against ELF', sources: [{ id: 'trace', facts: [unrelated, executedF] }, { id: 'elf', facts: [{ kind: 'entry', addr: f.entry, mode: other(f.mode) }] }] },
        { label: 'one trace, two modes', sources: [{ id: 'trace', facts: [unrelated, executedF, executedOther] }] },
      ];
      for (const scenario of scenarios) {
        cases++;
        const merged = merge(scenario.sources, analysis);
        const label = `${fixture.name} (${scenario.label}, ${hex(f.entry)})`;
        if (!merged.conflicts.some((d) => d.code === 'W_EVIDENCE_CONFLICT' && at(d, f.entry))) problems.push(`${label}: no W_EVIDENCE_CONFLICT at the contradicted address`);
        if (JSON.stringify(merged.seeds) !== JSON.stringify(expected.seeds)) problems.push(`${label}: the contradiction changed the seeds`);
        if (JSON.stringify(merged.proposals) !== JSON.stringify(expected.proposals)) problems.push(`${label}: the contradiction changed the proposals`);
      }
    }
    if (cases === 0) problems.push('no fixture has two found functions');
    if (problems.length > 0) throw new Error(`evidence conflicts: ${problems.join(' | ')}`);
    cx.note(`${cases} contradictions on ${cx.fixtures.length} fixtures give W_EVIDENCE_CONFLICT and change no seed or proposal`);
  },
});
