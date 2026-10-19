// The emission families of one tuning ROM (architecture §8.4 "Scaffold", "Readability", "objdiff", D34,
// D62): the model of the seedless discover run (romlift's discoverModel: configFromDiscover, buildModel), the
// readable printer's statistics and tree digest on every `bench run`, and under `--scaffold` both printers' trees
// each written into a fresh temporary directory (writeFreshTree) and linked with linkCheck,
// then the objdiff family over the readable build when it reproduces the SHA-1. The raw link is the row's
// `scaffold` verdict from phase 3 on (it replaces the PoC dump's); the readable link is `objdiff.linked`.
// The bench reaches all of it through EmissionFamilies (named apart from emission-run.ts EmissionRunner, the
// generate and init workflows `bench speed` and `bench large-rom` time), so its tests run `bench run` on hand-built
// analyses.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildUnits,
  discoverModel as modelOfDiscover,
  emitTree,
  type AnalysisResult,
  type ElfSymbol,
  type Model,
  type Printer,
  type PrintStats,
  type Rom,
} from 'romlift';
import { linkCheck, writeFreshTree } from 'romlift/node';

import { scoreObjdiff, unlinkedSummary, type ObjdiffSummary } from './objdiff.ts';
import { readableStats, treePass } from './readability.ts';
import type { Truth } from './truth.ts';

/** What linking one printer's tree gave. */
export interface LinkOutcome {
  /** The image linked and its SHA-1 is the ROM's. */
  readonly ok: boolean;
  /** The SHA-1 of the linked image; null when nothing linked. */
  readonly sha1: string | null;
  readonly detail: string;
  readonly treeDigest: string;
}

/** The readability family's inputs of one ROM. */
export interface ReadabilityRun {
  readonly stats: PrintStats;
  /** The readable emission stream's digest (g3.tree-determinism's). */
  readonly treeDigest: string;
}

export interface ScaffoldInput {
  readonly rom: Rom;
  readonly analysis: AnalysisResult;
  readonly truth: Pick<Truth, 'byAddr'>;
  /** The reference ELF's symbols, for the names of the objdiff base. */
  readonly symbols: readonly ElfSymbol[];
  /** The reference objects (absolute). */
  readonly objectsDir: string;
  /** The objects the reference map links, relative to objectsDir (objdiff.ts ObjdiffInputs.linkedObjects). */
  readonly linkedObjects?: ReadonlySet<string>;
  /** The objdiff-cli binary. */
  readonly objdiff: string;
}

export interface ScaffoldRun {
  readonly raw: LinkOutcome;
  readonly readable: LinkOutcome;
  readonly objdiff: ObjdiffSummary;
  /** Volatile wall times in milliseconds (bench/timings.json). */
  readonly timings: Readonly<Record<string, number>>;
}

/** How `bench run` reaches the emission families (readability, scaffold, objdiff). */
export interface EmissionFamilies {
  readability(rom: Rom, analysis: AnalysisResult): ReadabilityRun;
  scaffold(input: ScaffoldInput): Promise<ScaffoldRun>;
}

const MODELS = new WeakMap<AnalysisResult, Model>();

/** The model of a discover run under the config configFromDiscover builds, once per analysis. */
export function discoverModel(rom: Rom, analysis: AnalysisResult): Model {
  const cached = MODELS.get(analysis);
  if (cached !== undefined) return cached;
  const model = modelOfDiscover(rom, analysis);
  MODELS.set(analysis, model);
  return model;
}

const EMPTY_DECOMP = { defined: [] };

const messages = (diagnostics: readonly { readonly message: string }[]): string => diagnostics.map((d) => d.message).join('; ');

/**
 * Writes `printer`'s tree of `model` into the empty directory `dir` as a fresh project is written
 * (writeFreshTree), then links it. The stream runs twice: once for the paths and the tree digest, once for the
 * write.
 */
export async function scaffoldTree(rom: Rom, model: Model, printer: Printer, dir: string): Promise<LinkOutcome> {
  const cx = { decomp: EMPTY_DECOMP, printer };
  const pass = treePass(emitTree(rom, model, cx));
  const failed = (detail: string): LinkOutcome => ({ ok: false, sha1: null, detail, treeDigest: pass.treeDigest });
  const applied = await writeFreshTree(dir, { model, entries: emitTree(rom, model, cx), paths: pass.paths });
  if (!applied.ok) return failed(`applying the plan: ${messages(applied.diagnostics)}`);
  const link = await linkCheck({ dir, rom, units: buildUnits(model) });
  const detail = link.diagnostics.length === 0 ? link.detail : `${link.detail}: ${messages(link.diagnostics)}`;
  return { ok: link.ok && link.sha1 === rom.sha1, sha1: link.sha1, detail, treeDigest: pass.treeDigest };
}

/** scaffoldTree in a temporary directory that is removed afterwards. */
async function inTempDir(rom: Rom, model: Model, printer: Printer): Promise<LinkOutcome> {
  const dir = await mkdtemp(join(tmpdir(), `romlift-scaffold-${printer}-`));
  try {
    return await scaffoldTree(rom, model, printer, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const since = (started: number): number => Math.round(performance.now() - started);

/** The emission of romlift itself. */
export const ROMLIFT_FAMILIES: EmissionFamilies = {
  readability(rom, analysis) {
    const model = discoverModel(rom, analysis);
    return { stats: readableStats(rom, model), treeDigest: treePass(emitTree(rom, model, { decomp: EMPTY_DECOMP })).treeDigest };
  },
  async scaffold(input) {
    const model = discoverModel(input.rom, input.analysis);
    let started = performance.now();
    const raw = await inTempDir(input.rom, model, 'raw');
    const rawLinkMs = since(started);
    started = performance.now();
    const readable = await inTempDir(input.rom, model, 'readable');
    const readableLinkMs = since(started);
    started = performance.now();
    const objdiff =
      readable.ok
        ? await scoreObjdiff({
            rom: input.rom,
            analysis: input.analysis,
            truth: input.truth,
            symbols: input.symbols,
            objectsDir: input.objectsDir,
            objdiff: input.objdiff,
            ...(input.linkedObjects === undefined ? {} : { linkedObjects: input.linkedObjects }),
          })
        : unlinkedSummary();
    return { raw, readable, objdiff, timings: { rawLinkMs, readableLinkMs, objdiffMs: since(started) } };
  },
};
