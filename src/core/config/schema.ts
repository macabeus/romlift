// The in-memory project config (architecture §3.4, §6.5, D9, D22, D47): what `romlift.toml` (schema 1)
// means once parsed, and a zod schema that validates such a value in memory. Phase 3 builds the config
// in memory (core/workflow/config-from-discover.ts); phase 4 parses and serialises the TOML into the same
// shape (parse.ts, serialize.ts, with their codes). Phase 6 adds the module key `data_start` (`dataStart`, the C data
// range of a module, D76 g, D92, D93): syntax only here; whether it is legal for its module is the model's question
// (p6-c-data-expected). Addresses are numbers here; the TOML spells them '0x' and eight upper-case hex digits.
import { z } from 'zod';

import { isModuleName, isSymbolName, MODULE_NAME_RULE, SYMBOL_NAME_RULE } from '../../foundation/asm/dialect.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import { BASEROM_FILE } from '../../foundation/util/project-files.ts';
import { compareNumbers, sortedEntries } from '../../foundation/util/sorted.ts';
import { isBuildCompilerId } from './compilers.ts';
import type { BuildCompilerId } from './compilers.ts';

export interface ModuleConfig {
  readonly name: string;
  /** A legal border (core/layout/borders.ts); starts increase in link order. */
  readonly start: Addr;
  readonly kind: 'asm' | 'c' | 'data';
  /**
   * The module's C data range starts here (`data_start`, phase 6, D92): the bytes from it to the module's end are the
   * `.rodata`/`.data` its C object may define instead of the ROM's slice (architecture §6.6). Syntax only in the config.
   */
  readonly dataStart?: Addr;
  /** false: romlift never writes nor deletes the module's files. */
  readonly generated: boolean;
  /**
   * A hand-written assembly source the module builds from instead of a generated one (`source`, D109): a project path
   * the user owns. Syntax only in the config; whether it is legal for its module is the model's question.
   */
  readonly source?: string;
  readonly library?: string;
  readonly version?: string;
  /** Default: build.compiler (D47). */
  readonly compiler?: BuildCompilerId;
  /** Appended to the compiler's default flags. */
  readonly cflags?: readonly string[];
}

export interface FunctionConfig {
  readonly name: string;
  readonly mode: Mode;
  readonly size?: number;
  readonly aliases: readonly string[];
  /** Where a proposed entry came from: a sourceKey (core/proposals/types.ts, D9). */
  readonly from?: string;
}

/**
 * An `[entry_points]` entry (D116): a named entry point inside a function's code, not a function of its own. It gets a
 * global label in the file of the function around it (the nearest `[functions]` entry below it) and no file of its own;
 * the analysis does not cut that function there (D114).
 */
export interface EntryPointConfig {
  readonly name: string;
  readonly mode: Mode;
  /** The entry point's own extent, when known (an ELF's size): it never cuts the function around it. */
  readonly size?: number;
  readonly aliases: readonly string[];
  readonly from?: string;
}

export interface SymbolConfig {
  readonly name: string;
  readonly size?: number;
  readonly type?: 'pointers' | 'bytes';
  readonly aliases: readonly string[];
  readonly from?: string;
}

export interface OverrideConfig {
  readonly start: Addr;
  readonly size: number;
  readonly kind: 'code' | 'data';
  readonly mode?: Mode;
  /** The run address of `start` (§6.7). */
  readonly runsAt?: Addr;
  readonly from?: string;
}

export interface RomliftConfig {
  readonly schema: 1;
  readonly rom: { readonly path: string; readonly sha1: string };
  /** `compiler` is the default build compiler of every module. */
  readonly build: { readonly name: string; readonly compiler: BuildCompilerId };
  readonly signatures: { readonly enabled: boolean; readonly libraries?: readonly string[] };
  /** In link order. */
  readonly modules: readonly ModuleConfig[];
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
  readonly entryPoints: ReadonlyMap<Addr, EntryPointConfig>;
  readonly symbols: ReadonlyMap<Addr, SymbolConfig>;
  readonly overrides: readonly OverrideConfig[];
}

/**
 * Every listed entry of `config`, functions and entry points together, by address: what the analysis seeds, the model
 * names and labels, and `rename` finds. An address is in one table only (parse.ts E_DUPLICATE_ADDRESS).
 */
export function listedEntries(config: Pick<RomliftConfig, 'functions' | 'entryPoints'>): ReadonlyMap<Addr, FunctionConfig> {
  const all: [Addr, FunctionConfig][] = [];
  for (const [addr, f] of sortedEntries(config.functions)) all.push([addr, f]);
  for (const [addr, e] of sortedEntries(config.entryPoints)) if (!config.functions.has(addr)) all.push([addr, e]);
  return new Map(all.sort((a, b) => compareNumbers(a[0], b[0])));
}

// ---------------------------------------------------------------------------------------------------
// The zod schema. Shapes only: cross-entry rules (module order and borders, duplicate names, override
// validity) are the model's (core/model codes), and TOML spelling is the parser's (phase 4).

const address = z.number().int().min(0).max(0xffff_ffff);
const size = z.number().int().min(1).max(0xffff_ffff);
const mode = z.enum(['thumb', 'arm']);
/** An assembler symbol: what a function, symbol or alias name must be to print and link (dialect.ts isSymbolName). */
const symbolName = z.string().refine(isSymbolName, `not an assembler symbol name (${SYMBOL_NAME_RULE})`);
/** A module name: it names files (asm/<name>.s), objects and linker sections. */
const moduleName = z.string().refine(isModuleName, `not a module name (${MODULE_NAME_RULE})`);
/** The message of a compiler the registry does not know. */
const UNKNOWN_COMPILER = 'not a registered build compiler (core/config/compilers.ts)';
/**
 * The structured marker of that refinement, which validateConfig carries into the issue's `code` and parse.ts reports
 * as E_UNKNOWN_COMPILER: the code follows the refinement, never its human-readable message (architecture-r1-5, D76 h).
 */
const UNKNOWN_COMPILER_PARAMS = { romliftCode: 'E_UNKNOWN_COMPILER' } as const;
const compilerId = z.string().refine(isBuildCompilerId, { message: UNKNOWN_COMPILER, params: UNKNOWN_COMPILER_PARAMS });

/** What a build name is (`<name>.gba`, `<name>.sha1`, a make target): what `init` accepts and writes (D75 i). */
export const BUILD_NAME_RULE = "letters, digits, '.', '_' and '-', a letter or digit first, at most 100 characters";
const BUILD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Whether `name` is a build name (BUILD_NAME_RULE). */
export function isBuildName(name: string): boolean {
  return BUILD_NAME.test(name);
}
const buildName = z.string().refine(isBuildName, `not a build name (${BUILD_NAME_RULE})`);
/** The project's ROM: always baserom.gba (D74 c), which setup.sh, the Makefile and every `.incbin` name. */
const romPath = z.string().refine((path): boolean => path === BASEROM_FILE, `the project's ROM is always ${BASEROM_FILE}, which setup.sh, the Makefile and every .incbin name (D74 c)`);
const sha1 = z.string().regex(/^[0-9a-f]{40}$/, 'not a lower-case hex SHA-1');
const nonEmpty = z.string().min(1);

const moduleSchema = z
  .object({
    name: moduleName,
    start: address,
    kind: z.enum(['asm', 'c', 'data']),
    dataStart: address.exactOptional(),
    generated: z.boolean(),
    source: nonEmpty.exactOptional(),
    library: nonEmpty.exactOptional(),
    version: nonEmpty.exactOptional(),
    compiler: compilerId.exactOptional(),
    cflags: z.array(nonEmpty).readonly().exactOptional(),
  })
  .strict()
  .readonly();

const functionSchema = z
  .object({
    name: symbolName,
    mode,
    size: size.exactOptional(),
    aliases: z.array(symbolName).readonly(),
    from: nonEmpty.exactOptional(),
  })
  .strict()
  .readonly();

const entryPointSchema = z
  .object({
    name: symbolName,
    mode,
    size: size.exactOptional(),
    aliases: z.array(symbolName).readonly(),
    from: nonEmpty.exactOptional(),
  })
  .strict()
  .readonly();

const symbolSchema = z
  .object({
    name: symbolName,
    size: size.exactOptional(),
    type: z.enum(['pointers', 'bytes']).exactOptional(),
    aliases: z.array(symbolName).readonly(),
    from: nonEmpty.exactOptional(),
  })
  .strict()
  .readonly();

const overrideSchema = z
  .object({
    start: address,
    size,
    kind: z.enum(['code', 'data']),
    mode: mode.exactOptional(),
    runsAt: address.exactOptional(),
    from: nonEmpty.exactOptional(),
  })
  .strict()
  .readonly();

const ROMLIFT_CONFIG_SCHEMA = z
  .object({
    schema: z.literal(1),
    rom: z.object({ path: romPath, sha1 }).strict().readonly(),
    build: z.object({ name: buildName, compiler: compilerId }).strict().readonly(),
    signatures: z
      .object({ enabled: z.boolean(), libraries: z.array(nonEmpty).readonly().exactOptional() })
      .strict()
      .readonly(),
    modules: z.array(moduleSchema).readonly(),
    functions: z.map(address, functionSchema).readonly(),
    entryPoints: z.map(address, entryPointSchema).readonly(),
    symbols: z.map(address, symbolSchema).readonly(),
    overrides: z.array(overrideSchema).readonly(),
  })
  .strict()
  .readonly();

// The schema's output is exactly the interface above, so neither can drift from the other.
type SchemaOutput = z.output<typeof ROMLIFT_CONFIG_SCHEMA>;
const sameShape: [SchemaOutput] extends [RomliftConfig] ? ([RomliftConfig] extends [SchemaOutput] ? true : false) : false = true;
void sameShape;

/** One problem validateConfig found: the path of the offending member and what is wrong. */
export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
  /** Present when the issue has a code of its own: a compiler the registry does not know. */
  readonly code?: 'E_UNKNOWN_COMPILER';
}

export type ConfigValidation =
  | { readonly ok: true; readonly config: RomliftConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

function pathText(path: readonly PropertyKey[]): string {
  return path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('').replace(/^\./, '');
}

/** The issue's own code, read from its refinement's structured marker. */
function issueCode(issue: z.core.$ZodIssue): Pick<ConfigIssue, 'code'> {
  return issue.code === 'custom' && issue.params?.['romliftCode'] === UNKNOWN_COMPILER_PARAMS.romliftCode ? { code: 'E_UNKNOWN_COMPILER' } : {};
}

/** Validates an in-memory config against schema 1; every issue at once, never a throw. */
export function validateConfig(value: unknown): ConfigValidation {
  const parsed = ROMLIFT_CONFIG_SCHEMA.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: pathText(issue.path), message: issue.message, ...issueCode(issue) })) };
}
