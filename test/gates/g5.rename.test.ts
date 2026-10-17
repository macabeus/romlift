// g5.rename (architecture §2.1, §6.6, §13, D9): `rename <old> <new>` renames identifiers only, patches one
// TOML line, and refuses what it cannot do. On an initialised fixture project, the gate adds by hand a C
// comment, a string and a declaration that name a default-named function, and a header in include/ that
// declares it; then:
//   - `rename <old> GateRenamed --json` exits 0; exactly one line of romlift.toml changes, it names
//     GateRenamed and carries no `from`; in src/ and include/ every identifier token <old> becomes
//     GateRenamed while every comment, string and character literal stays as it was; `generate` then emits
//     a file named GateRenamed.s under asm/;
//   - `rename GateRenamed <another listed name>` (the new name exists) and `rename <unknown> X` (the old one
//     does not) exit 1 and change no file.
//
// Calls, for the phase-5 lead to align (architecture §6.6): tokenizeC(text) -> readonly {kind, text}[]
//   with kinds 'comment', 'string', 'char', 'identifier', …; NDJSON as in g4.e2e-fixtures.
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

interface CToken {
  readonly kind: string;
  readonly text: string;
}

type TokenizeC = (text: string) => readonly CToken[];

const NEW_NAME = 'GateRenamed';
const UNTOUCHABLE: ReadonlySet<string> = new Set(['comment', 'string', 'char']);

function tail(run: ExecResult, lines = 20): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

async function files(dir: string, prefix = ''): Promise<readonly string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => [])) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(dir, relative)));
    else if (entry.isFile()) out.push(relative);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function snapshot(dir: string): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  for (const file of await files(dir)) if (!file.startsWith('.git/')) out.set(file, createHash('sha1').update(await readFile(path.join(dir, file))).digest('hex'));
  return out;
}

function same(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

/** Comment/string tokens as they are, identifier tokens with `from` read as `to`. */
function view(tokens: readonly CToken[], from: string, to: string): { readonly kept: string; readonly identifiers: string } {
  const kept = tokens.filter((t) => UNTOUCHABLE.has(t.kind)).map((t) => t.text);
  const identifiers = tokens.filter((t) => t.kind === 'identifier').map((t) => (t.text === from ? to : t.text));
  return { kept: JSON.stringify(kept), identifiers: JSON.stringify(identifiers) };
}

gate({
  id: 'g5.rename',
  phase: 5,
  tier: 'ci',
  needs: ['rename', 'planRename', 'tokenizeC'],
  async run(cx: GateContext) {
    const tokenizeC = cx.need<TokenizeC>('tokenizeC');
    const fixture = cx.fixtures.find((f) => f.name === 'composite') ?? cx.fixtures[0];
    if (fixture === undefined) throw new Error('no committed fixture under bench/dataset/synthetic');
    const main = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
    const dir = path.join(await cx.tmpDir('romlift-rename-'), fixture.name);
    await mkdir(dir, { recursive: true });
    await copyFile(fixture.rom, path.join(dir, 'baserom.gba'));
    const romlift = (args: readonly string[]): Promise<ExecResult> => cx.exec(process.execPath, ['--conditions=source', main, ...args, '--json'], { cwd: dir });
    const init = await romlift(['init', 'baserom.gba']);
    if (init.code !== 0) throw new Error(`init exited ${init.code}:\n${tail(init)}`);

    const tomlPath = path.join(dir, 'romlift.toml');
    const toml = await readFile(tomlPath, 'utf8');
    const names = [...toml.matchAll(/= "(sub_[0-9A-F]{8})"/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
    const [old, other] = names;
    if (old === undefined || other === undefined) throw new Error('the project lists fewer than two default-named functions');
    const cFiles = (await files(path.join(dir, 'src'))).filter((f) => f.endsWith('.c'));
    let stubFile: string | undefined;
    for (const f of cFiles) if ((await readFile(path.join(dir, 'src', f), 'utf8')).includes(old)) stubFile = path.join(dir, 'src', f);
    if (stubFile === undefined) throw new Error(`no src/*.c names ${old}`);
    await appendFile(stubFile, `\n/* ${old} is mentioned in this comment */\nextern void ${old}(void);\nstatic const char gGateText[] = "${old}";\nstatic const char gGateChar = '${old.charAt(0)}';\n`);
    const header = path.join(dir, 'include', 'romlift_gate.h');
    await mkdir(path.dirname(header), { recursive: true });
    await writeFile(header, `// ${old} in a header comment\nvoid ${old}(void);\n`);
    const tracked = [stubFile, header];
    const before = new Map<string, string>();
    for (const f of tracked) before.set(f, await readFile(f, 'utf8'));

    const problems: string[] = [];
    const renamed = await romlift(['rename', old, NEW_NAME]);
    if (renamed.code !== 0) throw new Error(`rename ${old} ${NEW_NAME} exited ${renamed.code}:\n${tail(renamed)}`);
    const after = await readFile(tomlPath, 'utf8');
    const a = toml.split('\n');
    const b = after.split('\n');
    const changedLines = a.length === b.length ? a.flatMap((line, i) => (line === b[i] ? [] : [b[i] ?? ''])) : ['(line count changed)'];
    if (changedLines.length !== 1) problems.push(`rename changed ${changedLines.length} TOML lines, not one`);
    else if (!changedLines[0]?.includes(`"${NEW_NAME}"`) || /\bfrom\s*=/.test(changedLines[0] ?? '')) problems.push(`the TOML line became ${JSON.stringify(changedLines[0])}`);
    for (const f of tracked) {
      const was = view(tokenizeC(before.get(f) ?? ''), old, NEW_NAME);
      const now = view(tokenizeC(await readFile(f, 'utf8')), NEW_NAME, NEW_NAME);
      if (was.kept !== now.kept) problems.push(`${path.relative(dir, f)}: a comment, string or character literal changed`);
      if (was.identifiers !== now.identifiers) problems.push(`${path.relative(dir, f)}: identifiers are not ${old} -> ${NEW_NAME} exactly`);
    }
    const generate = await romlift(['generate']);
    if (generate.code !== 0) problems.push(`generate after rename exited ${generate.code}:\n${tail(generate)}`);
    else if (!(await files(path.join(dir, 'asm'))).some((f) => path.posix.basename(f) === `${NEW_NAME}.s`)) problems.push(`generate emitted no ${NEW_NAME}.s`);

    for (const [label, args] of [
      ['the new name exists', ['rename', NEW_NAME, other]],
      ['the old name is unknown', ['rename', 'GateNoSuchFunction', 'GateOther']],
    ] as const) {
      const snap = await snapshot(dir);
      const refused = await romlift(args);
      if (refused.code !== 1) problems.push(`rename when ${label} exited ${refused.code}, not 1`);
      if (!same(snap, await snapshot(dir))) problems.push(`rename when ${label} changed files`);
    }
    if (problems.length > 0) throw new Error(`rename: ${problems.join(' | ')}`);
    cx.note(`rename ${old} -> ${NEW_NAME}: one TOML line, identifiers only in src/ and include/; both refusals change nothing`);
  },
});
