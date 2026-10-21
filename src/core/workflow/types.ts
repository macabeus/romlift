// The frozen inputs and plans of the phase-4 workflows (architecture §2.1, §3.4, §6.3 to §6.5, D17, D36, D74):
// `init`, `generate` over a project and `analyze --update` each take in-memory inputs the shell read and return
// a plan the shell applies (planWrites, saveConfig). Plain readonly data (D19); the functions live in
// init.ts, generate.ts and analyze-update.ts. GenerateInputs and GenerateResult stay in generate.ts (phase 3).
import type { Diagnostic } from '../../foundation/diagnostics/diagnostic.ts';
import type { Rom } from '../../foundation/rom/rom.ts';
import type { RomliftConfig } from '../config/schema.ts';
import type { FileEntry } from '../emit/tree.ts';
import type { CompilerProfile } from '../profile/types.ts';
import type { Proposal } from '../proposals/types.ts';
import type { AgbccPin, ScaffoldTemplates } from '../scaffold/vars.ts';
import type { GenerateResult } from './generate.ts';

/** `init`'s options: `init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]` (`--no-signatures` is phase 6's, D74). */
export interface InitOptions {
  /** The build name ([build] name, `<name>.gba`, `<name>.sha1`); default from the cartridge header. */
  readonly name?: string;
  /** The size past which a `c` module closes at the next legal border; default DEFAULT_MODULE_SIZE (D20). */
  readonly moduleSize?: number;
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
}

/**
 * `init`'s plan: the config and its canonical TOML (`romlift.toml`), `decomp.yaml`, the checked generate over that
 * config (its tree, c stubs and modules.mk included, re-emitted by generatedEntries for the write pass) and the
 * scaffold entries. Refused (`ok: false`) when discover or a self-check fails: nothing is written.
 */
export type InitPlan =
  | {
      readonly ok: true;
      readonly config: RomliftConfig;
      readonly tomlText: string;
      readonly decompYamlText: string;
      readonly result: GenerateResult;
      readonly scaffold: readonly FileEntry[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/** A project as `generate` and the project mode of `model`, `verify` and `explain` read it. */
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

/** What `analyze --update` reads: the project's ROM and its TOML. */
export interface AnalyzeUpdateInputs {
  readonly rom: Rom;
  readonly configText: string;
  readonly config: RomliftConfig;
  readonly profile?: CompilerProfile;
}

/**
 * `analyze --update`'s plan: the proposals the discover run makes against the config, and the patched TOML
 * (planPatch); `changed` is false when the text is unchanged. `--write` saves `text`; a refused patch
 * (E_TOML_PATCH_REFUSED) is `ok: false`.
 */
export type AnalyzeUpdatePlan =
  | {
      readonly ok: true;
      readonly proposals: readonly Proposal[];
      readonly text: string;
      readonly changed: boolean;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
