// g3.text-layout (architecture §6.4, §13, D49): every file the emission stream produces, parsed back and
// laid out from its module start, reproduces the ROM range byte for byte, and every `.align` emits exactly
// its padding item; on every committed fixture (ci and real tiers) and every tuning ROM (real tier).
//
// Expected output, for the phase-3 lead to align (architecture §2.1, §6.4):
//   romlift verify --rom <rom> [--link] [--printer raw] --json   run from an empty directory, so the
//   config is the one configFromDiscover builds; exit 0 when every check passes, 3 when one fails.
//   NDJSON on stdout:
//     {"type":"check","id":"tiling"|"reencode"|"module-size"|"text-layout"|"link","status":"ok"|"fail","detail":string}
//     {"type":"diagnostic",...}                     (any number)
//     {"type":"summary","ok":boolean,"exitCode":number,"sha1"?:string}   (last; sha1 of the linked ROM with --link)
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

type CheckId = 'tiling' | 'reencode' | 'module-size' | 'text-layout' | 'link';

type VerifyLine =
  | { readonly type: 'check'; readonly id: CheckId; readonly status: 'ok' | 'fail'; readonly detail: string }
  | { readonly type: 'diagnostic'; readonly code?: string; readonly message?: string }
  | { readonly type: 'summary'; readonly ok: boolean; readonly exitCode: number; readonly sha1?: string };

interface Target {
  readonly name: string;
  readonly rom: string;
  /** The SHA-1 a link must reproduce. */
  readonly sha1: string;
}

interface Verified {
  readonly code: number;
  readonly checks: ReadonlyMap<string, { readonly status: string; readonly detail: string }>;
  readonly summary: Extract<VerifyLine, { type: 'summary' }>;
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** Every committed fixture, plus every tuning ROM on the real tier. */
async function targets(cx: GateContext): Promise<readonly Target[]> {
  if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
  const out: Target[] = [];
  for (const f of cx.fixtures) out.push({ name: f.name, rom: f.rom, sha1: createHash('sha1').update(await readFile(f.rom)).digest('hex') });
  if (cx.tier === 'real') for (const d of cx.datasets) out.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom), sha1: d.sha1 });
  return out;
}

async function verify(cx: GateContext, target: Target, flags: readonly string[]): Promise<Verified> {
  const cwd = await cx.tmpDir('romlift-verify-');
  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', cli, 'verify', '--rom', target.rom, ...flags, '--json'], { cwd });
  let lines: readonly VerifyLine[];
  try {
    lines = cx.jsonLines<VerifyLine>(run.stdout);
  } catch (error) {
    throw new Error(`${target.name}: verify ${flags.join(' ')} --json printed bad NDJSON (${error instanceof Error ? error.message : String(error)}):\n${tail(run)}`);
  }
  const summary = lines[lines.length - 1];
  if (summary?.type !== 'summary') throw new Error(`${target.name}: verify ${flags.join(' ')} --json exited ${run.code} without a summary:\n${tail(run)}`);
  const checks = new Map<string, { readonly status: string; readonly detail: string }>();
  for (const line of lines) if (line.type === 'check') checks.set(line.id, { status: line.status, detail: line.detail });
  return { code: run.code, checks, summary };
}

/** The ids among `required` that did not report `ok`, with their details. */
function failedChecks(result: Verified, required: readonly CheckId[]): readonly string[] {
  return required.flatMap((id) => {
    const check = result.checks.get(id);
    if (check === undefined) return [`${id} not reported`];
    return check.status === 'ok' ? [] : [`${id}: ${check.detail}`];
  });
}

gate({
  id: 'g3.text-layout',
  phase: 3,
  tier: 'both',
  realInputs: ['roms'],
  needs: ['buildModel', 'emitTree', 'checkEntry'],
  async run(cx) {
    const problems: string[] = [];
    const list = await targets(cx);
    for (const target of list) {
      const result = await verify(cx, target, []);
      const failed = failedChecks(result, ['text-layout']);
      if (failed.length > 0 || result.code !== 0) problems.push(`${target.name} (exit ${result.code}): ${failed.join('; ') || 'summary not ok'}`);
    }
    if (problems.length > 0) throw new Error(`text layout fails: ${problems.join(' | ')}`);
    cx.note(`the text-layout check passes on ${list.length} ROMs (${cx.fixtures.length} fixtures${cx.tier === 'real' ? `, ${cx.datasets.length} tuning ROMs` : ''})`);
  },
});
