// `npm run signatures -- build <spec> [--out <dir>] [--json]` (architecture §7.1, §7.2, D40, D108): builds
// `<out>/<library>.json` (default `<repo>/signatures/`, gitignored) from a spec in signatures/specs/ and its reference
// datasets under ROMLIFT_BENCH_ROOT (romlift/node's buildSignatures). A maintainer's tool of a romlift source checkout:
// it needs the reference decomp checkouts, so it is not a command of the `romlift` CLI.
//
// Text: one line per version, the diagnostics on stderr, the file written. --json: one
// {"type":"version","library","version","functions","tables","references"} line per version, one
// {"type":"diagnostic","code","severity","message"} line per diagnostic, then {"type":"summary","ok","exitCode"}.
// Exit codes: 0 built (warnings allowed), 1 a spec or reference error (nothing written), 2 usage.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Diagnostic, SignatureFile } from 'romlift';
import { buildSignatures, signaturesRepoOf, writeSignatureFile } from 'romlift/node';

import { parseArgs, UsageError } from '../src/args.ts';

const USAGE = 'usage: npm run signatures -- build <spec> [--out <dir>] [--json]';

type Line = Readonly<Record<string, unknown>>;

function diagnosticLine(d: Diagnostic): Line {
  return { type: 'diagnostic', code: d.code, severity: d.severity, message: d.message };
}

function versionLine(file: SignatureFile, v: SignatureFile['versions'][number]): Line {
  return { type: 'version', library: file.library, version: v.id, functions: v.functions.length, tables: v.tables.length, references: v.references.map((r) => r.dataset) };
}

/** Builds and writes one spec's signature file; returns the exit code. */
export async function buildOne(specArg: string, outArg: string | undefined, json: boolean, env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const specPath = resolve(specArg);
  const benchRoot = env['ROMLIFT_BENCH_ROOT'];
  const built = await buildSignatures({ specPath }, benchRoot === undefined || benchRoot === '' ? {} : { benchRoot: resolve(benchRoot) });
  const lines: Line[] = [];
  let diagnostics: readonly Diagnostic[] = built.diagnostics;
  let wrote: string | undefined;
  if (built.ok) {
    lines.push(...built.value.versions.map((v) => versionLine(built.value, v)));
    const outDir = outArg === undefined ? resolve(await signaturesRepoOf(specPath), 'signatures') : resolve(outArg);
    const written = await writeSignatureFile(outDir, built.value);
    if (written.ok) wrote = written.value;
    else diagnostics = [...diagnostics, written.diagnostic];
  }
  const exitCode = wrote !== undefined && diagnostics.every((d) => d.severity !== 'error') ? 0 : 1;
  if (json) {
    const all = [...lines, ...diagnostics.map(diagnosticLine), { type: 'summary', ok: exitCode === 0, exitCode }];
    process.stdout.write(all.map((l) => `${JSON.stringify(l)}\n`).join(''));
    return exitCode;
  }
  for (const d of diagnostics) process.stderr.write(`${d.code} ${d.severity}: ${d.message}\n`);
  for (const l of lines) process.stdout.write(`${String(l['library'])} ${String(l['version'])}: ${String(l['functions'])} functions, ${String(l['tables'])} tables from ${(l['references'] as string[]).join(', ')}\n`);
  if (wrote !== undefined) process.stdout.write(`wrote ${wrote}\n`);
  return exitCode;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseArgs(argv, { options: ['out'], flags: ['json'], maxPositionals: 2 });
    const [verb, spec] = args.positionals;
    if (verb !== 'build' || spec === undefined) throw new UsageError(USAGE);
    return await buildOne(spec, args.options['out'], args.flags.has('json'), process.env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${error.message === USAGE ? '' : `${USAGE}\n`}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv.slice(2));
