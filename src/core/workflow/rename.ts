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
// one, or a module name) and the TOML patch's E_TOML_PATCH_REFUSED. Pure: the shell reads, hashes and writes.
import { isSymbolName } from '../../foundation/asm/dialect.ts';
import { diagnostic, RomliftInvariantError } from '../../foundation/diagnostics/diagnostic.ts';
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import { compareCodeUnits } from '../../foundation/util/sorted.ts';
import { entriesNamed, planRenamePatch } from '../config/rename-patch.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { FileEntry } from '../emit/tree.ts';
import { renameIdentifiers } from '../reconcile/rename-tokens.ts';
import type { Journal } from '../write-plan/journal.ts';
import { WorkflowCodes } from './codes.ts';

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
}

/** One file's identifier edits: a reconciled entry over the text the shell read. */
export type RenameEdit = Extract<FileEntry, { readonly ownership: 'reconciled' }>;

/** `rename`'s plan: the patched TOML and the C edits, or the refusal (nothing to write). */
export type RenamePlan =
  | { readonly ok: true; readonly tomlText: string; readonly edits: readonly RenameEdit[]; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** The keywords of C (C99 and C11, with GCC's spellings agbcc reads), which no function can be called. */
const C_KEYWORDS: ReadonlySet<string> = new Set([
  'asm', 'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern',
  'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'switch', 'typedef', 'typeof', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool',
  '_Complex', '_Imaginary', '_Alignas', '_Alignof', '_Atomic', '_Generic', '_Noreturn', '_Static_assert',
  '_Thread_local', '__asm__', '__attribute__', '__inline__', '__typeof__', '__volatile__', '__const__', '__signed__',
  '__extension__', '__label__', '__restrict__',
]);

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

/** The refusals of renaming `from` to `to` in `config`, in a fixed order (invalid, unknown, exists); empty when it may. */
export function renameProblems(config: RomliftConfig, from: string, to: string): readonly Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!isRenameTarget(to)) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_INVALID', `${JSON.stringify(to)} cannot be a function or symbol name: it must be a C identifier (a letter or _, then letters, digits and _, not a C keyword) of at most 200 characters; nothing was changed`));
  }
  if (entriesNamed(config, from).length === 0) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_UNKNOWN', `romlift.toml has no function or symbol named ${from}, nor one with ${from} as an alias; nothing was changed`));
  }
  if (projectNames(config).has(to)) {
    out.push(diagnostic(WorkflowCodes, 'E_RENAME_EXISTS', `romlift.toml already has the name ${to} (a function, a symbol, an alias or a module); nothing was changed`));
  }
  return out;
}

/**
 * The plan of `rename <from> <to>`: the TOML patched on one line and the identifier edits of every text that names
 * `from`, sorted by path; or the refusal. A text without a sha1 in `inputs.sha1s` is a broken caller contract.
 */
export function planRename(inputs: RenameInputs): RenamePlan {
  const { config, from, to } = inputs;
  const problems = renameProblems(config, from, to);
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
  return { ok: true, tomlText: patch.text, edits, diagnostics: [] };
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
