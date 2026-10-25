// `romlift rename <old> <new>` as a plan (architecture §2.1, §6.6, roadmap 6.E, D9, D17, D92): in-memory inputs the
// shell read, a plan it applies. The plan is a one-line patch of romlift.toml (core/config/rename-patch.ts: the entry
// named or aliased `from` gets `to`, its `from` key dropped, since the name is now the user's) and, for every C text
// of the project (src/**/*.c, src/**/*.h and every file under include/), the edits that rename its identifier tokens
// `from` (core/reconcile/rename-tokens.ts: never a comment, string or character literal), each a `reconciled` entry
// whose base sha1 is the one the shell read, so planWrites and applyWrites write it only over that text
// (E_STALE_EDIT). The stub `INCLUDE_ASM("asm/nonmatchings/<m>", <old>);` is one of those identifiers: renamed here, its
// chunk file follows at the next `generate`, which rename never runs.
//
// Refusals change no file (g6.rename): E_RENAME_INVALID (`to` is no C identifier, a C keyword, or no assembler symbol
// name), E_RENAME_UNKNOWN (`from` is no function, symbol or alias name of the TOML), E_RENAME_EXISTS (`to` already is
// one, or a module name, or a name the project's model emits: a default chunk or symbol name, a local label,
// correctness-1, D95 c; renameModelNames), E_RENAME_SKIPPED_FILE (a file rename cannot edit names `from`, below) and the
// TOML patch's E_TOML_PATCH_REFUSED. A file under src/ or include/ that rename does not edit (a symbolic link, a file
// that is not UTF-8 text or holds a NUL; the shell lists it, read-inputs.ts readRenameTexts) is W_RENAME_SKIPPED when it
// does not hold `from` as an identifier's bytes, else the refusal. Pure: the shell reads, hashes and writes.
import { isSymbolName } from '../../foundation/asm/dialect.ts';
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { Addr } from '../../foundation/rom/span.ts';
import { hexAddr } from '../../foundation/util/hex.ts';
import { compareCodeUnits, compareNumbers } from '../../foundation/util/sorted.ts';
import { entriesNamed, planRenamePatch } from '../config/rename-patch.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { FileEntry } from '../emit/tree.ts';
import { loadSymbolOf, relocatedModules } from '../model/modules.ts';
import type { Model } from '../model/types.ts';
import type { CompilerProfile } from '../profile/types.ts';
import { C_KEYWORDS } from '../reconcile/c-tokens.ts';
import { renameIdentifiers } from '../reconcile/rename-tokens.ts';
import type { Journal } from '../write-plan/journal.ts';
import { WorkflowCodes } from './codes.ts';
import { confirmProject } from './generate.ts';

/** What `rename` reads, all read by the shell. */
export interface RenameInputs {
  /** romlift.toml as it is on disk. */
  readonly configText: string;
  /** configText parsed. */
  readonly config: RomliftConfig;
  /** The name to rename: a [functions] or [symbols] entry's name, or an alias of one. */
  readonly from: string;
  /** The new name. */
  readonly to: string;
  /** Every src/**\/*.c, src/**\/*.h and include/** file by project path -> its text. */
  readonly texts: ReadonlyMap<string, string>;
  /** The sha1 of each text of `texts` (the shell's hash of the bytes it decoded), by the same project paths. */
  readonly sha1s: ReadonlyMap<string, string>;
  /** The files under src/ and include/ the shell did not read as texts (none when absent). */
  readonly skipped?: readonly RenameSkipped[];
  /** Every name the project's model emits, by name -> its address (renameModelNames). */
  readonly modelNames: ReadonlyMap<string, Addr>;
}

/** Why rename does not edit a file under src/ or include/. */
export type RenameSkipReason = 'link' | 'not-utf8' | 'binary';

/** A file rename does not edit, as the shell found it: its path, why, and its bytes when it is (or links to) a file. */
export interface RenameSkipped {
  readonly path: string;
  readonly reason: RenameSkipReason;
  readonly bytes?: Uint8Array;
}

/** One file's identifier edits: a reconciled entry over the text the shell read. */
export type RenameEdit = Extract<FileEntry, { readonly ownership: 'reconciled' }>;

/** `rename`'s plan: the patched TOML and the C edits, or the refusal (nothing to write). */
export type RenamePlan =
  | { readonly ok: true; readonly tomlText: string; readonly edits: readonly RenameEdit[]; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** A C identifier: a letter or `_`, then letters, digits and `_`. */
const C_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `name` can be a function's or symbol's new name: a C identifier that is no keyword, and a symbol name. */
export function isRenameTarget(name: string): boolean {
  return C_IDENTIFIER.test(name) && !C_KEYWORDS.has(name) && isSymbolName(name);
}

/** Every name of the config a new name may not take: functions', symbols' and their aliases, and modules'. */
function projectNames(config: RomliftConfig): ReadonlySet<string> {
  const names = new Set<string>(config.modules.map((m) => m.name));
  for (const entry of [...config.functions.values(), ...config.symbols.values()]) {
    names.add(entry.name);
    for (const alias of entry.aliases) names.add(alias);
  }
  return names;
}

/**
 * Every name the model of a project emits (correctness-1, D95 c): each chunk's, label's, symbol's and module's, and the
 * `__load_<module>` the linker script defines for each runs_at module (correctness-r1-2), by name -> the first address
 * that carries it. A new name among them is one `generate` would refuse (E_NAME_COLLISION).
 */
export function modelNamesOf(model: Pick<Model, 'chunks' | 'labels' | 'symbols' | 'modules'>): ReadonlyMap<string, Addr> {
  const uses: { readonly name: string; readonly addr: Addr }[] = [
    ...model.chunks.map((c) => ({ name: c.name, addr: c.span.start })),
    ...model.labels.map((l) => ({ name: l.name, addr: l.addr })),
    ...model.symbols.map((sym) => ({ name: sym.name, addr: sym.addr })),
    ...model.modules.map((m) => ({ name: m.name, addr: m.span.start })),
    ...relocatedModules(model.modules).map((m) => ({ name: loadSymbolOf(m), addr: m.span.start })),
  ].sort((a, b) => compareNumbers(a.addr, b.addr) || compareCodeUnits(a.name, b.name));
  const names = new Map<string, Addr>();
  for (const u of uses) if (!names.has(u.name)) names.set(u.name, u.addr);
  return names;
}

/** The names the model of a project (its ROM and config) emits, or the refusal of another ROM (confirmProject). */
export function renameModelNames(inputs: { readonly rom: Rom; readonly config: RomliftConfig; readonly profile?: CompilerProfile }): { readonly ok: true; readonly names: ReadonlyMap<string, Addr> } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] } {
  const confirmed = confirmProject(inputs);
  return confirmed.ok ? { ok: true, names: modelNamesOf(confirmed.model) } : confirmed;
}

/** Whether `bytes` hold `name`'s ASCII bytes with no identifier character on either side. */
function namesIdentifier(bytes: Uint8Array, name: string): boolean {
  const want = new TextEncoder().encode(name);
  const word = (b: number | undefined): boolean => b !== undefined && ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x5f);
  outer: for (let i = 0; i + want.length <= bytes.length; i++) {
    for (let k = 0; k < want.length; k++) if (bytes[i + k] !== want[k]) continue outer;
    if (!word(bytes[i - 1]) && !word(bytes[i + want.length])) return true;
  }
  return false;
}

const SKIP_TEXT: Readonly<Record<RenameSkipReason, string>> = { link: 'a symbolic link, which an edit would replace with a file', 'not-utf8': 'not UTF-8 text', binary: 'holds a NUL byte' };

/** W_RENAME_SKIPPED for each skipped file that does not name `from`, E_RENAME_SKIPPED_FILE for each that does (D95 c). */
export function skippedFileProblems(skipped: readonly RenameSkipped[], from: string): readonly Diagnostic[] {
  return skipped.map((f) => {
    if (f.bytes !== undefined && namesIdentifier(f.bytes, from)) {
      return diagnostic(WorkflowCodes, 'E_RENAME_SKIPPED_FILE', `${f.path} names ${from}, but rename does not edit it (${SKIP_TEXT[f.reason]}): rename it there by hand first, or rename again once it no longer names ${from}; nothing was changed`, { path: f.path });
    }
    const what = f.bytes === undefined && f.reason === 'link' ? 'a symbolic link to a directory or to nothing, whose files rename does not read' : SKIP_TEXT[f.reason];
    return diagnostic(WorkflowCodes, 'W_RENAME_SKIPPED', `${f.path} is not edited (${what})${f.bytes === undefined ? '' : `; it does not name ${from}`}`, { path: f.path });
  });
}

/**
 * The refusals of renaming `from` to `to` in `config`, in a fixed order (invalid, unknown, exists); empty when it may.
 * `modelNames` (renameModelNames) are the names the project's model emits, which `to` may not take either.
 */
export function renameProblems(config: RomliftConfig, from: string, to: string, modelNames: ReadonlyMap<string, Addr> = new Map()): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isRenameTarget(to)) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_INVALID', `${JSON.stringify(to)} cannot be a function or symbol name: it must be a C identifier (a letter or _, then letters, digits and _, not a C keyword) of at most 200 characters; nothing was changed`));
  }
  if (entriesNamed(config, from).length === 0) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_UNKNOWN', `romlift.toml has no function or symbol named ${from}, nor one with ${from} as an alias; nothing was changed`));
  }
  const emitted = modelNames.get(to);
  if (projectNames(config).has(to)) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_EXISTS', `romlift.toml already has the name ${to} (a function, a symbol, an alias or a module); nothing was changed`));
  } else if (emitted !== undefined) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_EXISTS', `the project's model already names ${hexAddr(emitted)} ${to} (a default chunk, symbol or label name, or the linker script's __load_<module> of a runs_at module), so generate would refuse it as a second definition; nothing was changed`, { addr: emitted }));
  }
  return out;
}

/**
 * The plan of `rename <from> <to>`: the TOML patched on one line and the identifier edits of every text that names
 * `from`, sorted by path; or the refusal. A text without a sha1 in `inputs.sha1s` is a broken caller contract.
 */
export function planRename(inputs: RenameInputs): RenamePlan {
  const { config, from, to } = inputs;
  const skipped = skippedFileProblems(inputs.skipped ?? [], from);
  const problems = [...renameProblems(config, from, to, inputs.modelNames), ...skipped.filter((d) => d.severity === 'error')];
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const patch = planRenamePatch(inputs.configText, config, from, to);
  if (!patch.ok) return { ok: false, diagnostics: patch.diagnostics };
  const edits: RenameEdit[] = [];
  for (const path of [...inputs.texts.keys()].sort(compareCodeUnits)) {
    const textEdits = renameIdentifiers(inputs.texts.get(path) ?? '', from, to);
    if (textEdits.length === 0) continue;
    const baseSha1 = inputs.sha1s.get(path);
    if (baseSha1 === undefined) throw new RomliftInvariantError(`rename was given ${path} without its sha1`);
    edits.push({ ownership: 'reconciled', path, baseSha1, edits: textEdits });
  }
  return { ok: true, tomlText: patch.text, edits, diagnostics: skipped };
}

/**
 * E_RENAME_INTERRUPTED when the project holds an interrupted write's journal: rename's own write would replace it
 * before the next `generate` finished that run, so it waits for one.
 */
export function renameJournalProblems(journal: Journal | null): readonly Diagnostic[] {
  if (journal === null) return [];
  return [diagnostic(WorkflowCodes, 'E_RENAME_INTERRUPTED', 'the project holds the journal of an interrupted write (.romlift/journal.json): run `romlift generate` to finish it, then rename again; nothing was changed')];
}

/**
 * E_STALE_CONFIG when romlift.toml on disk (`now`, read under the project lock) is not the text the rename was planned
 * from (`read`): an edit landed since, which saving the patch would undo.
 */
export function staleRenameConfig(path: string, read: string, now: string | undefined): readonly Diagnostic[] {
  if (now === read) return [];
  const state = now === undefined ? 'is gone' : 'changed on disk';
  return [diagnostic(WorkflowCodes, 'E_STALE_CONFIG', `${path} ${state} since rename read it; it was not saved: run rename again`, { path })];
}
