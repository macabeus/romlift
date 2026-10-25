// The signature builder's file-backed part (architecture §7.1, §7.2, D31, D32, D40, roadmap 6.A): reads a spec, resolves
// each reference dataset to its ROM, ELF, map, commit and SHA-1, reads and parses them, runs romlift's discover analysis
// on each reference ROM and hands everything to the pure core/signatures/extract.ts. Mechanical: every rule is the
// core's; this file reads, hashes and reports.
//
// A reference dataset is, in this order:
// - a bench dataset, `<repo>/bench/dataset/real/<dataset>.json`: its `rom`, `elf` and `map` paths are relative to the
//   bench root (ROMLIFT_BENCH_ROOT, default the repository's parent), its `sha1` must be the ROM's and its `elfCommit`
//   is the reference's commit; a sealed one (`heldout` true and `revealed` empty) is refused before any of its files is
//   read (E_SIGNATURE_DATASET_SEALED, D32);
// - a synthetic fixture, `<repo>/bench/dataset/synthetic/<dataset>/build/<dataset>.{gba,elf,map}`, whose commit is
//   `synthetic` (a fixture has no checkout of its own; its bytes are committed).
// The repository is the nearest ancestor of the spec's directory that holds `bench/dataset` (two levels above
// `signatures/specs/<library>.json`), else the package root.
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { parseElf } from '../../foundation/formats/elf.ts';
import { parseGnuMap } from '../../foundation/formats/gnu-map.ts';
import { extractSignatures, mapPlacements, signatureFileText } from '../../core/signatures/extract.ts';
import type { ReferenceInput } from '../../core/signatures/extract.ts';
import type { SignatureFile } from '../../core/signatures/schema.ts';
import { isSealedDataset } from '../../core/signatures/sealing.ts';
import { isLibraryName, parseSignatureSpec } from '../../core/signatures/spec.ts';
import type { SignatureSpec } from '../../core/signatures/spec.ts';
import { discover } from '../../core/workflow/discover.ts';
import { ShellCodes } from '../codes.ts';
import { atomicWrite, errorReason, isDirectory, isRegularFile, readBytes, readJson, readText } from '../fs.ts';
import type { IoResult } from '../fs.ts';
import { packageRoot, packageVersion } from '../project/read-inputs.ts';
import { readRom } from '../rom.ts';

/** A spec on disk, or one in memory (the bench leaves a reference out) with the path it stands for. */
export type BuildSignaturesInput = { readonly specPath: string } | { readonly spec: SignatureSpec; readonly specPath: string };

export interface BuildSignaturesOptions {
  /** Where the real datasets' paths resolve; default the repository's parent. */
  readonly benchRoot?: string;
  /** The `builtWith` of the file; default the version of the package's package.json. */
  readonly builtWith?: string;
}

/** The built file with every diagnostic (warnings included), or the refusal: its first error and every diagnostic. */
export type BuildSignaturesResult =
  | { readonly ok: true; readonly value: SignatureFile; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostic: Diagnostic; readonly diagnostics: readonly Diagnostic[] };

/** What a reference dataset resolves to before any of its files is read. */
interface ResolvedReference {
  readonly dataset: string;
  readonly rom: string;
  readonly elf: string;
  readonly map: string;
  readonly commit: string;
  /** The SHA-1 the dataset records; a fixture records none. */
  readonly sha1?: string;
}

/** The commit a synthetic fixture reference records. */
export const SYNTHETIC_COMMIT = 'synthetic';

const DATASET_NAME = /^[a-z0-9][a-z0-9._-]*$/;

function refusal(diagnostics: readonly Diagnostic[]): BuildSignaturesResult {
  const first = diagnostics.find((d) => d.severity === 'error') ?? diagnostics[0];
  if (first === undefined) return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_SPEC_INVALID', 'the build was refused without a reason'), diagnostics };
  return { ok: false, diagnostic: first, diagnostics };
}

/** The repository a spec belongs to: the nearest ancestor of its directory holding bench/dataset, else the package root. */
export async function signaturesRepoOf(specPath: string): Promise<string> {
  for (let dir = dirname(resolve(specPath)); ; dir = dirname(dir)) {
    const found = await isDirectory(join(dir, 'bench', 'dataset'));
    if (found.ok && found.value) return dir;
    if (dirname(dir) === dir) return packageRoot();
  }
}

/** The spec at `path`, validated. */
export async function readSignatureSpec(path: string): Promise<IoResult<SignatureSpec>> {
  return readJson(path, parseSignatureSpec, 'E_SIGNATURE_SPEC_INVALID');
}

/** A dataset file's fields: any JSON object. */
function datasetFields(json: unknown): { readonly ok: true; readonly value: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly error: string } {
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? { ok: true, value: json as Readonly<Record<string, unknown>> } : { ok: false, error: 'is not a dataset object' };
}

function stringField(json: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = json[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A dataset name resolved to its files: a bench dataset, else a synthetic fixture; a sealed dataset is refused. */
async function resolveReference(repo: string, benchRoot: string, dataset: string): Promise<IoResult<ResolvedReference>> {
  if (!DATASET_NAME.test(dataset)) return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_DATASET_UNKNOWN', `'${dataset}' is no dataset name`) };
  const file = join(repo, 'bench', 'dataset', 'real', `${dataset}.json`);
  const real = await isRegularFile(file);
  if (!real.ok) return real;
  if (!real.value) {
    const fixture = join(repo, 'bench', 'dataset', 'synthetic', dataset, 'build');
    const isFixture = await isDirectory(fixture);
    if (!isFixture.ok) return isFixture;
    if (!isFixture.value) {
      return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_DATASET_UNKNOWN', `${dataset}: no ${file} and no synthetic fixture build ${fixture}`) };
    }
    const at = (ext: string): string => join(fixture, `${dataset}.${ext}`);
    return { ok: true, value: { dataset, rom: at('gba'), elf: at('elf'), map: at('map'), commit: SYNTHETIC_COMMIT } };
  }
  const read = await readJson(file, datasetFields, 'E_SIGNATURE_DATASET_INVALID');
  if (!read.ok) return read;
  const fields = read.value;
  if (isSealedDataset(fields)) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_DATASET_SEALED', `${dataset} is a sealed held-out dataset; it is never a signature reference (D32)`, { path: file }) };
  }
  const rom = stringField(fields, 'rom');
  const elf = stringField(fields, 'elf');
  const map = stringField(fields, 'map');
  const sha1 = stringField(fields, 'sha1');
  const commit = stringField(fields, 'elfCommit');
  if (rom === undefined || elf === undefined || map === undefined || sha1 === undefined || commit === undefined) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_DATASET_INVALID', `${file} lacks one of rom, elf, map, sha1 and elfCommit`, { path: file }) };
  }
  return { ok: true, value: { dataset, rom: resolve(benchRoot, rom), elf: resolve(benchRoot, elf), map: resolve(benchRoot, map), commit, sha1 } };
}

/** A resolved reference read, parsed and analysed. */
async function loadReference(ref: ResolvedReference): Promise<IoResult<ReferenceInput>> {
  const rom = await readRom(ref.rom);
  if (!rom.ok) return rom;
  if (ref.sha1 !== undefined && rom.value.sha1 !== ref.sha1) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_REFERENCE_SHA1', `${ref.rom} has SHA-1 ${rom.value.sha1}, the ${ref.dataset} dataset records ${ref.sha1}`, { path: ref.rom }) };
  }
  const elfBytes = await readBytes(ref.elf);
  if (!elfBytes.ok) return elfBytes;
  const elf = parseElf(elfBytes.value);
  if (!elf.ok) return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_REFERENCE_INVALID', `${ref.elf}: ${elf.error}`, { path: ref.elf }) };
  const mapText = await readText(ref.map);
  if (!mapText.ok) return mapText;
  const map = parseGnuMap(mapText.value);
  if (!map.ok) return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_SIGNATURE_REFERENCE_INVALID', `${ref.map}: ${map.error}`, { path: ref.map }) };
  const placements = mapPlacements(map.value);
  return {
    ok: true,
    value: {
      dataset: ref.dataset,
      commit: ref.commit,
      romSha1: rom.value.sha1,
      rom: rom.value,
      analysis: discover(rom.value),
      symbols: elf.value.symbols,
      textPlacements: placements.text,
      dataPlacements: placements.data,
    },
  };
}

/**
 * Builds the signature file of a spec from its reference datasets (architecture §7.2). Each dataset is read and
 * analysed once per call, however many versions name it. Refused when the spec, a dataset or a reference cannot be
 * read, when a reference is sealed, or when the core raises an error.
 */
export async function buildSignatures(input: BuildSignaturesInput, options: BuildSignaturesOptions = {}): Promise<BuildSignaturesResult> {
  let spec: SignatureSpec;
  if ('spec' in input) spec = input.spec;
  else {
    const read = await readSignatureSpec(input.specPath);
    if (!read.ok) return refusal([read.diagnostic]);
    spec = read.value;
  }
  if (!isLibraryName(spec.library)) {
    return refusal([diagnostic(ShellCodes, 'E_SIGNATURE_SPEC_INVALID', `${input.specPath}: library '${spec.library}' is no file name`, { path: input.specPath })]);
  }
  const repo = await signaturesRepoOf(input.specPath);
  const benchRoot = options.benchRoot ?? dirname(repo);
  let builtWith = options.builtWith;
  if (builtWith === undefined) {
    const version = await packageVersion();
    if (!version.ok) return refusal([version.diagnostic]);
    builtWith = version.value;
  }

  const loaded = new Map<string, Promise<IoResult<ReferenceInput>>>();
  const load = (dataset: string): Promise<IoResult<ReferenceInput>> => {
    let pending = loaded.get(dataset);
    if (pending === undefined) {
      pending = resolveReference(repo, benchRoot, dataset).then((resolved) => (resolved.ok ? loadReference(resolved.value) : resolved));
      loaded.set(dataset, pending);
    }
    return pending;
  };
  const problems: Diagnostic[] = [];
  const references: ReferenceInput[][] = [];
  for (const version of spec.versions) {
    const inputs: ReferenceInput[] = [];
    for (const ref of version.references) {
      const read = await load(ref.dataset);
      if (read.ok) inputs.push(read.value);
      else if (!problems.includes(read.diagnostic)) problems.push(read.diagnostic);
    }
    references.push(inputs);
  }
  if (problems.length > 0) return refusal(problems);
  const built = extractSignatures(spec, references, builtWith);
  return built.ok ? { ok: true, value: built.value, diagnostics: built.diagnostics } : refusal(built.diagnostics);
}

/** Writes `<outDir>/<library>.json` (the directory created when absent) and returns its path. */
export async function writeSignatureFile(outDir: string, file: SignatureFile): Promise<IoResult<string>> {
  const path = join(outDir, `${file.library}.json`);
  try {
    await mkdir(outDir, { recursive: true });
  } catch (error) {
    return { ok: false, diagnostic: diagnostic(ShellCodes, 'E_IO_WRITE', `cannot create ${outDir}: ${errorReason(error)}`, { path: outDir }) };
  }
  const written = await atomicWrite(path, signatureFileText(file));
  return written.ok ? { ok: true, value: path } : written;
}
