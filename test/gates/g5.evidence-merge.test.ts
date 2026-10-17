// g5.evidence-merge (architecture §6.6, §7.4, §13, D9): legacy, ELF and map sources reach seeds and
// proposals only through mergeEvidence. Two checks:
//   - by structure, over every import of src/**: only core/workflow/** and the src/api barrels import
//     core/evidence/merge.ts; core/legacy/** and shell/evidence/** produce facts only, so they import
//     neither core/proposals/** nor core/analysis/**; and the seed rule 'seed.evidence-hint' is written
//     nowhere outside core/analysis/** and core/evidence/merge.ts;
//   - by behaviour, on every committed fixture: `romlift analyze <rom> --evidence elf <elf> --json` reports
//     exactly the seeds and proposals that mergeEvidence([readEvidence('elf', <elf>)], <discover analysis>)
//     returns in process.
//
// Expected interfaces, for the phase-5 lead to align (architecture §2.1, §7.4):
//   mergeEvidence(sources, analysis) -> {seeds, proposals, conflicts}
//   readEvidence(kind: 'elf'|'map'|'cfg', file) (romlift/node) -> Promise<{ok: true, value: EvidenceSource}
//     | {ok: false, diagnostic}>
//   romFromBytes, sha1Of, profileById('agbcc'), analyze(rom, profile, {mode: 'discover', seeds: [],
//     overrides: [], trail: 'off'})
//   analyze <rom> --evidence elf <path> --json prints, besides its other lines, one {"type":"seed",
//     "seed": Seed} line per merged seed and one {"type":"proposal","proposal": Proposal} line per proposal,
//     in the order mergeEvidence returns them, then the summary.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface Rom {
  readonly sha1: string;
}

interface EvidenceSource {
  readonly id: string;
  readonly facts: readonly unknown[];
}

interface Merged {
  readonly seeds: readonly unknown[];
  readonly proposals: readonly unknown[];
  readonly conflicts: readonly unknown[];
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (rom: Rom, profile: object, options: { readonly mode: 'discover'; readonly seeds: readonly never[]; readonly overrides: readonly never[]; readonly trail: 'off' }) => object;
type MergeEvidence = (sources: readonly EvidenceSource[], analysis: object) => Merged;
type ReadEvidence = (kind: 'elf' | 'map' | 'cfg', file: string) => Promise<{ readonly ok: true; readonly value: EvidenceSource } | { readonly ok: false; readonly diagnostic: { readonly message: string } }>;

interface CliLine {
  readonly type: string;
  readonly seed?: unknown;
  readonly proposal?: unknown;
  readonly exitCode?: number;
}

const IMPORT = /\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm;

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function sourceFiles(dir: string, prefix = ''): Promise<readonly string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await sourceFiles(dir, relative)));
    else if (entry.name.endsWith('.ts')) out.push(relative);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every relative import of `file` (relative to src/), resolved to a path relative to src/. */
function importsOf(file: string, text: string): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier === undefined || !specifier.startsWith('.')) continue;
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
  }
  return out;
}

async function structureProblems(src: string): Promise<readonly string[]> {
  const problems: string[] = [];
  let mergeExists = false;
  for (const file of await sourceFiles(src)) {
    const text = await readFile(path.join(src, file), 'utf8');
    if (file === 'core/evidence/merge.ts') mergeExists = true;
    for (const target of importsOf(file, text)) {
      if (target === 'core/evidence/merge.ts' && !file.startsWith('core/workflow/') && !file.startsWith('api/')) problems.push(`${file} imports core/evidence/merge.ts`);
      const producer = file.startsWith('core/legacy/') || file.startsWith('shell/evidence/');
      if (producer && (target.startsWith('core/proposals/') || target.startsWith('core/analysis/'))) problems.push(`${file} (a fact producer) imports ${target}`);
    }
    if (text.includes("'seed.evidence-hint'") && !file.startsWith('core/analysis/') && file !== 'core/evidence/merge.ts') problems.push(`${file} writes the seed rule 'seed.evidence-hint'`);
  }
  if (!mergeExists) problems.push('src/core/evidence/merge.ts does not exist');
  return problems;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function behaviourProblem(cx: GateContext, rom: string, elf: string, name: string): Promise<string | undefined> {
  const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
  const sha1Of = cx.need<Sha1Of>('sha1Of');
  const profile = cx.need<ProfileById>('profileById')('agbcc');
  if (profile === undefined) throw new Error("profileById('agbcc') returned nothing");
  const bytes = new Uint8Array(await readFile(rom));
  const analysis = cx.need<Analyze>('analyze')(romFromBytes(bytes, sha1Of(bytes)), profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
  const source = await cx.need<ReadEvidence>('readEvidence')('elf', elf);
  if (!source.ok) return `readEvidence('elf') failed: ${source.diagnostic.message}`;
  const merged = cx.need<MergeEvidence>('mergeEvidence')([source.value], analysis);

  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', cli, 'analyze', rom, '--evidence', 'elf', elf, '--json'], { cwd: path.dirname(rom) });
  if (run.code !== 0) return `analyze --evidence elf exited ${run.code}:\n${tail(run)}`;
  const lines = cx.jsonLines<CliLine>(run.stdout);
  const seeds = lines.filter((l) => l.type === 'seed').map((l) => l.seed);
  const proposals = lines.filter((l) => l.type === 'proposal').map((l) => l.proposal);
  if (merged.seeds.length === 0 && merged.proposals.length === 0) return `mergeEvidence returned nothing for ${name}'s ELF`;
  if (JSON.stringify(seeds) !== JSON.stringify(merged.seeds)) return `the CLI reports ${seeds.length} seeds, mergeEvidence ${merged.seeds.length} (or they differ)`;
  if (JSON.stringify(proposals) !== JSON.stringify(merged.proposals)) return `the CLI reports ${proposals.length} proposals, mergeEvidence ${merged.proposals.length} (or they differ)`;
  return undefined;
}

gate({
  id: 'g5.evidence-merge',
  phase: 5,
  tier: 'ci',
  needs: ['mergeEvidence', 'readEvidence', 'importLegacy', 'romFromBytes', 'sha1Of', 'profileById', 'analyze'],
  async run(cx) {
    const problems: string[] = [...(await structureProblems(path.join(cx.repoRoot, 'src')))];
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    let checked = 0;
    for (const fixture of cx.fixtures) {
      if (!(await exists(fixture.elf))) continue;
      const problem = await behaviourProblem(cx, fixture.rom, fixture.elf, fixture.name);
      if (problem !== undefined) problems.push(`${fixture.name}: ${problem}`);
      checked++;
    }
    if (checked === 0) problems.push('no fixture has a committed ELF');
    if (problems.length > 0) throw new Error(`evidence bypasses mergeEvidence: ${problems.join(' | ')}`);
    cx.note(`imports keep evidence behind mergeEvidence; analyze --evidence elf equals mergeEvidence on ${checked} fixtures`);
  },
});
