// g6.evidence-conflict (architecture §7.3, §7.4, §13, D9, D91, D92): a proposal that contradicts the analysis or the
// config gives W_EVIDENCE_CONFLICT and changes nothing. Library signatures are the one external source left once the
// gba-kit trace (D91) and phase 5's legacy, ELF and map importers (D92) were dropped, so the gate screens signature
// proposals through checkProposals. On every committed fixture with two found functions F and G, U is a signature
// function proposal at G that agrees with the analysis (G's entry and mode). Each contradiction is checked together
// with U, one at a time:
//   (a) against the analysis: a function proposal at F's entry in the other mode;
//   (b) against the config: a config listing F in its mode, and a proposal at F in the other mode;
//   (c) against the config: a config whose [[overrides]] entry of kind "data" covers F's extent, and a function
//       proposal at F in its mode.
// Each time checkProposals must return a W_EVIDENCE_CONFLICT diagnostic at F (its addr, span or cites) and keep exactly
// the proposals it keeps for U alone under the same context, which must be U, with no conflict: a contradiction is
// reported, never resolved.
//
// Calls, aligned by the phase-6 lead (architecture §3.3, §6.5, §7.4, D93; checkProposals is p6-proposals'):
//   checkProposals(proposals, {analysis, config?}) -> {kept: Proposal[], conflicts: Diagnostic[]}
//   parseConfig(text) -> {ok: true, value: RomliftConfig} | {ok: false, diagnostics}
//   romFromBytes, sha1Of, profileById('agbcc'), analyze(rom, profile, {mode: 'discover', seeds: [],
//   overrides: [], trail: 'off'}) -> {functions: [{entry, mode, extent: {start, end}}, …], …}
import { readFile } from 'node:fs/promises';
import { gate } from './gate.ts';

type Mode = 'thumb' | 'arm';

interface Span {
  readonly start: number;
  readonly end: number;
}

interface SignatureSource {
  readonly kind: 'signature';
  readonly library: string;
  readonly version: string;
  readonly rule: string;
}

interface FunctionProposal {
  readonly kind: 'function';
  readonly addr: number;
  readonly mode: Mode;
  readonly name?: string;
  readonly source: SignatureSource;
}

interface Diagnostic {
  readonly code: string;
  readonly addr?: number;
  readonly span?: Span;
  readonly cites?: readonly number[];
}

interface ProposalCheck {
  readonly kept: readonly unknown[];
  readonly conflicts: readonly Diagnostic[];
}

interface Rom {
  readonly sha1: string;
}

interface FunctionFact {
  readonly entry: number;
  readonly mode: Mode;
  readonly extent: Span;
}

interface AnalysisResult {
  readonly functions: readonly FunctionFact[];
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (rom: Rom, profile: object, options: { readonly mode: 'discover'; readonly seeds: readonly never[]; readonly overrides: readonly never[]; readonly trail: 'off' }) => AnalysisResult;
type ParseConfig = (text: string) => { readonly ok: true; readonly value: object } | { readonly ok: false; readonly diagnostics: readonly { readonly code: string; readonly message: string }[] };
type CheckProposals = (proposals: readonly FunctionProposal[], cx: { readonly analysis: AnalysisResult; readonly config?: object }) => ProposalCheck;

const SOURCE: SignatureSource = { kind: 'signature', library: 'gate', version: '0', rule: 'sig.unique-fit' };

function other(mode: Mode): Mode {
  return mode === 'thumb' ? 'arm' : 'thumb';
}

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function at(d: Diagnostic, addr: number): boolean {
  return d.addr === addr || (d.span !== undefined && d.span.start <= addr && addr < d.span.end) || (d.cites ?? []).includes(addr);
}

/** A schema-1 romlift.toml for the fixture with the given [functions] lines and [[overrides]] blocks. */
function configText(sha1: string, functions: readonly string[], overrides: readonly string[]): string {
  return [
    'schema = 1',
    '',
    '[rom]',
    'path = "baserom.gba"',
    `sha1 = "${sha1}"`,
    '',
    '[build]',
    'name = "gate"',
    'compiler = "agbcc"',
    '',
    '[signatures]',
    'enabled = true',
    '',
    '[functions]',
    ...functions,
    '',
    '[symbols]',
    ...overrides.flatMap((o) => ['', o]),
    '',
  ].join('\n');
}

gate({
  id: 'g6.evidence-conflict',
  phase: 6,
  tier: 'ci',
  needs: ['checkProposals', 'parseConfig', 'romFromBytes', 'sha1Of', 'profileById', 'analyze'],
  async run(cx) {
    const check = cx.need<CheckProposals>('checkProposals');
    const parseConfig = cx.need<ParseConfig>('parseConfig');
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
      const sha1 = sha1Of(bytes);
      const analysis = analyze(romFromBytes(bytes, sha1), profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
      const [f, g] = analysis.functions;
      if (f === undefined || g === undefined) continue;
      const config = (functions: readonly string[], overrides: readonly string[]): object => {
        const parsed = parseConfig(configText(sha1, functions, overrides));
        if (!parsed.ok) throw new Error(`${fixture.name}: the gate's config does not parse: ${parsed.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
        return parsed.value;
      };
      const unrelated: FunctionProposal = { kind: 'function', addr: g.entry, mode: g.mode, name: 'GateSignatureG', source: SOURCE };
      const atF = (mode: Mode): FunctionProposal => ({ kind: 'function', addr: f.entry, mode, name: 'GateSignatureF', source: SOURCE });
      const listedF = `${hex(f.entry)} = { name = "GateListedF", mode = "${f.mode}" }`;
      const dataOverF = `[[overrides]]\nstart = ${hex(f.extent.start)}\nsize = 0x${(f.extent.end - f.extent.start).toString(16).toUpperCase()}\nkind = "data"`;
      const scenarios: readonly { readonly label: string; readonly contradiction: FunctionProposal; readonly config?: object }[] = [
        { label: 'against the analysis: F in the other mode', contradiction: atF(other(f.mode)) },
        { label: 'against the config: F listed in its mode, proposed in the other', contradiction: atF(other(f.mode)), config: config([listedF], []) },
        { label: 'against the config: F under a data override', contradiction: atF(f.mode), config: config([], [dataOverF]) },
      ];
      for (const scenario of scenarios) {
        cases++;
        const context = scenario.config === undefined ? { analysis } : { analysis, config: scenario.config };
        const label = `${fixture.name} (${scenario.label}, ${hex(f.entry)})`;
        const alone = check([unrelated], context);
        if (alone.conflicts.length > 0 || JSON.stringify(alone.kept) !== JSON.stringify([unrelated])) {
          problems.push(`${label}: U alone, which agrees with the analysis, is not kept as it is without a conflict`);
          continue;
        }
        const screened = check([unrelated, scenario.contradiction], context);
        if (!screened.conflicts.some((d) => d.code === 'W_EVIDENCE_CONFLICT' && at(d, f.entry))) problems.push(`${label}: no W_EVIDENCE_CONFLICT at the contradicted address`);
        if (JSON.stringify(screened.kept) !== JSON.stringify(alone.kept)) problems.push(`${label}: the contradiction changed the kept proposals`);
      }
    }
    if (cases === 0) problems.push('no fixture has two found functions');
    if (problems.length > 0) throw new Error(`proposal conflicts: ${problems.join(' | ')}`);
    cx.note(`${cases} contradictions on ${cx.fixtures.length} fixtures give W_EVIDENCE_CONFLICT and keep only what U alone keeps`);
  },
});
