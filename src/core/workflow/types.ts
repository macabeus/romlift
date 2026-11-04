// The frozen inputs and plans of the phase-4 workflows (architecture §2.1, §3.4, §6.3 to §6.5, D17, D36, D74):
// `init`, `generate` over a project and `update` each take in-memory inputs the shell read and return
// a plan the shell applies (planWrites, saveConfig). Plain readonly data (D19); the functions live in
// init.ts, generate.ts and update.ts. GenerateInputs and GenerateResult stay in generate.ts (phase 3).
// Phase 6 adds, frozen by its lead (D93): the signature files `init` and `update` read, `init
// --no-signatures`, the headers' real paths for the cpp-exact include resolution, and the CheckProposals contract that
// screens proposals against the analysis and the config (architecture §7.3, §7.4).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { FileEntry } from '../emit/tree.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { Proposal } from '../proposals/types.ts';
import type { AgbccPin, ScaffoldTemplates } from '../scaffold/vars.ts';
import type { SignatureFile } from '../signatures/schema.ts';
import type { GenerateResult } from './generate.ts';

/** `init`'s options: `init <rom> [dir] [--name <name>] [--module-size <bytes>] [--no-signatures] [--json]` (D74, D93). */
export interface InitOptions {
  /** The build name ([build] name, `<name>.gba`, `<name>.sha1`); default from the cartridge header. */
  readonly name?: string;
  /** The size past which a `c` module closes at the next legal border; default DEFAULT_MODULE_SIZE (D20). */
  readonly moduleSize?: number;
  /** false: `--no-signatures`, the signature layer is skipped (architecture §7.3); default true (phase 6). */
  readonly signatures?: boolean;
}

/** What `init` reads: the ROM, the scaffold templates and the pinned agbcc, all read by the shell. */
export interface InitInputs {
  readonly rom: Rom;
  /** The ROM's file name as the user gave it, relative to the project; the project's copy is `baserom.gba`. */
  readonly romFile: string;
  readonly options: InitOptions;
  readonly templates: ScaffoldTemplates;
  /** The exact version of the running romlift, which package.json pins. */
  readonly romliftVersion: string;
  /** templates/agbcc.json. */
  readonly agbcc: AgbccPin;
  /** The analysis profile; default the discover profile (agbcc). */
  readonly profile?: CompilerProfile;
  /**
   * The built signature files the shell located (shell/signatures/locate.ts, phase 6). Empty: the shell looked and
   * found none (the shell's W_SIGNATURES_ABSENT, which the CLI reports; the plan names no library); absent: none was
   * looked for (an API caller, or `--no-signatures`).
   */
  readonly signatureFiles?: readonly SignatureFile[];
  /**
   * The shell's notes on the files it located (W_SIGNATURE_FILE_SKIPPED, W_SIGNATURES_ABSENT; shell/signatures/locate.ts
   * loadSignatureFiles), which the plan reports only when the signature layer runs (not with `--no-signatures`, D95 b).
   */
  readonly signatureNotes?: readonly Diagnostic[];
}

/** One text file `init` owns: its project path and its text (architecture-a2-6). */
export type InitFile = readonly [path: string, text: string];

/**
 * `init`'s plan: the config and its canonical TOML (`romlift.toml`), the files init owns as data (romlift.toml and
 * decomp.yaml as [path, text] pairs, and the project path the ROM is copied to, `baserom.gba`; the shell only writes
 * and hashes them, architecture-a2-6), the checked generate over that config (its tree, c stubs and modules.mk
 * included, re-emitted by generatedEntries for the write pass) and the scaffold entries. Refused (`ok: false`) when
 * discover or a self-check fails: nothing is written.
 */
export type InitPlan =
  | {
      readonly ok: true;
      readonly config: RomliftConfig;
      /** romlift.toml's text, also the first of `files`. */
      readonly tomlText: string;
      /** romlift.toml, then decomp.yaml. */
      readonly files: readonly InitFile[];
      /** Where the ROM is copied in the project. */
      readonly romCopy: string;
      readonly result: GenerateResult;
      readonly scaffold: readonly FileEntry[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** A project as `generate`, `update`, `rename` and the project mode of `explain` read it. */
export interface ProjectInputs {
  readonly rom: Rom;
  /** romlift.toml as it is on disk; generate never writes it (g4.no-toml-write). */
  readonly configText: string;
  /** configText parsed (parseConfig). */
  readonly config: RomliftConfig;
  /**
   * The SHA-1 of romlift.toml's bytes, which the shell hashed (fix round 6, D82): modules.mk records it, so `make` and
   * setup.sh know a tree older than the TOML. Absent: modules.mk records none (a tree written outside a project).
   */
  readonly configSha1?: string;
  /** Every `src/<module>.c` path -> its text: the C the DecompState and the stub check read. */
  readonly cTexts: ReadonlyMap<string, string>;
  /**
   * The project paths of the chunk files on disk (`asm/nonmatchings/<module>/<name>.s`): the tree romlift last
   * generated, whose function names tell the C of a renamed or deleted function from a helper (D78 a). Absent when
   * the shell read none.
   */
  readonly previousChunkFiles?: readonly string[];
  /**
   * Every file under `include/` and every `.h` under `src/` -> its text (fix round 10, correctness-c2-1; `src/` since
   * fix round 11, correctness-d0-2): the headers the C reconciliation follows to learn whether a file already gets
   * INCLUDE_ASM from its own includes or those of its fragments. Absent: none is followed.
   */
  readonly headerTexts?: ReadonlyMap<string, string>;
  /**
   * A header's key (a key of headerTexts, its path through any symbolic link) or a C file's (a key of cTexts) -> the
   * real path of its directory joined with its own name, relative to the project, or absolute outside it (phase 6, for
   * the cpp-exact resolution of a quoted include from a followed header's real directory; roadmap "Carried from phase
   * 4", D89 a, D90 a; core/reconcile/c-scan.ts IncludeRealPaths). The directory's, not the file's: cpp resolves a
   * quoted include of a header that is itself a link to a file from the link's directory. Only where it differs from
   * the key. Absent: every file is where its key says.
   */
  readonly headerRealPaths?: ReadonlyMap<string, string>;
  /** The analysis profile; default the discover profile (agbcc). */
  readonly profile?: CompilerProfile;
}

/**
 * `generate`'s plan over a project: the checked emission (generatedEntries re-emits it for the write pass), or a
 * refusal before any analysis (the ROM is not the one [rom] sha1 names). A failed self-check is in
 * `result.report`, and nothing is written then either.
 */
export type GeneratePlan =
  | { readonly ok: true; readonly result: GenerateResult; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** What `update` reads: the project's ROM and its TOML, and from phase 6 the built signature files. */
export interface UpdateInputs {
  readonly rom: Rom;
  readonly configText: string;
  readonly config: RomliftConfig;
  readonly profile?: CompilerProfile;
  /** The built signature files the shell located; absent or empty: none (or `[signatures] enabled = false`). */
  readonly signatureFiles?: readonly SignatureFile[];
  /** The shell's notes on them, which the plan reports only while `[signatures] enabled` (D95 b). */
  readonly signatureNotes?: readonly Diagnostic[];
}

/**
 * `update`'s plan: the proposals the discover run makes against the config, and the patched TOML
 * (planPatch); `changed` is false when the text is unchanged. `--write` saves `text`; a refused patch
 * (E_TOML_PATCH_REFUSED) is `ok: false`.
 */
export type UpdatePlan =
  | {
      readonly ok: true;
      readonly proposals: readonly Proposal[];
      readonly text: string;
      readonly changed: boolean;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** What a proposal is screened against (architecture §7.4, D93): the discover analysis and, when there is one, the config. */
export interface CheckProposalsContext {
  readonly analysis: AnalysisResult;
  readonly config?: RomliftConfig;
}

/**
 * The screened proposals: those kept, in their input order, and one W_EVIDENCE_CONFLICT diagnostic (at the address,
 * span or cites of the contradiction) per proposal that contradicts the analysis or the config, which is dropped: a
 * contradiction is reported, never resolved (g6.evidence-conflict).
 */
export interface ProposalCheck {
  readonly kept: readonly Proposal[];
  readonly conflicts: readonly Diagnostic[];
}

/** The screen every external proposal passes before `init` folds it or `update` patches it (p6-proposals). */
export type CheckProposals = (proposals: readonly Proposal[], cx: CheckProposalsContext) => ProposalCheck;
