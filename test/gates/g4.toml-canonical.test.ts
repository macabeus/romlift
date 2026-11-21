// g4.toml-canonical (architecture §6.5, §13, D23): `serialize∘parse` is the identity on canonical files, and
// patches keep comments and re-parse. On every committed fixture the TOML `init` writes is canonical:
//   - serializeConfig(parseConfig(text)) === text, also for every test/golden/config/canonical/*.toml;
//   - with three comments added by hand (a header line, a line above a [functions] entry, and a trailing
//     comment on a [[modules]] line), planPatch renaming a default-named function returns a text that keeps
//     the three comments verbatim, re-parses, renames exactly that entry and changes nothing else;
//   - once that entry is restructured by hand into a [functions.0x…] table, the same patch is refused with
//     E_TOML_PATCH_REFUSED;
// and the config goldens under test/golden/config/ pass with UPDATE_GOLDEN unset.
//
// Calls, frozen by D74 (architecture §3.4, §6.5; p4-config's):
//   parseConfig(text) -> {ok: true, value: RomliftConfig, diagnostics} | {ok: false, diagnostics}
//   serializeConfig(config) -> string
//   planPatch(text, config, proposals) -> {ok: true, text: string, diagnostics} | {ok: false, diagnostics}
//   a rename proposal: {kind: 'function', addr, mode, name, source: {kind: 'legacy'}}
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { CHECKOUT_CLI_ENV, type ExecResult, FIXTURE_PARALLELISM, type GateContext, gate, pooled } from './gate.ts';

type Addr = number;
type Mode = 'thumb' | 'arm';

interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

interface FunctionConfig {
  readonly name: string;
  readonly mode: Mode;
}

interface RomliftConfig {
  readonly modules: readonly { readonly name: string; readonly start: Addr }[];
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
}

interface Proposal {
  readonly kind: 'function';
  readonly addr: Addr;
  readonly mode: Mode;
  readonly name: string;
  readonly source: { readonly kind: 'legacy' };
}

type ParseConfig = (
  text: string,
) =>
  | { readonly ok: true; readonly value: RomliftConfig }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
type SerializeConfig = (config: RomliftConfig) => string;
type PlanPatch = (
  text: string,
  config: RomliftConfig,
  proposals: readonly Proposal[],
) => { readonly ok: true; readonly text: string } | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

interface CliLine {
  readonly type: string;
  readonly exitCode?: number;
}

const GOLDEN = 'test/golden/config';
const PLAIN_DEFAULT_ENTRY = /^(0x[0-9A-F]{8}) = "(sub_[0-9A-F]{8})"$/;
const COMMENTS = [
  '# romlift gate: a comment above everything',
  '# romlift gate: a comment above an entry',
  '# romlift gate: a trailing comment',
] as const;

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function hex(addr: Addr): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function firstDiff(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if (x[i] !== y[i]) return `line ${i + 1}: ${JSON.stringify(x[i] ?? null)} became ${JSON.stringify(y[i] ?? null)}`;
  return 'no line differs';
}

/** The text with the three comments added, and the first entry that still has its plain default name. */
function commented(text: string): { readonly text: string; readonly addr: Addr; readonly name: string } {
  const lines = text.split('\n');
  const header = lines.findIndex((l) => l.trim() === '[functions]');
  const at = lines.findIndex((l, i) => i > header && PLAIN_DEFAULT_ENTRY.test(l));
  const match = PLAIN_DEFAULT_ENTRY.exec(lines[at] ?? '');
  const moduleLine = lines.findIndex((l) => /^kind = "/.test(l));
  if (header < 0 || match?.[1] === undefined || match[2] === undefined || moduleLine < 0)
    throw new Error('the TOML lacks a [functions] entry with a default name or a [[modules]] kind line');
  const out = [...lines];
  out[moduleLine] = `${out[moduleLine] ?? ''}  ${COMMENTS[2]}`;
  out.splice(at, 0, COMMENTS[1]);
  return { text: `${COMMENTS[0]}\n${out.join('\n')}`, addr: Number.parseInt(match[1], 16), name: match[2] };
}

/** Moves the entry at `addr` out of [functions] into its own `[functions.0x…]` table at the end. */
function restructured(text: string, addr: Addr, name: string): string {
  const line = `${hex(addr)} = "${name}"`;
  const lines = text.split('\n').filter((l) => l !== line);
  return `${lines.join('\n').trimEnd()}\n\n[functions.${hex(addr)}]\nname = "${name}"\n`;
}

async function goldenCanonicals(cx: GateContext): Promise<readonly string[]> {
  const dir = path.join(cx.repoRoot, GOLDEN, 'canonical');
  const names = await readdir(dir).catch(() => [] as string[]);
  return names
    .filter((n) => n.endsWith('.toml'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((n) => path.join(dir, n));
}

gate({
  id: 'g4.toml-canonical',
  phase: 4,
  tier: 'ci',
  needs: ['init', 'parseConfig', 'serializeConfig', 'planPatch'],
  async run(cx) {
    const parse = cx.need<ParseConfig>('parseConfig');
    const serialize = cx.need<SerializeConfig>('serializeConfig');
    const planPatch = cx.need<PlanPatch>('planPatch');
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const problems: string[] = [];
    const roundTrip = (label: string, text: string): RomliftConfig | undefined => {
      const parsed = parse(text);
      if (!parsed.ok) {
        problems.push(`${label}: does not parse: ${parsed.diagnostics.map((d) => d.code).join(', ')}`);
        return undefined;
      }
      const again = serialize(parsed.value);
      if (again !== text) problems.push(`${label}: serialize(parse(text)) differs at ${firstDiff(text, again)}`);
      return parsed.value;
    };

    const goldens = await goldenCanonicals(cx);
    for (const file of goldens) roundTrip(path.relative(cx.repoRoot, file), await readFile(file, 'utf8'));

    const base = await cx.tmpDir('romlift-toml-canonical-');
    const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
    // The inits, each in a project of its own, run FIXTURE_PARALLELISM at once; what is checked of their files is checked
    // in the fixtures' order, and an init that failed stops the gate where a serial loop would have.
    const inits = await pooled(
      cx.fixtures,
      FIXTURE_PARALLELISM,
      async (fixture): Promise<{ readonly text: string } | { readonly error: Error }> => {
        const dir = path.join(base, fixture.name);
        await mkdir(dir, { recursive: true });
        await copyFile(fixture.rom, path.join(dir, 'baserom.gba'));
        const init = await cx.exec(process.execPath, ['--conditions=source', cli, 'init', 'baserom.gba', '--json'], {
          cwd: dir,
          env: CHECKOUT_CLI_ENV,
        });
        if (init.code !== 0 || cx.jsonLines<CliLine>(init.stdout).at(-1)?.exitCode !== 0)
          return { error: new Error(`${fixture.name}: init exited ${init.code}:\n${tail(init)}`) };
        return { text: await readFile(path.join(dir, 'romlift.toml'), 'utf8') };
      },
    );
    for (const [i, fixture] of cx.fixtures.entries()) {
      const init = inits[i];
      if (init === undefined || 'error' in init) throw init?.error ?? new Error(`${fixture.name}: no init`);
      const text = init.text;
      const config = roundTrip(fixture.name, text);
      if (config === undefined) continue;

      const edited = commented(text);
      const proposal: Proposal = {
        kind: 'function',
        addr: edited.addr,
        mode: config.functions.get(edited.addr)?.mode ?? 'thumb',
        name: 'GatePatchedName',
        source: { kind: 'legacy' },
      };
      const patched = planPatch(edited.text, config, [proposal]);
      if (!patched.ok) {
        problems.push(
          `${fixture.name}: planPatch refused a commented canonical file: ${patched.diagnostics.map((d) => d.code).join(', ')}`,
        );
      } else {
        const lost = COMMENTS.filter((c) => !patched.text.includes(c));
        if (lost.length > 0) problems.push(`${fixture.name}: the patch dropped ${lost.length} comments`);
        const reparsed = parse(patched.text);
        if (!reparsed.ok) {
          problems.push(
            `${fixture.name}: the patched text does not parse: ${reparsed.diagnostics.map((d) => d.code).join(', ')}`,
          );
        } else {
          const renamed = reparsed.value.functions.get(edited.addr)?.name;
          if (renamed !== 'GatePatchedName')
            problems.push(`${fixture.name}: ${hex(edited.addr)} is named ${renamed ?? 'nothing'} after the patch`);
          const others = [...config.functions.keys()].filter(
            (a) => a !== edited.addr && reparsed.value.functions.get(a)?.name !== config.functions.get(a)?.name,
          );
          if (others.length > 0 || reparsed.value.functions.size !== config.functions.size)
            problems.push(
              `${fixture.name}: the patch changed other entries (${others.slice(0, 4).map(hex).join(', ')})`,
            );
          if (JSON.stringify(reparsed.value.modules) !== JSON.stringify(config.modules))
            problems.push(`${fixture.name}: the patch changed [[modules]]`);
        }
      }

      const moved = restructured(text, edited.addr, edited.name);
      const movedParsed = parse(moved);
      if (!movedParsed.ok || serialize(movedParsed.value) !== text)
        throw new Error(`${fixture.name}: the gate's hand restructuring changed the config; fix the gate`);
      const refused = planPatch(moved, movedParsed.value, [proposal]);
      if (refused.ok || !refused.diagnostics.some((d) => d.code === 'E_TOML_PATCH_REFUSED'))
        problems.push(`${fixture.name}: a patch of a restructured entry was not refused with E_TOML_PATCH_REFUSED`);
    }

    const tests = await cx.exec(
      process.execPath,
      ['--conditions=source', '--test', '--test-reporter=tap', `${GOLDEN}/**/*.test.ts`],
      { cwd: cx.repoRoot, env: { UPDATE_GOLDEN: '' } },
    );
    if (tests.code !== 0)
      problems.push(`the config goldens fail (node --test ${GOLDEN} exited ${tests.code}):\n${tail(tests)}`);
    if (problems.length > 0) throw new Error(`canonical TOML: ${problems.join(' | ')}`);
    cx.note(
      `serialize∘parse is the identity on ${cx.fixtures.length} init files and ${goldens.length} golden files; patches keep comments; a restructured entry is refused`,
    );
  },
});
