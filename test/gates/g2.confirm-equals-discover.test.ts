// g2.confirm-equals-discover (architecture §4.2, §13, D8): on every tuning ROM, a confirm run seeded with
// exactly the functions a discover run found (entries and modes, `label` for an entry inside another found
// extent, no sizes) gives the same parity view: functions, extents, far `bl` verdicts and claims.
//
// Calls the phase-2 API as frozen in architecture §3.3: romFromBytes(bytes, sha1), sha1Of(bytes),
// profileById('agbcc'), analyze(rom, profile, {mode, seeds, overrides: [], trail: 'off'}); the views are
// compared by the sha256 of their canonical JSON (canonicalJson, sha256Stream).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate } from './gate.ts';

type Mode = 'thumb' | 'arm';

interface Span {
  readonly start: number;
  readonly end: number;
}

interface FunctionFact {
  readonly entry: number;
  readonly mode: Mode;
  readonly extent: Span;
  readonly blVerdicts: readonly { readonly site: number; readonly target: number; readonly verdict: string }[];
}

interface AnalysisResult {
  readonly mode: 'discover' | 'confirm';
  readonly functions: readonly FunctionFact[];
  readonly claims: readonly { readonly span: Span; readonly kind: number; readonly owner?: number }[];
  readonly unlisted?: readonly unknown[];
  readonly listedInvalid?: readonly unknown[];
}

interface Seed {
  readonly entry: number;
  readonly mode: Mode;
  readonly rule: 'seed.listed';
  readonly label?: boolean;
}

interface AnalysisOptions {
  readonly mode: 'discover' | 'confirm';
  readonly seeds: readonly Seed[];
  readonly overrides: readonly never[];
  readonly trail: 'off';
}

interface Rom {
  readonly sha1: string;
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (rom: Rom, profile: object, options: AnalysisOptions) => AnalysisResult;
type CanonicalJson = (value: unknown) => Iterable<string>;
type Sha256Stream = (chunks: Iterable<string>) => string;

function hex(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** The listed set: every found entry and mode; `label` when it lies strictly inside another found extent. */
function listedSeeds(functions: readonly FunctionFact[]): readonly Seed[] {
  const byStart = [...functions].sort((a, b) => a.extent.start - b.extent.start || a.entry - b.entry);
  const byEntry = [...functions].sort((a, b) => a.entry - b.entry);
  // The two largest extent ends among extents that start before the current entry, with their owners.
  let best = { end: -1, entry: -1 };
  let second = { end: -1, entry: -1 };
  let next = 0;
  const seeds: Seed[] = [];
  for (const f of byEntry) {
    for (;;) {
      const g = byStart[next];
      if (g === undefined || g.extent.start >= f.entry) break;
      next++;
      const candidate = { end: g.extent.end, entry: g.entry };
      if (candidate.end > best.end) {
        second = best;
        best = candidate;
      } else if (candidate.end > second.end) {
        second = candidate;
      }
    }
    const enclosingEnd = best.entry !== f.entry ? best.end : second.end;
    const label = enclosingEnd > f.entry;
    seeds.push(label ? { entry: f.entry, mode: f.mode, rule: 'seed.listed', label: true } : { entry: f.entry, mode: f.mode, rule: 'seed.listed' });
  }
  return seeds;
}

function parityView(result: AnalysisResult): { readonly functions: readonly unknown[]; readonly claims: readonly unknown[] } {
  return {
    functions: result.functions.map((f) => ({
      entry: f.entry,
      mode: f.mode,
      extent: { start: f.extent.start, end: f.extent.end },
      far: f.blVerdicts.filter((v) => v.verdict === 'far').map((v) => ({ site: v.site, target: v.target })),
    })),
    claims: result.claims.map((c) => ({ span: { start: c.span.start, end: c.span.end }, kind: c.kind, owner: c.owner })),
  };
}

/** The first function or claim where the two views differ, for the failure message. */
function firstDifference(discover: AnalysisResult, confirm: AnalysisResult): string {
  const a = parityView(discover);
  const b = parityView(confirm);
  if (a.functions.length !== b.functions.length) return `${a.functions.length} functions in discover, ${b.functions.length} in confirm`;
  for (let i = 0; i < a.functions.length; i++) {
    if (JSON.stringify(a.functions[i]) !== JSON.stringify(b.functions[i])) {
      return `function ${hex(discover.functions[i]?.entry ?? 0)}: discover ${JSON.stringify(a.functions[i])}, confirm ${JSON.stringify(b.functions[i])}`;
    }
  }
  if (a.claims.length !== b.claims.length) return `${a.claims.length} claim runs in discover, ${b.claims.length} in confirm`;
  for (let i = 0; i < a.claims.length; i++) {
    if (JSON.stringify(a.claims[i]) !== JSON.stringify(b.claims[i])) return `claim ${i}: discover ${JSON.stringify(a.claims[i])}, confirm ${JSON.stringify(b.claims[i])}`;
  }
  return 'the views differ';
}

gate({
  id: 'g2.confirm-equals-discover',
  phase: 2,
  tier: 'real',
  inputs: ['roms'],
  needs: ['romFromBytes', 'sha1Of', 'profileById', 'analyze', 'canonicalJson', 'sha256Stream'],
  async run(cx) {
    const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
    const sha1Of = cx.need<Sha1Of>('sha1Of');
    const analyze = cx.need<Analyze>('analyze');
    const canonicalJson = cx.need<CanonicalJson>('canonicalJson');
    const sha256Stream = cx.need<Sha256Stream>('sha256Stream');
    const profile = cx.need<ProfileById>('profileById')('agbcc');
    if (profile === undefined) throw new Error("profileById('agbcc') returned undefined");

    const problems: string[] = [];
    const notes: string[] = [];
    for (const dataset of cx.datasets) {
      const bytes = new Uint8Array(await readFile(path.resolve(cx.benchRoot, dataset.rom)));
      const rom = romFromBytes(bytes, sha1Of(bytes));
      const discover = analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
      const seeds = listedSeeds(discover.functions);
      const confirm = analyze(rom, profile, { mode: 'confirm', seeds, overrides: [], trail: 'off' });
      const a = sha256Stream(canonicalJson(parityView(discover)));
      const b = sha256Stream(canonicalJson(parityView(confirm)));
      const labels = seeds.filter((s) => s.label === true).length;
      if (a !== b) problems.push(`${dataset.name}: ${firstDifference(discover, confirm)}`);
      notes.push(`${dataset.name} ${seeds.length} listed (${labels} labels), ${confirm.unlisted?.length ?? 0} unlisted, ${confirm.listedInvalid?.length ?? 0} listed-invalid`);
    }
    if (problems.length > 0) throw new Error(`confirm differs from discover: ${problems.join('; ')}`);
    cx.note(notes.join('; '));
  },
});
