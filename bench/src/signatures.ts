// `bench signatures [--only <rom>] [--loo] [--json]` and the signatures family of `bench run` (architecture §7.2,
// §8.4 "Signatures", §8.5, D24, D25, D31, D32, D37, roadmap 6.B). The bench always scores a seedless discover run and
// judges the signatures afterwards, on that same run (D24): the locally built signature files (signatures/*.json,
// gitignored, D40; refused with the build loop named when there are none) are matched on the ROM
// (matchSignatures), settled (resolvePlacements) and turned into proposals (proposeFromSignatures), all through
// romlift's entry points (D37), then judged against the reference ELF:
//
// - a function placement is `atElfFunc` (an ELF FUNC starts there), `atUntyped` (the dataset lists the address as
//   `untyped`) or `wrong`;
// - a table placement is `objectOfSize` (an ELF OBJECT of the table's size starts there), `label` (no OBJECT starts
//   there, another symbol does: FUNC, OBJECT or NOTYPE, a mapping symbol `$a`, `$t`, `$d` naming no data) or `wrong`
//   (nothing names it, or only OBJECTs of another size);
// - every `size` a function proposal carries (a signature restoring an extent the analysis split) is `equal` to the
//   ELF FUNC's size there with the 4-byte padding allowance (the two sizes are equal, or one is the other rounded up
//   to a multiple of 4: the padding after a function counted on one side only), else `differ`; a size is `unjudged`
//   where the ELF gives none: no FUNC starts there, the FUNC is unsized, or its size runs over the start of another
//   FUNC (a `.size` closing a whole hand-written file, m4a's ld_r3_tp_adr_i), which no single function's extent is;
// - on a ROM that is a reference of a placed version (a `references[].dataset` naming it), each such placement's
//   member symbol (its MemberId before '@') is `equal` when an ELF symbol of that name starts at the placement, else
//   `differ`; `reviewed` counts the placements whose display name is not their member symbol (a reviewed name,
//   reported, never gated).
//
// A sealed held-out dataset (D25) reports counts only, never an address or a name (seal.ts assertCountsOnly guards
// every entry): its function placements are `atElfFunc`, `untyped` when the ELF-checkable classifiers of §8.4
// (classify.ts classifyFalseEntry over the same run) put the address in a class other than `other`, or `wrong`; its
// tables `object`, `label` or `wrong` as above.
//
// `--loo` (D31): for every version that names two or more references in signatures/specs/*.json, and each of its
// references R, the version is rebuilt in memory without R (buildSignatures with the spec less R) and matched on R's
// ROM beside the other built files; against the full build's placements of that version there it counts `added`
// (members placed only without R), `moved` (placed at another address) and `missingShared` (members R's link order
// shares with another reference's that the rebuilt version does not place). The command exits 0 whenever the run
// completes; the gates (g6.signatures-judged, -heldout, -loo) judge the counts.
import { join } from 'node:path';

import {
  compareCodeUnits,
  hexAddr,
  matchSignatures,
  parseElf,
  proposeFromSignatures,
  resolvePlacements,
  ROM_BASE,
  signatureFileText,
  type AnalysisResult,
  type ElfSymbol,
  type LibraryRegion,
  type MemberId,
  type Proposal,
  type Rom,
  type SignatureFile,
  type SignaturePlacement,
  type SignatureSpec,
} from 'romlift';
import { buildSignatures, locateSignatures, readSignatureSpec, sha256Of } from 'romlift/node';

import { analysisTuning, benchProfile, discoverOptions, DEFAULT_RUN_TUNING, readRealInputs, sealedInput, type AnalysisRunner, type RealInputs } from './analysis-run.ts';
import { classifier, classifyFalseEntry } from './classify.ts';
import type { BenchContext } from './context.ts';
import { isSealed, loadDatasets, rowAddr, type Dataset } from './dataset.ts';
import { BenchError, isDirectory, listFiles, readFileBytes } from './files.ts';
import { assertCountsOnly } from './seal.ts';

export const BENCH_SIGNATURES_SCHEMA = 'romlift/bench-signatures@1';
export const BENCH_SIGNATURES_LOO_SCHEMA = 'romlift/bench-signatures-loo@1';

/** The loop that builds every signature file locally (the phase-6 exit list, D93 i). */
export const SIGNATURES_BUILD_LOOP = 'for s in signatures/specs/*.json; do node --conditions=source src/cli/main.ts signatures build "$s"; done';

// ---------------------------------------------------------------------------------------------------
// The judged counts (pure).

/** What one library version placed on a ROM. */
export interface LibraryPlacements {
  readonly library: string;
  readonly version: string;
  readonly functions: number;
  readonly objects: number;
}

/** The signatures family of one tuning ROM: the judged counts, as a row of results.json and `bench signatures` hold them. */
export interface SignaturesMember {
  /** Per library version with at least one placement, sorted by library, then version (code units). */
  readonly libraries: readonly LibraryPlacements[];
  readonly placements: { readonly total: number; readonly atElfFunc: number; readonly atUntyped: number; readonly wrong: number };
  readonly tables: { readonly total: number; readonly objectOfSize: number; readonly label: number; readonly wrong: number };
  readonly sizes: { readonly proposed: number; readonly equal: number; readonly differ: number; readonly unjudged: number };
  readonly names: { readonly reference: boolean; readonly total: number; readonly equal: number; readonly differ: number; readonly reviewed: number };
}

/** One tuning ROM's judged signatures (`roms[]` of romlift/bench-signatures@1). */
export type JudgedRom = { readonly name: string } & SignaturesMember;

/** One sealed ROM's counts (`sealed[]` of romlift/bench-signatures@1): never an address or a name (D25). */
export interface SealedSignatures {
  readonly name: string;
  readonly placements: { readonly total: number; readonly atElfFunc: number; readonly untyped: number; readonly wrong: number };
  readonly tables: { readonly total: number; readonly object: number; readonly label: number; readonly wrong: number };
}

/** The ELF's symbols inside the ROM, indexed by address for the judging. */
export interface ElfIndex {
  /** The largest size of the FUNC symbols starting at each address (0 for an unsized one). */
  readonly funcSize: ReadonlyMap<number, number>;
  /** The FUNC addresses whose size runs over the start of another FUNC: their size is no function's extent. */
  readonly spanning: ReadonlySet<number>;
  /** The sizes of the OBJECT symbols starting at each address. */
  readonly objectSizes: ReadonlyMap<number, readonly number[]>;
  /** The names of the FUNC, OBJECT and NOTYPE symbols starting at each address, mapping symbols excepted. */
  readonly names: ReadonlyMap<number, ReadonlySet<string>>;
}

/** An ARM ELF mapping symbol (`$a`, `$t`, `$d`, optionally `.`-suffixed): it marks a code or data run and names nothing. */
export function isMappingSymbol(name: string): boolean {
  return /^\$[atd](\..*)?$/.test(name);
}

/** The index of `symbols` inside `[ROM_BASE, ROM_BASE + romSize)`. */
export function elfIndex(symbols: readonly ElfSymbol[], romSize: number): ElfIndex {
  const end = ROM_BASE + romSize;
  const funcSize = new Map<number, number>();
  const objectSizes = new Map<number, number[]>();
  const names = new Map<number, Set<string>>();
  for (const s of symbols) {
    if (s.addr < ROM_BASE || s.addr >= end) continue;
    if (s.type !== 'func' && s.type !== 'object' && s.type !== 'notype') continue;
    if (s.type === 'func') funcSize.set(s.addr, Math.max(s.size, funcSize.get(s.addr) ?? 0));
    if (s.type === 'object') {
      const sizes = objectSizes.get(s.addr);
      if (sizes === undefined) objectSizes.set(s.addr, [s.size]);
      else sizes.push(s.size);
    }
    if (isMappingSymbol(s.name)) continue;
    const at = names.get(s.addr);
    if (at === undefined) names.set(s.addr, new Set([s.name]));
    else at.add(s.name);
  }
  const starts = [...funcSize.keys()].sort((a, b) => a - b);
  const spanning = new Set<number>();
  for (let i = 0; i + 1 < starts.length; i++) {
    const addr = starts[i] ?? 0;
    if (addr + (funcSize.get(addr) ?? 0) > (starts[i + 1] ?? 0)) spanning.add(addr);
  }
  return { funcSize, spanning, objectSizes, names };
}

/** `n` rounded up to a multiple of 4. */
function alignUp4(n: number): number {
  return n + ((4 - (n & 3)) & 3);
}

/** Whether an ELF size is a proposed size, allowing the padding to the next 4-byte boundary on either side. */
export function sizeAgrees(elfSize: number, proposed: number): boolean {
  return elfSize === proposed || elfSize === alignUp4(proposed) || alignUp4(elfSize) === proposed;
}

/** The symbol a member id names: the part before its '@'. */
export function memberSymbol(member: MemberId): string {
  return member.slice(0, member.indexOf('@'));
}

export type TableClass = 'object-of-size' | 'label' | 'wrong';

/** A table placement against the ELF: an OBJECT of its size, else a label where no OBJECT starts, else wrong. */
export function classifyTable(elf: ElfIndex, addr: number, size: number): TableClass {
  const sizes = elf.objectSizes.get(addr);
  if (sizes !== undefined) return sizes.includes(size) ? 'object-of-size' : 'wrong';
  return elf.names.has(addr) ? 'label' : 'wrong';
}

/** `library@version`. */
const versionKey = (library: string, version: string): string => `${library}@${version}`;

/** The placements per library version, sorted by library, then version. */
export function libraryPlacements(placements: readonly SignaturePlacement[]): LibraryPlacements[] {
  const counts = new Map<string, { library: string; version: string; functions: number; objects: number }>();
  for (const p of placements) {
    const key = versionKey(p.library, p.version);
    const c = counts.get(key) ?? { library: p.library, version: p.version, functions: 0, objects: 0 };
    if (p.kind === 'function') c.functions++;
    else c.objects++;
    counts.set(key, c);
  }
  return [...counts.values()].sort((x, y) => compareCodeUnits(x.library, y.library) || compareCodeUnits(x.version, y.version));
}

/** The library versions `dataset` is a reference of, as `library@version`. */
export function referenceVersions(files: readonly SignatureFile[], dataset: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const f of files) for (const v of f.versions) if (v.references.some((r) => r.dataset === dataset)) out.add(versionKey(f.library, v.id));
  return out;
}

/** What judgeSignatures reads of one tuning ROM. */
export interface JudgeInput {
  /** The dataset name: whether the ROM is a reference of a placed version is read from the files by it. */
  readonly dataset: string;
  readonly elf: ElfIndex;
  /** The dataset's `untyped` addresses. */
  readonly untyped: ReadonlySet<number>;
  readonly files: readonly SignatureFile[];
  /** The settled placements (resolvePlacements). */
  readonly placements: readonly SignaturePlacement[];
  /** proposeFromSignatures over them. */
  readonly proposals: readonly Proposal[];
}

/** The judged counts of one tuning ROM, and one line per placement, table, size or name the counts hold against it. */
export function judgeSignatures(input: JudgeInput): { readonly member: SignaturesMember; readonly problems: readonly string[] } {
  const { elf } = input;
  const problems: string[] = [];
  const placements = { total: 0, atElfFunc: 0, atUntyped: 0, wrong: 0 };
  const tables = { total: 0, objectOfSize: 0, label: 0, wrong: 0 };
  const references = referenceVersions(input.files, input.dataset);
  const names = { reference: false, total: 0, equal: 0, differ: 0, reviewed: 0 };
  for (const p of input.placements) {
    const where = `${hexAddr(p.addr)} ${p.name} (${p.member}, ${versionKey(p.library, p.version)}, ${p.rule})`;
    if (p.kind === 'function') {
      placements.total++;
      if (elf.funcSize.has(p.addr)) placements.atElfFunc++;
      else if (input.untyped.has(p.addr)) placements.atUntyped++;
      else {
        placements.wrong++;
        problems.push(`placement ${where}: no ELF FUNC there and no untyped row`);
      }
    } else {
      tables.total++;
      const kind = classifyTable(elf, p.addr, p.size);
      if (kind === 'object-of-size') tables.objectOfSize++;
      else if (kind === 'label') tables.label++;
      else {
        tables.wrong++;
        const sizes = elf.objectSizes.get(p.addr);
        problems.push(`table ${where} size ${p.size}: ${sizes === undefined ? 'no symbol there' : `the ELF OBJECT there is of size ${sizes.join(', ')}`}`);
      }
    }
    const symbol = memberSymbol(p.member);
    if (p.name !== symbol) names.reviewed++;
    if (!references.has(versionKey(p.library, p.version))) continue;
    names.reference = true;
    names.total++;
    if (elf.names.get(p.addr)?.has(symbol) === true) names.equal++;
    else {
      names.differ++;
      const there = [...(elf.names.get(p.addr) ?? [])].sort(compareCodeUnits);
      problems.push(`name ${where}: this reference's symbol there is ${there.length === 0 ? 'none' : there.join(', ')}, not ${symbol}`);
    }
  }
  const sizes = { proposed: 0, equal: 0, differ: 0, unjudged: 0 };
  for (const p of input.proposals) {
    if (p.kind !== 'function' || p.size === undefined) continue;
    sizes.proposed++;
    const elfSize = elf.funcSize.get(p.addr);
    if (elfSize === undefined || elfSize === 0 || elf.spanning.has(p.addr)) sizes.unjudged++;
    else if (sizeAgrees(elfSize, p.size)) sizes.equal++;
    else {
      sizes.differ++;
      problems.push(`size ${hexAddr(p.addr)} ${p.name}: proposed ${p.size}, the ELF's ${elfSize}`);
    }
  }
  return { member: { libraries: libraryPlacements(input.placements), placements, tables, sizes, names }, problems };
}

/** What sealedSignatures reads of one sealed ROM. */
export interface SealedJudgeInput {
  readonly name: string;
  readonly elf: ElfIndex;
  readonly placements: readonly SignaturePlacement[];
  /** The class §8.4's ELF-checkable classifiers give a found entry at `addr` that is no ELF FUNC. */
  readonly untypedClass: (addr: number) => string;
}

/** The counts of one sealed ROM: no address, no name (checked by assertCountsOnly). */
export function sealedSignatures(input: SealedJudgeInput): SealedSignatures {
  const placements = { total: 0, atElfFunc: 0, untyped: 0, wrong: 0 };
  const tables = { total: 0, object: 0, label: 0, wrong: 0 };
  for (const p of input.placements) {
    if (p.kind === 'function') {
      placements.total++;
      if (input.elf.funcSize.has(p.addr)) placements.atElfFunc++;
      else if (input.untypedClass(p.addr) !== 'other') placements.untyped++;
      else placements.wrong++;
      continue;
    }
    tables.total++;
    const kind = classifyTable(input.elf, p.addr, p.size);
    if (kind === 'object-of-size') tables.object++;
    else if (kind === 'label') tables.label++;
    else tables.wrong++;
  }
  const entry: SealedSignatures = { name: input.name, placements, tables };
  assertCountsOnly(entry);
  return entry;
}

// ---------------------------------------------------------------------------------------------------
// Leave one reference out (pure).

/** The counts of one leave-one-out run (`runs[]` of romlift/bench-signatures-loo@1). */
export interface LooRun {
  readonly library: string;
  readonly version: string;
  /** The dataset left out, on whose ROM the rebuilt version is matched. */
  readonly reference: string;
  readonly added: number;
  readonly moved: number;
  readonly missingShared: number;
}

/** The members R's link order shares with the link order of another reference of the version. */
export function sharedMembers(version: SignatureFile['versions'][number], reference: string): ReadonlySet<MemberId> {
  const own = new Set<MemberId>();
  const others = new Set<MemberId>();
  for (const order of version.linkOrder) for (const m of order.members) (order.reference === reference ? own : others).add(m.id);
  return new Set([...own].filter((id) => others.has(id)));
}

/**
 * The difference of one version's placements on R's ROM rebuilt without R (`loo`) against the full build's (`full`),
 * both already that version's: members placed only in `loo`, members placed at another address, and the shared
 * members `loo` does not place.
 */
export function looCounts(full: readonly SignaturePlacement[], loo: readonly SignaturePlacement[], shared: ReadonlySet<MemberId>): { readonly added: number; readonly moved: number; readonly missingShared: number } {
  const fullAt = new Map(full.map((p) => [p.member, p.addr] as const));
  const looAt = new Map(loo.map((p) => [p.member, p.addr] as const));
  let added = 0;
  let moved = 0;
  for (const [member, addr] of looAt) {
    const before = fullAt.get(member);
    if (before === undefined) added++;
    else if (before !== addr) moved++;
  }
  let missingShared = 0;
  for (const member of shared) if (!looAt.has(member)) missingShared++;
  return { added, moved, missingShared };
}

/** The spec with `dataset` left out of version `version`'s references. */
export function withoutReference(spec: SignatureSpec, version: string, dataset: string): SignatureSpec {
  return { ...spec, versions: spec.versions.map((v) => (v.id === version ? { ...v, references: v.references.filter((r) => r.dataset !== dataset) } : v)) };
}

/** The (version, reference) pairs of a spec that leave-one-out runs: every reference of every version with two or more. */
export function looPairs(spec: SignatureSpec): readonly { readonly version: string; readonly reference: string }[] {
  return spec.versions.filter((v) => v.references.length >= 2).flatMap((v) => v.references.map((r) => ({ version: v.id, reference: r.dataset })));
}

/** `files` with the file of `replacement`'s library replaced by it. */
export function replaceLibrary(files: readonly SignatureFile[], replacement: SignatureFile): readonly SignatureFile[] {
  return files.map((f) => (f.library === replacement.library ? replacement : f));
}

const ofVersion = (placements: readonly SignaturePlacement[], library: string, version: string): readonly SignaturePlacement[] =>
  placements.filter((p) => p.library === library && p.version === version);

// ---------------------------------------------------------------------------------------------------
// Running the matcher on a scored run.

/** The settled placements, regions and proposals of the built files on a ROM's seedless discover run. */
export interface RomSignatures {
  readonly placements: readonly SignaturePlacement[];
  readonly regions: readonly LibraryRegion[];
  readonly proposals: readonly Proposal[];
}

/** Matches, settles and proposes the built files on `rom` over its discover run `analysis`. */
export function romSignatures(rom: Rom, analysis: AnalysisResult, files: readonly SignatureFile[]): RomSignatures {
  const resolved = resolvePlacements(rom, matchSignatures(rom, analysis, files));
  return { placements: resolved.placements, regions: resolved.regions, proposals: proposeFromSignatures(resolved, analysis) };
}

/** The judged member of one tuning ROM from its scored run (bench run's family and `bench signatures`). */
export function tuningSignatures(inputs: Pick<RealInputs, 'dataset' | 'rom' | 'romSize'>, analysis: AnalysisResult, symbols: readonly ElfSymbol[], files: readonly SignatureFile[]): { readonly member: SignaturesMember; readonly problems: readonly string[] } {
  const found = romSignatures(inputs.rom, analysis, files);
  return judgeSignatures({
    dataset: inputs.dataset.name,
    elf: elfIndex(symbols, inputs.romSize),
    untyped: new Set(inputs.dataset.untyped.map((u) => rowAddr(u.addr))),
    files,
    placements: found.placements,
    proposals: found.proposals,
  });
}

// ---------------------------------------------------------------------------------------------------
// The files and the runs (reads).

/** The built signature files of `<repo>/signatures/`, or undefined when there are none. A file the locator skips is refused. */
export async function locateBuiltSignatures(cx: BenchContext): Promise<readonly SignatureFile[] | undefined> {
  const located = await locateSignatures({ packageRoot: cx.repoRoot, env: {} });
  if (located.diagnostics.length > 0) throw new BenchError(`signatures: ${located.diagnostics.map((d) => d.message).join('; ')}`);
  return located.files.length === 0 ? undefined : located.files;
}

/** The built signature files; refused, naming the build loop, when there are none. */
export async function readBuiltSignatures(cx: BenchContext): Promise<readonly SignatureFile[]> {
  const files = await locateBuiltSignatures(cx);
  if (files === undefined) throw new BenchError(`no built signature file in ${join(cx.repoRoot, 'signatures')}: build them first with\n  ${SIGNATURES_BUILD_LOOP}`);
  return files;
}

/** One digest over the built files' canonical texts, in library order: what the artifact records of them. */
export function signaturesDigest(files: readonly SignatureFile[]): string {
  return sha256Of([...files].sort((a, b) => compareCodeUnits(a.library, b.library)).map(signatureFileText).join('\n'));
}

/** The reference ELF's symbols (readRealInputs checked its digest). */
export async function datasetElfSymbols(cx: BenchContext, d: Dataset): Promise<readonly ElfSymbol[]> {
  const elf = parseElf(await readFileBytes(join(cx.benchRoot, d.elf)));
  if (!elf.ok) throw new BenchError(`${d.name}: ${d.elf}: ${elf.error}`);
  return elf.value.symbols;
}

/** The seedless discover run the bench scores (D24), one run. */
function discoverRun(inputs: Pick<RealInputs, 'rom'>, runner: AnalysisRunner): AnalysisResult {
  return runner.analyze(inputs.rom, benchProfile(), discoverOptions(), analysisTuning(DEFAULT_RUN_TUNING));
}

export interface SignaturesOptions {
  readonly only?: string;
  readonly runner: AnalysisRunner;
  readonly log?: (line: string) => void;
}

/** The --json line of `bench signatures` (frozen by the headers of g6.signatures-judged and g6.signatures-heldout). */
export interface BenchSignaturesReport {
  readonly schema: typeof BENCH_SIGNATURES_SCHEMA;
  readonly roms: readonly JudgedRom[];
  readonly sealed: readonly SealedSignatures[];
}

/** The --json line of `bench signatures --loo` (frozen by the header of g6.signatures-loo). */
export interface BenchSignaturesLooReport {
  readonly schema: typeof BENCH_SIGNATURES_LOO_SCHEMA;
  readonly runs: readonly LooRun[];
}

async function chosenDatasets(cx: BenchContext, only: string | undefined): Promise<readonly Dataset[]> {
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const chosen = only === undefined ? datasets : datasets.filter((d) => d.name === only);
  if (chosen.length === 0) throw new BenchError(only === undefined ? 'no datasets' : `no dataset named ${only}`);
  return chosen;
}

/** One line per tuning ROM: the counts per library and the judged totals. */
export function judgedText(rom: JudgedRom): string {
  const libs = rom.libraries.map((l) => `${l.library}@${l.version} ${l.functions}/${l.objects}`).join(', ') || 'nothing placed';
  const p = rom.placements;
  const t = rom.tables;
  const s = rom.sizes;
  const n = rom.names;
  return (
    `${rom.name.padEnd(12)} ${libs}; placements ${p.total} (ELF FUNC ${p.atElfFunc}, untyped ${p.atUntyped}, wrong ${p.wrong}), ` +
    `tables ${t.total} (OBJECT ${t.objectOfSize}, label ${t.label}, wrong ${t.wrong}), sizes ${s.proposed} (equal ${s.equal}, differ ${s.differ}, unjudged ${s.unjudged}), ` +
    `names ${n.reference ? `${n.total} on a reference (equal ${n.equal}, differ ${n.differ})` : 'not a reference'}, reviewed ${n.reviewed}`
  );
}

/** One line per sealed ROM: counts only. */
export function sealedSignaturesText(s: SealedSignatures): string {
  const p = s.placements;
  const t = s.tables;
  return `${s.name.padEnd(12)} (sealed) placements ${p.total} (ELF FUNC ${p.atElfFunc}, untyped ${p.untyped}, wrong ${p.wrong}), tables ${t.total} (OBJECT ${t.object}, label ${t.label}, wrong ${t.wrong})`;
}

/** The signatures family of every chosen dataset: tuning ROMs judged, sealed ones counted. */
export async function benchSignatures(cx: BenchContext, options: SignaturesOptions): Promise<BenchSignaturesReport> {
  const log = options.log ?? (() => {});
  const files = await readBuiltSignatures(cx);
  const roms: JudgedRom[] = [];
  const sealed: SealedSignatures[] = [];
  for (const d of await chosenDatasets(cx, options.only)) {
    const inputs = await readRealInputs(cx, d);
    const symbols = await datasetElfSymbols(cx, d);
    if (isSealed(d)) {
      let entry: SealedSignatures;
      try {
        entry = sealedRun(inputs, symbols, files, options.runner);
      } catch {
        throw new BenchError(`${d.name}: the sealed signatures run failed (detail withheld: sealed)`);
      }
      sealed.push(entry);
      log(sealedSignaturesText(entry));
      continue;
    }
    const judged = tuningSignatures(inputs, discoverRun(inputs, options.runner), symbols, files);
    const rom: JudgedRom = { name: d.name, ...judged.member };
    roms.push(rom);
    log(judgedText(rom));
    for (const problem of judged.problems) log(`  ${problem}`);
  }
  return { schema: BENCH_SIGNATURES_SCHEMA, roms: roms.sort((a, b) => compareCodeUnits(a.name, b.name)), sealed: sealed.sort((a, b) => compareCodeUnits(a.name, b.name)) };
}

/** One sealed ROM: its discover run, the placements, the classifiers of §8.4; counts only. */
function sealedRun(inputs: RealInputs, symbols: readonly ElfSymbol[], files: readonly SignatureFile[], runner: AnalysisRunner): SealedSignatures {
  const analysis = discoverRun(inputs, runner);
  const found = romSignatures(inputs.rom, analysis, files);
  const cx = classifier(sealedInput(inputs.dataset.name, inputs, analysis, benchProfile()));
  const origins = new Map(analysis.functions.map((f) => [f.entry, f.origin as string] as const));
  return sealedSignatures({
    name: inputs.dataset.name,
    elf: elfIndex(symbols, inputs.romSize),
    placements: found.placements,
    untypedClass: (addr) => classifyFalseEntry(cx, { entry: addr, origin: origins.get(addr) ?? '' }),
  });
}

/** The committed specs, signatures/specs/*.json, in file-name order, with their paths. */
async function readSpecs(cx: BenchContext): Promise<readonly { readonly path: string; readonly spec: SignatureSpec }[]> {
  const dir = join(cx.repoRoot, 'signatures', 'specs');
  if (!(await isDirectory(dir))) throw new BenchError(`no ${dir}`);
  const out: { path: string; spec: SignatureSpec }[] = [];
  for (const name of (await listFiles(dir)).filter((n) => !n.includes('/') && n.endsWith('.json')).sort(compareCodeUnits)) {
    const path = join(dir, name);
    const read = await readSignatureSpec(path);
    if (!read.ok) throw new BenchError(read.diagnostic.message);
    out.push({ path, spec: read.value });
  }
  return out;
}

/** Leave one reference out over every multi-reference version of the specs. */
export async function benchSignaturesLoo(cx: BenchContext, options: SignaturesOptions): Promise<BenchSignaturesLooReport> {
  const log = options.log ?? (() => {});
  const files = await readBuiltSignatures(cx);
  const { datasets, problems } = await loadDatasets(cx);
  if (problems.length > 0) throw new BenchError(`malformed datasets: ${problems.map((p) => p.detail).join('; ')}`);
  const runs: LooRun[] = [];
  const onRom = new Map<string, { readonly inputs: RealInputs; readonly analysis: AnalysisResult; readonly full: readonly SignaturePlacement[] }>();
  for (const { path, spec } of await readSpecs(cx)) {
    const full = files.find((f) => f.library === spec.library);
    if (full === undefined) throw new BenchError(`no built signature file of ${spec.library}: build them first with\n  ${SIGNATURES_BUILD_LOOP}`);
    for (const { version, reference } of looPairs(spec)) {
      if (options.only !== undefined && options.only !== reference) continue;
      const d = datasets.find((x) => x.name === reference);
      if (d === undefined) throw new BenchError(`${spec.library}@${version}: the reference ${reference} is no bench dataset`);
      if (isSealed(d)) throw new BenchError(`${spec.library}@${version}: the reference ${reference} is sealed (D32)`);
      let rom = onRom.get(reference);
      if (rom === undefined) {
        const inputs = await readRealInputs(cx, d);
        const analysis = discoverRun(inputs, options.runner);
        rom = { inputs, analysis, full: romSignatures(inputs.rom, analysis, files).placements };
        onRom.set(reference, rom);
      }
      const rebuilt = await buildSignatures({ spec: withoutReference(spec, version, reference), specPath: path }, { benchRoot: cx.benchRoot, builtWith: full.builtWith });
      if (!rebuilt.ok) throw new BenchError(`${spec.library}@${version} without ${reference}: ${rebuilt.diagnostic.message}`);
      const fullVersion = full.versions.find((v) => v.id === version);
      if (fullVersion === undefined) throw new BenchError(`the built ${spec.library}.json has no version ${version}: rebuild it with\n  ${SIGNATURES_BUILD_LOOP}`);
      const loo = romSignatures(rom.inputs.rom, rom.analysis, replaceLibrary(files, rebuilt.value)).placements;
      const counts = looCounts(ofVersion(rom.full, spec.library, version), ofVersion(loo, spec.library, version), sharedMembers(fullVersion, reference));
      const run: LooRun = { library: spec.library, version, reference, ...counts };
      runs.push(run);
      log(`${spec.library}@${version} without ${reference}: ${run.added} added, ${run.moved} moved, ${run.missingShared} shared members not placed`);
    }
  }
  return { schema: BENCH_SIGNATURES_LOO_SCHEMA, runs };
}
