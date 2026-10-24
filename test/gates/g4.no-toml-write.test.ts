// g4.no-toml-write (architecture §1 R3, §6.3, §13, D8, D9): `generate` never opens romlift.toml for writing.
// On every committed fixture, after `init`, `generate` runs three times (with the tree current, with asm/
// deleted so every file is rewritten, and with --dry-run) under a preload that wraps every node:fs entry
// that can write, replace or remove a file (open with a writing flag, writeFile, appendFile, truncate,
// unlink, rm, rename from or to it, copyFile, cp, link and symlink onto it, createWriteStream, in their
// callback, sync and promise forms) and records each call that names romlift.toml. No call may be recorded,
// and the file must keep its bytes, inode and modification time.
//
// Interface, frozen by D74 (architecture §2.1):
//   romlift init <rom> --json, romlift generate [--dry-run] --json   exit 0; NDJSON, last line a summary
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

interface FileId {
  readonly sha1: string;
  readonly ino: number;
  readonly mtimeMs: number;
}

// Runs before the CLI in the same process; reports through ROMLIFT_WATCH_REPORT with the unwrapped writer.
const PRELOAD = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const target = path.resolve(process.env.ROMLIFT_WATCH_FILE);
const report = process.env.ROMLIFT_WATCH_REPORT;
const writeReport = fs.writeFileSync;
const hits = [];
const same = (p) => {
  try {
    if (p === undefined || p === null || typeof p === 'number') return false;
    const text = p instanceof URL ? fileURLToPath(p) : Buffer.isBuffer(p) ? p.toString() : String(p);
    return path.resolve(text) === target;
  } catch {
    return false;
  }
};
const WRITE_BITS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_TRUNC;
const writes = (flags) => (flags === undefined || flags === null ? false : typeof flags === 'number' ? (flags & WRITE_BITS) !== 0 : !['r', 'rs', 'sr'].includes(String(flags)));
const wrap = (obj, name, check) => {
  const original = obj[name];
  if (typeof original !== 'function') return;
  obj[name] = function (...args) {
    if (check(args)) hits.push(name);
    return original.apply(this, args);
  };
};
const first = (args) => same(args[0]);
const either = (args) => same(args[0]) || same(args[1]);
const second = (args) => same(args[1]);
const opening = (args) => same(args[0]) && writes(typeof args[1] === 'function' ? undefined : args[1]);
for (const [obj, suffix] of [[fs, ''], [fs, 'Sync'], [fs.promises, '']]) {
  for (const name of ['writeFile', 'appendFile', 'truncate', 'unlink', 'rm', 'rmdir']) wrap(obj, name + suffix, first);
  wrap(obj, 'open' + suffix, opening);
  wrap(obj, 'rename' + suffix, either);
  for (const name of ['copyFile', 'cp', 'link', 'symlink']) wrap(obj, name + suffix, second);
}
wrap(fs, 'createWriteStream', first);
syncBuiltinESMExports();
process.on('exit', () => writeReport(report, JSON.stringify(hits)));
`;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function identify(file: string): Promise<FileId> {
  const info = await stat(file);
  return { sha1: createHash('sha1').update(await readFile(file)).digest('hex'), ino: info.ino, mtimeMs: info.mtimeMs };
}

async function romlift(cx: GateContext, cwd: string, args: readonly string[], preload?: { readonly url: string; readonly report: string }): Promise<void> {
  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const flags = preload === undefined ? ['--conditions=source'] : ['--conditions=source', '--import', preload.url];
  const env = preload === undefined ? {} : { ROMLIFT_WATCH_FILE: path.join(cwd, 'romlift.toml'), ROMLIFT_WATCH_REPORT: preload.report };
  const run = await cx.exec(process.execPath, [...flags, cli, ...args, '--json'], { cwd, env });
  const last = cx.jsonLines<CliLine>(run.stdout).at(-1);
  if (run.code !== 0 || last?.type !== 'summary' || last.exitCode !== 0) throw new Error(`romlift ${args.join(' ')} --json exited ${run.code}:\n${tail(run)}`);
}

gate({
  id: 'g4.no-toml-write',
  phase: 4,
  tier: 'ci',
  needs: ['init', 'generate'],
  async run(cx) {
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const base = await cx.tmpDir('romlift-no-toml-write-');
    const preloadFile = path.join(base, 'watch-toml.mjs');
    await writeFile(preloadFile, PRELOAD);
    const url = pathToFileURL(preloadFile).href;
    const problems: string[] = [];
    let runs = 0;
    for (const fixture of cx.fixtures) {
      const dir = path.join(base, fixture.name);
      await mkdir(dir, { recursive: true });
      await copyFile(fixture.rom, path.join(dir, `${fixture.name}.gba`));
      await romlift(cx, dir, ['init', `${fixture.name}.gba`]);
      const toml = path.join(dir, 'romlift.toml');
      const before = await identify(toml);
      const scenarios: readonly { readonly label: string; readonly args: readonly string[]; readonly prepare?: () => Promise<void> }[] = [
        { label: 'tree current', args: ['generate'] },
        { label: 'asm/ deleted', args: ['generate'], prepare: () => rm(path.join(dir, 'asm'), { recursive: true, force: true }) },
        { label: 'dry run', args: ['generate', '--dry-run'] },
      ];
      for (const scenario of scenarios) {
        if (scenario.prepare !== undefined) await scenario.prepare();
        const report = path.join(base, `${fixture.name}-${runs}.json`);
        await romlift(cx, dir, scenario.args, { url, report });
        runs++;
        const hits = JSON.parse(await readFile(report, 'utf8')) as readonly string[];
        if (hits.length > 0) problems.push(`${fixture.name} (${scenario.label}): generate called ${[...new Set(hits)].join(', ')} on romlift.toml`);
      }
      const after = await identify(toml);
      if (after.sha1 !== before.sha1) problems.push(`${fixture.name}: romlift.toml content changed`);
      else if (after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) problems.push(`${fixture.name}: romlift.toml was replaced or touched`);
    }
    if (problems.length > 0) throw new Error(`generate wrote the TOML: ${problems.join(' | ')}`);
    cx.note(`${runs} generate runs on ${cx.fixtures.length} fixtures never opened romlift.toml for writing`);
  },
});
