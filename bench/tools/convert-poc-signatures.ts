// `node --conditions=source bench/tools/convert-poc-signatures.ts [--out <dir>]` (architecture §7.1, D31, roadmap 6.A):
// converts the PoC's built signature files (`$ROMLIFT_POC/signatures/<library>.json`, schema 2) to schema 3, one
// `<out>/<library>.json` each (default bench/.local/signatures-poc/, gitignored), so that g6.signatures-rebuild can
// require `romlift signatures build` to reproduce the PoC's validated bytes and masks, apart from the names a spec
// reviews. Never writes into the PoC checkout.
//
// The conversion is mechanical. The PoC's project names become dataset names (kleod -> klonoa, FireEmblem7J -> fe7j,
// the others equal) and its references take the dataset's elfCommit and sha1 (the PoC's ROM SHA-1 must be the
// dataset's). Each member's id is `<symbol>@<object base name>`, where the symbol is the reference ELF's FUNC symbol
// at the member's refAddr (the first global, else the last local one; for a table the OBJECT symbol the PoC named),
// which undoes the PoC's `_2` suffixes, and the object is the map placement holding refAddr. The link order of each
// reference is rebuilt from that reference's own map and ELF with the PoC spec's objects and symbols
// (`$ROMLIFT_POC/signatures/specs/<library>.json`): every member it links, the ones it contributed (the PoC's `ref`) at
// their refAddr and the ones an earlier reference contributed (the same id, or the same global symbol), at their
// address there. A table's `pointers` become `names`: the member id of the function member its reference links at the
// word's address, or null. Bytes, masks, sizes, modes and the member order are the PoC's.
//
// The pure conversion (convertPocFile) is exported for its unit test; main() is the only I/O.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareCodeUnits,
  mapPlacements,
  memberIdOf,
  parseElf,
  parseGnuMap,
  parseSignatureFile,
  signatureFileText,
  type ElfSymbol,
  type LibraryVersion,
  type LinkOrderMember,
  type MapPlacement,
  type MemberId,
  type SignatureFile,
  type SignatureFunction,
  type SignatureTable,
} from 'romlift';
import { sha1Of } from 'romlift/node';

import { parseArgs, UsageError } from '../src/args.ts';
import { contextFromEnv, type BenchContext } from '../src/context.ts';
import { loadDatasets, type Dataset } from '../src/dataset.ts';
import { BenchError, exists, isRecord, listFiles, readFileBytes, readJson, readText } from '../src/files.ts';

const USAGE = 'usage: node --conditions=source bench/tools/convert-poc-signatures.ts [--out <dir>]';

/** The PoC's project names that are not romlift's dataset names. */
export const PROJECT_DATASETS: Readonly<Record<string, string>> = { kleod: 'klonoa', FireEmblem7J: 'fe7j' };

/** The dataset name of a PoC project. */
export function datasetOfProject(project: string): string {
  return PROJECT_DATASETS[project] ?? project;
}

// ---------------------------------------------------------------- the PoC's schema 2

export interface PocMember {
  readonly name: string;
  readonly ref: number;
  readonly refAddr: number;
  readonly size: number;
  readonly bytes: string;
  readonly mask: string;
  readonly mode?: 'thumb' | 'arm';
  readonly pointers?: readonly (string | null)[];
}

export interface PocVersion {
  readonly version: string;
  readonly note?: string;
  readonly references: readonly { readonly project: string; readonly commit: string | null; readonly romSha1: string }[];
  readonly functions: readonly PocMember[];
  readonly objects: readonly PocMember[];
}

export interface PocFile {
  readonly schema: 2;
  readonly library: string;
  readonly versions: readonly PocVersion[];
}

export interface PocSpecReference {
  readonly project: string;
  readonly objects?: readonly string[];
  readonly symbols?: readonly string[];
}

export interface PocSpec {
  readonly library: string;
  readonly versions: readonly { readonly version: string; readonly references: readonly PocSpecReference[] }[];
}

function pocMember(value: unknown, where: string): PocMember {
  if (!isRecord(value)) throw new BenchError(`${where}: not an object`);
  const { name, ref, refAddr, size, bytes, mask, mode, pointers } = value;
  if (typeof name !== 'string' || typeof ref !== 'number' || typeof refAddr !== 'number' || typeof size !== 'number' || typeof bytes !== 'string' || typeof mask !== 'string') {
    throw new BenchError(`${where}: not a PoC signature member`);
  }
  const member: PocMember = { name, ref, refAddr, size, bytes, mask };
  const withMode: PocMember = mode === 'thumb' || mode === 'arm' ? { ...member, mode } : member;
  if (pointers === undefined) return withMode;
  if (!Array.isArray(pointers) || !pointers.every((p) => p === null || typeof p === 'string')) throw new BenchError(`${where}: pointers is not a list of names`);
  return { ...withMode, pointers: pointers as readonly (string | null)[] };
}

/** A PoC signature file of schema 2, checked field by field. */
export function parsePocFile(value: unknown, where: string): PocFile {
  if (!isRecord(value) || value['schema'] !== 2 || typeof value['library'] !== 'string' || !Array.isArray(value['versions'])) throw new BenchError(`${where}: not a PoC signature file of schema 2`);
  const versions = value['versions'].map((v: unknown, i: number): PocVersion => {
    if (!isRecord(v) || typeof v['version'] !== 'string' || !Array.isArray(v['references']) || !Array.isArray(v['functions']) || !Array.isArray(v['objects'])) {
      throw new BenchError(`${where}: version ${i} is malformed`);
    }
    const references = v['references'].map((r: unknown) => {
      if (!isRecord(r) || typeof r['project'] !== 'string' || typeof r['romSha1'] !== 'string') throw new BenchError(`${where}: a reference of version ${i} is malformed`);
      return { project: r['project'], commit: typeof r['commit'] === 'string' ? r['commit'] : null, romSha1: r['romSha1'] };
    });
    const note = typeof v['note'] === 'string' ? { note: v['note'] } : {};
    return {
      version: v['version'],
      ...note,
      references,
      functions: v['functions'].map((m: unknown, k: number) => pocMember(m, `${where}: version ${i} function ${k}`)),
      objects: v['objects'].map((m: unknown, k: number) => pocMember(m, `${where}: version ${i} object ${k}`)),
    };
  });
  return { schema: 2, library: value['library'], versions };
}

/** A PoC signature spec, the fields the conversion reads. */
export function parsePocSpec(value: unknown, where: string): PocSpec {
  if (!isRecord(value) || typeof value['library'] !== 'string' || !Array.isArray(value['versions'])) throw new BenchError(`${where}: not a PoC signature spec`);
  const strings = (x: unknown): readonly string[] | undefined => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? (x as readonly string[]) : undefined);
  const versions = value['versions'].map((v: unknown) => {
    if (!isRecord(v) || typeof v['version'] !== 'string' || !Array.isArray(v['references'])) throw new BenchError(`${where}: a version is malformed`);
    const references = v['references'].map((r: unknown): PocSpecReference => {
      if (!isRecord(r) || typeof r['project'] !== 'string') throw new BenchError(`${where}: a reference is malformed`);
      const objects = strings(r['objects']);
      const symbols = strings(r['symbols']);
      return { project: r['project'], ...(objects === undefined ? {} : { objects }), ...(symbols === undefined ? {} : { symbols }) };
    });
    return { version: v['version'], references };
  });
  return { library: value['library'], versions };
}

// ---------------------------------------------------------------- one reference, read

/** What the conversion reads of one reference build. */
export interface ReferenceBuild {
  readonly dataset: string;
  readonly commit: string;
  readonly sha1: string;
  readonly romEnd: number;
  readonly symbols: readonly ElfSymbol[];
  readonly text: readonly MapPlacement[];
  readonly data: readonly MapPlacement[];
}

/** A member a reference links, by the PoC's rules: its symbol, address, object and kind. */
interface Enumerated {
  readonly symbol: string;
  readonly global: boolean;
  readonly addr: number;
  readonly object: string;
  readonly kind: 'function' | 'table';
}

/** The PoC's `(^|/)glob$` with `*` spanning '/', as a regular expression. */
function globRegExp(glob: string): RegExp {
  return new RegExp(`(^|/)${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

/** The members a reference links (functions in address order, then the tables in spec order), as the PoC enumerated them. */
function enumerate(build: ReferenceBuild, spec: PocSpecReference): readonly Enumerated[] {
  const inRom = build.symbols.filter((s) => s.addr >= 0x0800_0000 && s.addr < build.romEnd);
  const functionAt = new Map<number, ElfSymbol>();
  for (const s of inRom) {
    if (s.type !== 'func') continue;
    const have = functionAt.get(s.addr);
    if (have === undefined || have.bind === 'local') functionAt.set(s.addr, s);
  }
  const globs = (spec.objects ?? []).map(globRegExp);
  const out: Enumerated[] = [];
  const placements = build.text.filter((p) => globs.some((g) => g.test(p.object))).sort((a, b) => a.start - b.start);
  for (const p of placements) {
    const inside = [...functionAt.values()].filter((s) => s.addr >= p.start && s.addr < p.start + p.size).sort((a, b) => a.addr - b.addr);
    for (const s of inside) out.push({ symbol: s.name, global: s.bind !== 'local', addr: s.addr, object: p.object, kind: 'function' });
  }
  for (const name of spec.symbols ?? []) {
    const s = inRom.find((x) => x.name === name && x.type === 'object');
    if (s === undefined) continue;
    const holds = (p: MapPlacement): boolean => s.addr >= p.start && s.addr < p.start + p.size;
    const placement = build.text.find(holds) ?? build.data.find(holds);
    if (placement === undefined) throw new BenchError(`${build.dataset}: table ${name} lies in no map placement`);
    out.push({ symbol: s.name, global: s.bind !== 'local', addr: s.addr, object: placement.object, kind: 'table' });
  }
  return out;
}

function idOf(e: Enumerated, where: string): MemberId {
  const id = memberIdOf(e.symbol, e.object);
  if (id === undefined) throw new BenchError(`${where}: ${e.symbol} in ${e.object} gives no member id`);
  return id;
}

function wordAt(hex: string, offset: number): number {
  const byte = (i: number): number => Number.parseInt(hex.slice((offset + i) * 2, (offset + i) * 2 + 2), 16);
  return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}

/** One PoC version in schema 3, from its references' builds (in the version's reference order). */
export function convertVersion(library: string, poc: PocVersion, spec: PocSpec['versions'][number], builds: readonly ReferenceBuild[]): LibraryVersion {
  const where = `${library} ${poc.version}`;
  if (spec.references.length !== poc.references.length || builds.length !== poc.references.length) throw new BenchError(`${where}: the PoC file, its spec and the builds name different references`);
  poc.references.forEach((r, i) => {
    const build = builds[i];
    if (build === undefined || build.dataset !== datasetOfProject(r.project) || spec.references[i]?.project !== r.project) throw new BenchError(`${where}: reference ${i} is not ${r.project}`);
    if (r.romSha1 !== build.sha1) throw new BenchError(`${where}: the PoC's ${r.project} ROM is ${r.romSha1}, the ${build.dataset} dataset's ${build.sha1}`);
  });

  // Every member id, from the reference that contributed it.
  const idOfPoc = new Map<PocMember, MemberId>();
  const byId = new Map<MemberId, 'function' | 'table'>();
  const byGlobal = new Map<string, MemberId>();
  const linkOrder: { readonly reference: string; readonly members: readonly LinkOrderMember[] }[] = [];
  const functionsAt: Map<number, MemberId>[] = [];
  builds.forEach((build, r) => {
    const specRef = spec.references[r];
    if (specRef === undefined) return;
    const contributed = [...poc.functions.map((m) => ({ m, kind: 'function' as const })), ...poc.objects.map((m) => ({ m, kind: 'table' as const }))].filter((c) => c.m.ref === r);
    const here: LinkOrderMember[] = [];
    const fnHere = new Map<number, MemberId>();
    for (const e of enumerate(build, specRef)) {
      const id = idOf(e, `${where} ${build.dataset}`);
      const key = `${e.kind}:${e.symbol}`;
      let linked = byId.has(id) ? id : e.global ? byGlobal.get(key) : undefined;
      if (linked === undefined) {
        const own = contributed.find((c) => c.kind === e.kind && c.m.refAddr === e.addr);
        if (own === undefined || !(own.m.name === e.symbol || (own.m.name.startsWith(e.symbol) && /^_\d+$/.test(own.m.name.slice(e.symbol.length))))) {
          throw new BenchError(`${where} ${build.dataset}: ${id} at 0x${e.addr.toString(16)} is no member the PoC's file has`);
        }
        idOfPoc.set(own.m, id);
        byId.set(id, e.kind);
        if (e.global && !byGlobal.has(key)) byGlobal.set(key, id);
        linked = id;
      }
      if (e.kind === 'function') fnHere.set(e.addr, linked);
      here.push({ id: linked, addr: e.addr });
    }
    for (const c of contributed) if (!idOfPoc.has(c.m)) throw new BenchError(`${where} ${build.dataset}: the PoC's ${c.m.name} at 0x${c.m.refAddr.toString(16)} is no member of this reference`);
    here.sort((a, b) => a.addr - b.addr || compareCodeUnits(a.id, b.id));
    linkOrder.push({ reference: build.dataset, members: here });
    functionsAt.push(fnHere);
  });

  const symbolOf = (id: MemberId): string => id.slice(0, id.lastIndexOf('@'));
  const functions = poc.functions.map((m): SignatureFunction => {
    const id = idOfPoc.get(m);
    if (id === undefined || m.mode === undefined) throw new BenchError(`${where}: function ${m.name} has no id or mode`);
    return { id, name: symbolOf(id), mode: m.mode, size: m.size, bytes: m.bytes, mask: m.mask };
  });
  const tables = poc.objects.map((m): SignatureTable => {
    const id = idOfPoc.get(m);
    if (id === undefined) throw new BenchError(`${where}: table ${m.name} has no id`);
    const table: SignatureTable = { id, name: symbolOf(id), size: m.size, bytes: m.bytes, mask: m.mask };
    if (m.pointers === undefined) return table;
    const at = functionsAt[m.ref] ?? new Map<number, MemberId>();
    const names = m.pointers.map((p, i) => (p === null ? null : (at.get((wordAt(m.bytes, 4 * i) & ~1) >>> 0) ?? null)));
    return names.some((n) => n !== null) ? { ...table, names } : table;
  });
  const references = builds.map((b) => ({ dataset: b.dataset, commit: b.commit, romSha1: b.sha1 }));
  return { id: poc.version, idNote: poc.note ?? '', references, linkOrder, functions, tables };
}

/** A PoC file in schema 3. */
export function convertPocFile(poc: PocFile, spec: PocSpec, builds: (dataset: string) => ReferenceBuild): SignatureFile {
  const versions = poc.versions.map((v) => {
    const specVersion = spec.versions.find((s) => s.version === v.version);
    if (specVersion === undefined) throw new BenchError(`${poc.library} ${v.version}: the PoC's spec has no such version`);
    return convertVersion(poc.library, v, specVersion, v.references.map((r) => builds(datasetOfProject(r.project))));
  });
  const file: SignatureFile = { schema: 3, library: poc.library, builtWith: 'poc-converted', versions };
  const check = parseSignatureFile(JSON.parse(signatureFileText(file)));
  if (!check.ok) throw new BenchError(`${poc.library}: the converted file is not of schema 3: ${check.error}`);
  return file;
}

// ---------------------------------------------------------------- I/O

async function readBuild(cx: BenchContext, dataset: Dataset): Promise<ReferenceBuild> {
  if (dataset.map === undefined) throw new BenchError(`${dataset.name}: the dataset names no map`);
  const rom = await readFileBytes(resolve(cx.benchRoot, dataset.rom));
  const sha1 = sha1Of(rom);
  if (sha1 !== dataset.sha1) throw new BenchError(`${dataset.name}: ${dataset.rom} has SHA-1 ${sha1}, the dataset records ${dataset.sha1}`);
  const elf = parseElf(await readFileBytes(resolve(cx.benchRoot, dataset.elf)));
  if (!elf.ok) throw new BenchError(`${dataset.name}: ${elf.error}`);
  const map = parseGnuMap(await readText(resolve(cx.benchRoot, dataset.map)));
  if (!map.ok) throw new BenchError(`${dataset.name}: ${map.error}`);
  const placements = mapPlacements(map.value);
  return { dataset: dataset.name, commit: dataset.elfCommit, sha1, romEnd: 0x0800_0000 + rom.length, symbols: elf.value.symbols, text: placements.text, data: placements.data };
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv, { options: ['out'], maxPositionals: 0 });
  const cx = contextFromEnv(process.env);
  const out = resolve(args.options['out'] ?? join(cx.repoRoot, 'bench', '.local', 'signatures-poc'));
  const pocRoot = resolve(cx.pocRoot);
  const inside = relative(pocRoot, out);
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))) throw new BenchError(`--out ${out} lies inside the PoC checkout ${pocRoot}, which is read-only`);
  const sigDir = join(pocRoot, 'signatures');
  if (!(await exists(sigDir))) throw new BenchError(`no ${sigDir}: set ROMLIFT_POC to the PoC checkout`);
  const { datasets } = await loadDatasets(cx);
  const cache = new Map<string, ReferenceBuild>();
  const builds = new Map<string, Promise<ReferenceBuild>>();
  const names = (await listFiles(sigDir)).filter((f) => !f.includes('/') && f.endsWith('.json')).sort(compareCodeUnits);
  await mkdir(out, { recursive: true });
  for (const name of names) {
    const poc = parsePocFile(await readJson(join(sigDir, name)), name);
    const spec = parsePocSpec(await readJson(join(sigDir, 'specs', name)), `specs/${name}`);
    for (const v of poc.versions) {
      for (const r of v.references) {
        const dataset = datasetOfProject(r.project);
        if (builds.has(dataset)) continue;
        const d = datasets.find((x) => x.name === dataset);
        if (d === undefined) throw new BenchError(`${poc.library}: no dataset ${dataset} (PoC project ${r.project})`);
        builds.set(dataset, readBuild(cx, d));
      }
    }
    for (const [dataset, pending] of builds) cache.set(dataset, await pending);
    const file = convertPocFile(poc, spec, (dataset) => {
      const build = cache.get(dataset);
      if (build === undefined) throw new BenchError(`no build of ${dataset}`);
      return build;
    });
    await writeFile(join(out, `${file.library}.json`), signatureFileText(file));
    const counts = file.versions.map((v) => `${v.id} ${v.functions.length} functions, ${v.tables.length} tables`).join('; ');
    process.stdout.write(`${file.library}: ${counts}\n`);
  }
  process.stdout.write(`converted ${names.length} PoC signature files into ${out}\n`);
  return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
      process.exit(error instanceof UsageError ? 2 : 1);
    },
  );
}
