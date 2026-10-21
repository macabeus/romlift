// The C stubs of a project, reconciled with its model (architecture §6.3 `c-stub`, §6.4 `reconciled`, §6.6, D75 b,
// D77 a to d): a `src/<module>.c` that does not exist yet is the c-stub writer's (scaffold: written when absent); one
// that exists is the user's from then on, and `generate` brings its INCLUDE_ASM statements in line with the functions
// and orphans the TOML now gives the module (planIncludeAsm: add a missing stub, remove one whose function left the
// module), as text edits applied only while the file still has the sha1 it was read with (planWrites, E_STALE_EDIT).
// That is what keeps `make` building after a legal TOML edit: a rename, a deleted function, a moved or split module
// change which chunk files `generate` writes, and the C files must include exactly those.
//
// What the edits cannot fix is refused or reported (fix round 2, correctness-a0-1; fix round 3, D78 a; fix round 4,
// D80 a): planIncludeAsm's E_C_STALE_DEFINITION (the C of a function of the tree romlift last generated that no module
// has now: one the TOML renamed or deleted, wherever it lies, a border move included; or a definition where the stub
// goes of a chunk that tree held in the module's directory and the file no longer includes or defines: a rename in C
// only), E_C_CONDITIONAL_STUB, E_C_STUB_UNPLACED and E_C_UNSCANNABLE; here E_C_DEFINITION_MOVED, a C definition of a
// function the TOML now gives another module (a move or split of decompiled code), whose stub there would define it
// twice, read in every src/*.c, a file of no module included (its module merged into another, or made `asm`: its
// decompiled C would leave the build unseen, correctness-a2-4); and W_C_FILE_UNUSED, a src/*.c that is the source of
// no module (a renamed `c` module), which `make` no longer builds. The errors make `generate` write nothing
// (writable), so `make` never sees a function defined twice. The previous tree is the chunk files on disk
// (`previousChunkFiles`, which the shell lists; moduleChunkStubs reads one module's). A stub of another nonmatchings
// directory whose file this run does not write goes too (fix round 5, correctness-b0-2): a renamed `c` module whose
// source the user moved (`git mv src/<old>.c src/<new>.c`) keeps no stub of the old directory. asm/ is gitignored (R4; the owner's answer to Q9, D79 b), so the
// first `generate` of a fresh clone or worktree (setup.sh's duty 5) has none and uses the fallback rule, a definition
// wherever a missing stub goes is stale; from the second `generate` on, the tree the first one wrote is on disk.
//
// Three views of one reconciliation:
// - projectEntries: the stream written into the project; an existing C file's c-stub entry becomes a `reconciled`
//   entry (its base sha1 and its edits), every other entry is the emission's own.
// - resolvedEntries: the stream written into a fresh directory (`verify --assemble/--link`'s temporary tree, the
//   bench); an existing C file's entry is the reconciled text, so the tree holds the C `make` compiles.
// - outTreeEntries (over resolvedEntries): `generate --out <dir>`'s stream, where every C file is `generated`, so a
//   second run into the same directory rewrites it (or deletes it) as it does asm/ (correctness-a0-4).
// The check pass reads none: it checks the stub the model implies (the c-stub writer's text), so a C file that
// holds decompiled code is the user's to build and is not refused here.
//
// Pure: the shell reads the C texts and passes its sha1 function in; nothing is hashed or read here.
import { diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { stubChunks } from '../model/c-unit.ts';
import { nonmatchingDir } from '../../foundation/util/project-files.ts';
import { chunkNamesOf, chunkPathsOf, isCSource, moduleChunkStubs, moduleSource } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import { compiledDefinitions, planIncludeAsm, scanC, unscannableWarning } from '../reconcile/include-asm.ts';
import type { StubTree } from '../reconcile/include-asm.ts';
import { applyTextEdits } from '../reconcile/text-edit.ts';
import type { TextEdit } from '../reconcile/text-edit.ts';
import type { FileEntry } from '../emit/tree.ts';
import { WorkflowCodes } from './codes.ts';

/** No C file reconciled: a fresh tree, `init`'s, or a run that reads no C. */
export const NO_STUBS: StubReconciliation = { files: [], diagnostics: [] };

/** One existing `src/<module>.c` reconciled with the model: its text as read, the edits, and the text they give. */
export interface ReconciledStub {
  readonly path: string;
  readonly base: string;
  readonly edits: readonly TextEdit[];
  readonly text: string;
}

/**
 * Every existing C file of the model's generated C modules, reconciled, sorted by path (plain data: a GenerateResult
 * survives a JSON round trip, D66 e); and the diagnostics of the reconciliation.
 */
export interface StubReconciliation {
  readonly files: readonly ReconciledStub[];
  readonly diagnostics: readonly Diagnostic[];
}

/** The module of every function chunk of the model, by name. */
function functionModules(model: Pick<Model, 'chunks'>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const chunk of model.chunks) if (chunk.kind === 'function' && !out.has(chunk.name)) out.set(chunk.name, chunk.module);
  return out;
}

/** E_C_DEFINITION_MOVED for definition `d` of `path`, whose function romlift.toml now puts in module `owner`. */
function movedDiagnostic(path: string, d: { readonly name: string; readonly line: number }, owner: Model['modules'][number] | undefined, ownerName: string): Diagnostic {
  const advice =
    owner?.kind === 'c'
      ? `move its C to ${ownerName}'s source, or the function is defined twice`
      : `${ownerName} is ${owner?.kind === 'data' ? 'a data' : 'an asm'} module, which builds no C: delete the C definition, or make ${ownerName} a c module in romlift.toml, or the function is defined twice`;
  return diagnostic(WorkflowCodes, 'E_C_DEFINITION_MOVED', `${path} defines ${d.name} (line ${d.line}), which romlift.toml now puts in module ${ownerName}: ${advice}`, { path });
}

/**
 * The reconciliation of every C file of `cTexts` (project path -> text) that is the source of a generated C module of
 * `model`; a C file of no such module is not romlift's to edit and is left out (W_C_FILE_UNUSED when it is the source
 * of no module at all, with E_C_DEFINITION_MOVED for each function it defines that a module has). `previousChunkFiles`: the project paths of the chunk files of the tree on disk (the one
 * romlift last generated), or undefined (or empty) when there is none.
 */
export function reconcileStubs(model: Pick<Model, 'modules' | 'chunks'>, cTexts: ReadonlyMap<string, string>, previousChunkFiles?: readonly string[]): StubReconciliation {
  const files: ReconciledStub[] = [];
  const diagnostics: Diagnostic[] = [];
  const sources = new Set(model.modules.map((m) => moduleSource(model, m)));
  const owners = functionModules(model);
  const modules = new Map(model.modules.map((m) => [m.name, m] as const));
  // A function of the previous tree that a module still has is wanted there (or E_C_DEFINITION_MOVED), never stale.
  const retired = previousChunkFiles !== undefined && previousChunkFiles.length > 0 ? chunkNamesOf(previousChunkFiles).filter((name) => !owners.has(name)) : undefined;
  // The tree this run writes: a stub of a directory it no longer writes that file in goes (correctness-b0-2).
  let tree: StubTree | undefined;
  for (const module of model.modules) {
    if (!module.generated || module.kind !== 'c') continue;
    const path = moduleSource(model, module);
    const base = cTexts.get(path);
    if (!isCSource(path) || base === undefined) continue;
    tree ??= stubTree(model);
    const previous = retired === undefined ? {} : { retired, previousStubs: moduleChunkStubs(previousChunkFiles ?? [], module.name) };
    const plan = planIncludeAsm(base, { module: module.name, chunks: stubChunks(model, module), path, tree, ...previous });
    files.push({ path, base, edits: plan.edits, text: applyTextEdits(base, plan.edits) });
    diagnostics.push(...plan.diagnostics);
    for (const d of plan.undeclared) {
      const owner = owners.get(d.name);
      if (owner === undefined || owner === module.name) continue;
      diagnostics.push(movedDiagnostic(path, d, modules.get(owner), owner));
    }
  }
  for (const path of [...cTexts.keys()].sort(compareCodeUnits)) {
    if (sources.has(path)) continue;
    diagnostics.push(diagnostic(WorkflowCodes, 'W_C_FILE_UNUSED', `${path} is the source of no module of romlift.toml, so make does not build it (was its c module renamed?); its C is left in place`, { path }));
    // Its decompiled C of a function some module has would drop out of the build while that module's stub stands in.
    // A file the scanner cannot split is checked over what it read, and says so (architecture-b0-2).
    const compiled = compiledDefinitions(scanC(cTexts.get(path) ?? ''));
    if (!compiled.scannable) diagnostics.push(unscannableWarning(path, path, compiled.unscannable, 'its definitions were checked against the modules as far as it reads'));
    for (const d of compiled.definitions) {
      const owner = owners.get(d.name);
      if (owner !== undefined) diagnostics.push(movedDiagnostic(path, d, modules.get(owner), owner));
    }
  }
  files.sort((a, b) => compareCodeUnits(a.path, b.path));
  return { files, diagnostics };
}

/** The chunk files `model` writes, and the nonmatchings directories of its modules romlift never writes. */
function stubTree(model: Pick<Model, 'modules' | 'chunks'>): StubTree {
  const files = new Set<string>();
  for (const file of chunkPathsOf(model)) if (file !== undefined) files.add(file);
  return { files, userDirs: new Set(model.modules.filter((m) => !m.generated).map((m) => nonmatchingDir(m.name))) };
}

/** The reconciled files of `stubs` by path, for the views below. */
function byPath(stubs: StubReconciliation): ReadonlyMap<string, ReconciledStub> {
  return new Map(stubs.files.map((stub) => [stub.path, stub] as const));
}

/** `entries` with each existing C file's c-stub entry made a `reconciled` edit of it (`hash`: the shell's sha1). */
export function* projectEntries(entries: Iterable<FileEntry>, stubs: StubReconciliation, hash: (text: string) => string): Generator<FileEntry> {
  const files = byPath(stubs);
  for (const entry of entries) {
    const stub = entry.ownership === 'scaffold' && entry.writer === 'c-stub' ? files.get(entry.path) : undefined;
    yield stub === undefined ? entry : { ownership: 'reconciled', path: entry.path, baseSha1: hash(stub.base), edits: stub.edits };
  }
}

/** `entries` with each existing C file's c-stub entry holding its reconciled text: the tree a fresh directory gets. */
export function* resolvedEntries(entries: Iterable<FileEntry>, stubs: StubReconciliation): Generator<FileEntry> {
  const files = byPath(stubs);
  for (const entry of entries) {
    const stub = entry.ownership === 'scaffold' && entry.writer === 'c-stub' ? files.get(entry.path) : undefined;
    yield stub === undefined ? entry : { ownership: 'scaffold', path: entry.path, text: stub.text, writer: 'c-stub' };
  }
}

/** `entries` (resolvedEntries') with every c-stub entry `generated`: the tree `generate --out` writes and rewrites. */
export function* outTreeEntries(entries: Iterable<FileEntry>): Generator<FileEntry> {
  for (const entry of entries) {
    yield entry.ownership === 'scaffold' && entry.writer === 'c-stub' ? { ownership: 'generated', path: entry.path, text: entry.text, writer: 'c-stub' } : entry;
  }
}

/** The base texts of the reconciled C files, for WritePlanInputs.reconciledTexts. */
export function reconciledBases(stubs: StubReconciliation): ReadonlyMap<string, string> {
  return new Map(stubs.files.map((stub) => [stub.path, stub.base] as const));
}
