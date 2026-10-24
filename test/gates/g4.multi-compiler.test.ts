// g4.multi-compiler (architecture §6.3 `modules-mk`, §6.5, §8.1, §13, D47): the multi-compiler fixture builds
// with two compilers chosen per module from modules.mk. After `init`, the gate writes by hand the per-module
// `compiler` and `cflags` that the fixture's expect.json names into those [[modules]] blocks, copies the
// fixture's decompiled C over the project, and runs `generate`, `./setup.sh` and `make`, which must reach
// the SHA-1; modules.mk must give each named module its compiler and flags and leave at least one other C
// module on agbcc. As a control, the same C built with agbcc alone must not reach the SHA-1, so the fixture
// really needs both compilers.
//
// Interfaces, frozen by D74 (as in g4.e2e-fixtures, plus):
//   bench/dataset/synthetic/multi-compiler/expect.json   {"init"?: {"args": [string]},
//     "compilers": {"<module>": {"compiler": "old_agbcc", "cflags": [string]}}}
//   bench/dataset/synthetic/multi-compiler/overlay/src/<module>.c   decompiled C of both C modules
//   modules.mk names each C object `src/<module>.o` on the line(s) that set its compiler and flags: per C
//   module `build/src/<module>.o: CC1 := tools/agbcc/bin/<compiler>` and `build/src/<module>.o: CFLAGS := <flags>`
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface Expect {
  readonly init?: { readonly args?: readonly string[] };
  readonly compilers?: Readonly<Record<string, { readonly compiler: string; readonly cflags?: readonly string[] }>>;
}

const FIXTURE = 'multi-compiler';
const DEFAULT_COMPILER = 'agbcc';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function sourceCli(cx: GateContext): Promise<string> {
  const dir = await cx.tmpDir('romlift-cli-');
  const shim = path.join(dir, 'romlift');
  const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  await writeFile(shim, `#!/bin/sh\nexec '${process.execPath}' --conditions=source '${main}' "$@"\n`, { mode: 0o755 });
  return shim;
}

/** Inserts `extra` after the `kind` line of the [[modules]] block named `module`. */
function addToModule(text: string, module: string, extra: readonly string[]): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() !== '[[modules]]') continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end] ?? '')) end++;
    if (!lines.slice(i + 1, end).some((l) => l.trim() === `name = "${module}"`)) continue;
    const kind = lines.slice(i + 1, end).findIndex((l) => /^\s*kind\s*=/.test(l));
    if (kind < 0) throw new Error(`module ${module} has no kind line`);
    return [...lines.slice(0, i + 2 + kind), ...extra, ...lines.slice(i + 2 + kind)].join('\n');
  }
  throw new Error(`romlift.toml has no [[modules]] block named ${module}`);
}

/** The module names of every `kind = "c"` block of a canonical romlift.toml. */
function cModules(text: string): readonly string[] {
  return text.split(/^\s*\[\[modules\]\]\s*$/m).slice(1).flatMap((block) => {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    return name !== undefined && /^\s*kind\s*=\s*"c"/m.test(block) ? [name] : [];
  });
}

async function built(dir: string): Promise<{ readonly recorded: string; readonly built: string }> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sha1'));
  const match = names.length === 1 && names[0] !== undefined ? /^([0-9a-f]{40})\s+\*?(\S+)\s*$/m.exec(await readFile(path.join(dir, names[0]), 'utf8')) : null;
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('the project has no single <name>.sha1 in sha1sum format');
  const file = path.join(dir, match[2]);
  return { recorded: match[1], built: (await exists(file)) ? sha1(await readFile(file)) : 'nothing' };
}

async function step(cx: GateContext, what: string, command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>): Promise<ExecResult> {
  const run = await cx.exec(command, args, { cwd, env });
  if (run.code !== 0) throw new Error(`${what} exited ${run.code}:\n${tail(run)}`);
  return run;
}

gate({
  id: 'g4.multi-compiler',
  phase: 4,
  tier: 'ci',
  inputs: ['toolchain'],
  needs: ['init', 'generate'],
  async run(cx) {
    const fixture = cx.fixtures.find((f) => f.name === FIXTURE);
    if (fixture === undefined) throw new Error(`no ${FIXTURE} fixture under bench/dataset/synthetic`);
    const expect = JSON.parse(await readFile(fixture.expect, 'utf8')) as Expect;
    const compilers = expect.compilers ?? {};
    const named = Object.keys(compilers).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (!named.some((m) => compilers[m]?.compiler !== DEFAULT_COMPILER)) throw new Error(`${FIXTURE}/expect.json names no module built with a compiler other than ${DEFAULT_COMPILER}`);

    const cli = await sourceCli(cx);
    const env = { ROMLIFT_CLI: cli };
    const dir = path.join(await cx.tmpDir('romlift-multi-compiler-'), FIXTURE);
    await mkdir(dir, { recursive: true });
    await copyFile(fixture.rom, path.join(dir, 'baserom.gba'));
    await step(cx, 'init', cli, ['init', 'baserom.gba', ...(expect.init?.args ?? []), '--json'], dir, env);
    const tomlPath = path.join(dir, 'romlift.toml');
    const original = await readFile(tomlPath, 'utf8');
    const others = cModules(original).filter((m) => !named.includes(m));
    if (others.length === 0) throw new Error(`init made no C module besides ${named.join(', ')}, so nothing stays on ${DEFAULT_COMPILER}`);
    let edited = original;
    for (const module of named) {
      const spec = compilers[module];
      if (spec === undefined) continue;
      const extra = [`compiler = "${spec.compiler}"`, ...(spec.cflags === undefined ? [] : [`cflags = [${spec.cflags.map((f) => JSON.stringify(f)).join(', ')}]`])];
      edited = addToModule(edited, module, extra);
    }
    await writeFile(tomlPath, edited);
    await cp(path.join(fixture.dir, 'overlay'), dir, { recursive: true });
    await step(cx, 'generate', cli, ['generate', '--json'], dir, env);
    await step(cx, './setup.sh', './setup.sh', [], dir, env);
    await step(cx, 'make', 'make', [], dir, env);
    const both = await built(dir);
    if (both.built !== both.recorded) throw new Error(`with two compilers make built ${both.built}, expected ${both.recorded}`);

    const mk = (await readFile(path.join(dir, 'modules.mk'), 'utf8')).split('\n');
    const problems: string[] = [];
    for (const module of named) {
      const spec = compilers[module];
      const lines = mk.filter((l) => l.includes(`src/${module}.o`)).join('\n');
      if (spec === undefined) continue;
      if (!lines.includes(spec.compiler)) problems.push(`modules.mk does not give src/${module}.o ${spec.compiler}`);
      for (const flag of spec.cflags ?? []) if (!lines.includes(flag)) problems.push(`modules.mk does not give src/${module}.o the flag ${flag}`);
    }
    if (!others.some((m) => mk.some((l) => l.includes(`src/${m}.o`) && l.includes(DEFAULT_COMPILER) && !named.some((n) => l.includes(compilers[n]?.compiler ?? '\0'))))) {
      problems.push(`modules.mk puts none of ${others.join(', ')} on ${DEFAULT_COMPILER}`);
    }
    if (problems.length > 0) throw new Error(problems.join('; '));

    await writeFile(tomlPath, original);
    await step(cx, 'generate (control)', cli, ['generate', '--json'], dir, env);
    const control = await cx.exec('make', [], { cwd: dir, env });
    const single = control.code === 0 ? (await built(dir)).built : 'a failed build';
    if (single === both.recorded) throw new Error(`the C builds to the SHA-1 with ${DEFAULT_COMPILER} alone, so the fixture does not need two compilers`);
    cx.note(`${named.map((m) => `${m}: ${compilers[m]?.compiler ?? '?'}`).join(', ')} and ${others.length} modules on ${DEFAULT_COMPILER} build to ${both.recorded}; ${DEFAULT_COMPILER} alone gives ${single}`);
  },
});
