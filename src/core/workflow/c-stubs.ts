// The C stubs of a project, reconciled with its model (architecture §6.3 `c-stub`, §6.4 `reconciled`, §6.6, D75 b):
// a `src/<module>.c` that does not exist yet is the c-stub writer's (scaffold: written when absent); one that exists is
// the user's from then on, and `generate` brings its INCLUDE_ASM statements in line with the functions and orphans the
// TOML now gives the module (planIncludeAsm: add a missing stub, remove one whose function left the module), as text
// edits applied only while the file still has the sha1 it was read with (planWrites, E_STALE_EDIT). That is what keeps
// `make` building after a legal TOML edit: a rename, a deleted function, a moved or split module change which chunk
// files `generate` writes, and the C files must include exactly those.
//
// Two views of one reconciliation:
// - projectEntries: the stream written into the project; an existing C file's c-stub entry becomes a `reconciled`
//   entry (its base sha1 and its edits), every other entry is the emission's own.
// - resolvedEntries: the stream written into another directory (`verify --assemble/--link`'s temporary tree,
//   `generate --out`); an existing C file's entry is the reconciled text, so the tree holds the C `make` compiles.
// The check pass reads neither: it checks the stub the model implies (the c-stub writer's text), so a C file that
// holds decompiled code is the user's to build and is not refused here.
//
// Pure: the shell reads the C texts and passes its sha1 function in; nothing is hashed or read here.
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { stubChunkFiles, stubName } from '../model/c-unit.ts';
import { isCSource, moduleSource } from '../model/paths.ts';
import type { Model } from '../model/types.ts';
import { planIncludeAsm } from '../reconcile/include-asm.ts';
import { applyTextEdits } from '../reconcile/text-edit.ts';
import type { TextEdit } from '../reconcile/text-edit.ts';
import type { FileEntry } from '../emit/tree.ts';

/** No C file reconciled: a fresh tree, `init`'s, or a run that reads no C. */
export const NO_STUBS: StubReconciliation = { files: new Map(), diagnostics: [] };

/** One existing `src/<module>.c` reconciled with the model: its text as read, the edits, and the text they give. */
export interface ReconciledStub {
  readonly path: string;
  readonly base: string;
  readonly edits: readonly TextEdit[];
  readonly text: string;
}

/** Every existing C file of the model's C modules, reconciled, by path; and the planner's diagnostics (W_C_ORDER). */
export interface StubReconciliation {
  readonly files: ReadonlyMap<string, ReconciledStub>;
  readonly diagnostics: readonly Diagnostic[];
}

/** The INCLUDE_ASM names the generated stub of module `m` holds, in ROM order. */
function wantedNames(model: Pick<Model, 'chunks'>, module: Model['modules'][number]): readonly string[] {
  return stubChunkFiles(model, module).map((file) => stubName(module.name, file));
}

/**
 * The reconciliation of every C file of `cTexts` (project path -> text) that is the source of a generated C module of
 * `model`; a C file of no such module is not romlift's to edit and is left out.
 */
export function reconcileStubs(model: Pick<Model, 'modules' | 'chunks'>, cTexts: ReadonlyMap<string, string>): StubReconciliation {
  const files = new Map<string, ReconciledStub>();
  const diagnostics: Diagnostic[] = [];
  for (const module of model.modules) {
    if (!module.generated || module.kind !== 'c') continue;
    const path = moduleSource(model, module);
    const base = cTexts.get(path);
    if (!isCSource(path) || base === undefined) continue;
    const plan = planIncludeAsm(base, { module: module.name, names: wantedNames(model, module), path });
    files.set(path, { path, base, edits: plan.edits, text: applyTextEdits(base, plan.edits) });
    diagnostics.push(...plan.diagnostics);
  }
  return { files, diagnostics };
}

/** `entries` with each existing C file's c-stub entry made a `reconciled` edit of it (`hash`: the shell's sha1). */
export function* projectEntries(entries: Iterable<FileEntry>, stubs: StubReconciliation, hash: (text: string) => string): Generator<FileEntry> {
  for (const entry of entries) {
    const stub = entry.ownership === 'scaffold' && entry.writer === 'c-stub' ? stubs.files.get(entry.path) : undefined;
    yield stub === undefined ? entry : { ownership: 'reconciled', path: entry.path, baseSha1: hash(stub.base), edits: stub.edits };
  }
}

/** `entries` with each existing C file's c-stub entry holding its reconciled text: the tree another directory gets. */
export function* resolvedEntries(entries: Iterable<FileEntry>, stubs: StubReconciliation): Generator<FileEntry> {
  for (const entry of entries) {
    const stub = entry.ownership === 'scaffold' && entry.writer === 'c-stub' ? stubs.files.get(entry.path) : undefined;
    yield stub === undefined ? entry : { ownership: 'scaffold', path: entry.path, text: stub.text, writer: 'c-stub' };
  }
}
