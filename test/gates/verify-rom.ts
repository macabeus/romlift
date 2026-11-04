// The tree checks of a ROM, as the g3 and g4 gates run them (architecture §6.4, D108): generateFromRom (discover,
// configFromDiscover, the confirm model and the self-checks), then the toolchain checks asked for (runToolchainChecks:
// the tree written under os.tmpdir(), each module assembled against its ROM range, the image linked against the ROM's
// SHA-1). Everything comes from romlift's entry points through cx.need.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GateContext } from './gate.ts';

export type CheckId = 'tiling' | 'reencode' | 'module-size' | 'text-layout' | 'paths' | 'assemble' | 'link';

interface Diagnostic {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
}

interface Check {
  readonly id: CheckId;
  readonly ok: boolean;
  readonly detail: string;
  readonly diagnostics: readonly Diagnostic[];
}

type Generated =
  | { readonly ok: true; readonly diagnostics: readonly Diagnostic[]; readonly report: { readonly ok: boolean; readonly checks: readonly Check[] } }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

type RomFromBytes = (bytes: Uint8Array, sha1: string) => unknown;
type Sha1Of = (bytes: Uint8Array) => string;
type GenerateFromRom = (rom: unknown, inputs: { readonly decomp: { readonly defined: readonly string[] }; readonly printer: 'readable' | 'raw' }) => Generated;
type RunToolchainChecks = (rom: unknown, result: Extract<Generated, { ok: true }>, flags: { readonly assemble: boolean; readonly link: boolean }, env: NodeJS.ProcessEnv) => Promise<{ readonly checks: readonly Check[]; readonly sha1?: string }>;

/** What a gate needs exported for verifyRom. */
export const VERIFY_NEEDS: readonly string[] = ['romFromBytes', 'sha1Of', 'generateFromRom', 'runToolchainChecks'];

export interface Target {
  readonly name: string;
  readonly rom: string;
  /** The SHA-1 a link must reproduce. */
  readonly sha1: string;
}

export interface Verified {
  /** Every check passed and no diagnostic is an error. */
  readonly ok: boolean;
  readonly checks: ReadonlyMap<CheckId, { readonly ok: boolean; readonly detail: string }>;
  /** The error diagnostics: the analysis', the model's and every check's. */
  readonly errors: readonly string[];
  /** The linked image's SHA-1, with `link`. */
  readonly sha1?: string;
}

/** Every committed fixture, plus every tuning ROM on the real tier. */
export async function targets(cx: GateContext): Promise<readonly Target[]> {
  if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
  const out: Target[] = [];
  for (const f of cx.fixtures) out.push({ name: f.name, rom: f.rom, sha1: createHash('sha1').update(await readFile(f.rom)).digest('hex') });
  if (cx.tier === 'real') for (const d of cx.datasets) out.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom), sha1: d.sha1 });
  return out;
}

/** The checks of `target`'s tree with `printer`, and the toolchain checks `assemble` and `link` when asked for. */
export async function verifyRom(
  cx: GateContext,
  target: Target,
  options: { readonly printer?: 'readable' | 'raw'; readonly assemble?: boolean; readonly link?: boolean } = {},
): Promise<Verified> {
  const bytes = new Uint8Array(await readFile(target.rom));
  const rom = cx.need<RomFromBytes>('romFromBytes')(bytes, cx.need<Sha1Of>('sha1Of')(bytes));
  const result = cx.need<GenerateFromRom>('generateFromRom')(rom, { decomp: { defined: [] }, printer: options.printer ?? 'readable' });
  if (!result.ok) return { ok: false, checks: new Map(), errors: result.diagnostics.map((d) => `${d.code}: ${d.message}`) };
  const toolchain = await cx.need<RunToolchainChecks>('runToolchainChecks')(rom, result, { assemble: options.assemble === true, link: options.link === true }, process.env);
  const all = [...result.report.checks, ...toolchain.checks];
  const errors = [...result.diagnostics, ...all.flatMap((c) => c.diagnostics)].filter((d) => d.severity === 'error').map((d) => `${d.code}: ${d.message}`);
  return {
    ok: errors.length === 0 && all.every((c) => c.ok),
    checks: new Map(all.map((c) => [c.id, { ok: c.ok, detail: c.detail }])),
    errors,
    ...(toolchain.sha1 === undefined ? {} : { sha1: toolchain.sha1 }),
  };
}

/** The ids among `required` that did not pass, with their details, then the error diagnostics. */
export function failedChecks(result: Verified, required: readonly CheckId[]): readonly string[] {
  const failed = required.flatMap((id) => {
    const check = result.checks.get(id);
    if (check === undefined) return [`${id} not reported`];
    return check.ok ? [] : [`${id}: ${check.detail}`];
  });
  return [...failed, ...result.errors];
}
