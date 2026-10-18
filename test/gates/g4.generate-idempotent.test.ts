// g4.generate-idempotent (architecture §6.4, §12 "confirm mode diverges", §13): `generate` right after `init`
// gives an identical tree. In a directory holding only the ROM, `init` writes the project; then `generate
// --dry-run --json` must plan only `keep` operations, and `generate --json` must leave every file with the
// same content and the same modification time (so `make` stays incremental). The ci tier runs every
// committed fixture; the real tier adds the five tuning ROMs.
//
// Expected interfaces, for the phase-4 lead to align (architecture §2.1, §6.4):
//   romlift init <rom> --json, romlift generate --json    exit 0; NDJSON, last line {"type":"summary","exitCode":0}
//   romlift generate --dry-run --json                     exit 0; one line per write-plan op,
//     {"type":"op","op":"write"|"edit"|"delete"|"keep","path":string}, then the summary
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { type ExecResult, type GateContext, byCodeUnit, gate } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly op?: string;
  readonly path?: string;
  readonly exitCode?: number;
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

interface FileState {
  readonly sha1: string;
  readonly mtimeMs: number;
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}


async function snapshot(dir: string, prefix = ''): Promise<Map<string, FileState>> {
  const out = new Map<string, FileState>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (relative === '.git') continue;
    const file = path.join(dir, relative);
    if (entry.isDirectory()) for (const [key, value] of await snapshot(dir, relative)) out.set(key, value);
    else if (entry.isFile()) out.set(relative, { sha1: createHash('sha1').update(await readFile(file)).digest('hex'), mtimeMs: (await stat(file)).mtimeMs });
  }
  return out;
}

function differences(before: ReadonlyMap<string, FileState>, after: ReadonlyMap<string, FileState>): readonly string[] {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort(byCodeUnit);
  return keys.flatMap((key) => {
    const a = before.get(key);
    const b = after.get(key);
    if (a === undefined) return [`${key} created`];
    if (b === undefined) return [`${key} deleted`];
    if (a.sha1 !== b.sha1) return [`${key} rewritten with other content`];
    if (a.mtimeMs !== b.mtimeMs) return [`${key} rewritten`];
    return [];
  });
}

async function romlift(cx: GateContext, cwd: string, args: readonly string[]): Promise<readonly CliLine[]> {
  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', cli, ...args, '--json'], { cwd });
  const lines = cx.jsonLines<CliLine>(run.stdout);
  const last = lines[lines.length - 1];
  if (run.code !== 0 || last?.type !== 'summary' || last.exitCode !== 0) throw new Error(`romlift ${args.join(' ')} --json exited ${run.code}:\n${tail(run)}`);
  return lines;
}

gate({
  id: 'g4.generate-idempotent',
  phase: 4,
  tier: 'both',
  realInputs: ['roms'],
  needs: ['init', 'generate'],
  async run(cx) {
    const targets: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });
    const base = await cx.tmpDir('romlift-idempotent-');
    const problems: string[] = [];
    for (const target of targets) {
      const dir = path.join(base, target.name);
      await mkdir(dir, { recursive: true });
      await copyFile(target.rom, path.join(dir, 'baserom.gba'));
      await romlift(cx, dir, ['init', 'baserom.gba']);
      const before = await snapshot(dir);
      const plan = await romlift(cx, dir, ['generate', '--dry-run']);
      const ops = plan.filter((l) => l.type === 'op');
      const active = ops.filter((l) => l.op !== 'keep').map((l) => `${l.op ?? '?'} ${l.path ?? '?'}`);
      if (ops.length === 0) problems.push(`${target.name}: generate --dry-run printed no op`);
      if (active.length > 0) problems.push(`${target.name}: generate after init plans ${active.length} changes: ${active.slice(0, 8).join(', ')}`);
      await romlift(cx, dir, ['generate']);
      const changed = differences(before, await snapshot(dir));
      if (changed.length > 0) problems.push(`${target.name}: generate after init changed ${changed.length} files: ${changed.slice(0, 8).join(', ')}`);
      cx.note(`${target.name}: ${before.size} files, ${ops.length} ops all keep`);
    }
    if (problems.length > 0) throw new Error(`generate is not idempotent after init: ${problems.join(' | ')}`);
    cx.note(`generate after init changes no file on ${targets.length} ROMs`);
  },
});
