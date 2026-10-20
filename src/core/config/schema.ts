// The in-memory project config (architecture §3.4, §6.5, D9, D22, D47): what `romlift.toml` (schema 1)
// means once parsed, and a zod schema that validates such a value in memory. Phase 3 builds the config
// in memory (core/workflow/config-from-discover.ts); phase 4 parses and serialises the TOML into the same
// shape (parse.ts, serialize.ts, with their codes). The phase-5 key `data_start` is not part of schema 1
// yet (D62). Addresses are numbers here; the TOML spells them '0x' and eight upper-case hex digits.
import { z } from 'zod';

import { isModuleName, isSymbolName, MODULE_NAME_RULE, SYMBOL_NAME_RULE } from '../../foundation/asm/dialect.ts';
import type { Addr, Mode } from '../../foundation/rom/span.ts';
import { BASEROM_FILE } from '../../foundation/util/project-files.ts';
import { isBuildCompilerId } from './compilers.ts';
import type { BuildCompilerId } from './compilers.ts';

export interface ModuleConfig {
  readonly name: string;
  /** A legal border (core/layout/borders.ts); starts increase in link order. */
  readonly start: Addr;
  readonly kind: 'asm' | 'c' | 'data';
  /** false: romlift never writes nor deletes the module's files. */
  readonly generated: boolean;
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
  /** A typed global label inside the containing function, not a chunk start. */
  readonly label?: boolean;
  readonly aliases: readonly string[];
  /** Where a proposed entry came from: a sourceKey (core/proposals/types.ts, D9). */
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
  readonly symbols: ReadonlyMap<Addr, SymbolConfig>;
  readonly overrides: readonly OverrideConfig[];
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
/** The message of a compiler the registry does not know, which parse.ts reports as E_UNKNOWN_COMPILER. */
export const UNKNOWN_COMPILER = 'not a registered build compiler (core/config/compilers.ts)';
const compilerId = z.string().refine(isBuildCompilerId, UNKNOWN_COMPILER);

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
    generated: z.boolean(),
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
    label: z.boolean().exactOptional(),
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
}

export type ConfigValidation =
  | { readonly ok: true; readonly config: RomliftConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] };

function pathText(path: readonly PropertyKey[]): string {
  return path.map((key) => (typeof key === 'number' ? `[${key}]` : `.${String(key)}`)).join('').replace(/^\./, '');
}

/** Validates an in-memory config against schema 1; every issue at once, never a throw. */
export function validateConfig(value: unknown): ConfigValidation {
  const parsed = ROMLIFT_CONFIG_SCHEMA.safeParse(value);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: pathText(issue.path), message: issue.message })) };
}
