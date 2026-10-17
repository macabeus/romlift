// g4.toml-mutations (architecture §6.2, §6.5, §10 "Property", §13): seeded random legal edits of an
// initialised project's romlift.toml keep the self-checks and the link green, and each illegal edit gives
// its documented code and writes nothing. Per target (every committed fixture on the ci tier, plus the five
// tuning ROMs on the real tier), from the TOML `init` wrote:
//   legal:   move a `c` module's start to another legal border between its neighbours; rename a function that
//            still has its default name; delete a listed function that starts no module; add a `code`
//            override that covers one found function exactly; split a `c` module at a legal border inside it.
//            Each edit is applied alone to the original config and serialised; then `generate --json` and
//            `verify --link --json` must exit 0 and the link must reproduce the ROM's SHA-1.
//   illegal: a module start moved by 2 bytes (E_MODULE_BORDER), a [functions] line repeated
//            (E_DUPLICATE_ADDRESS), a [functions] key without its leading zero (E_TOML_KEY_SPELLING); each
//            makes `generate --json` exit 1 with that code and leaves every file but romlift.toml unchanged.
//
// Calls, for the phase-4 lead to align (architecture §3.3, §3.4, §6.2):
//   parseConfig(text) -> {ok: true, value: RomliftConfig} | {ok: false, diagnostics}
//   serializeConfig(config) -> string (the canonical layout `init` writes)
//   legalBorders(analysis, profile) -> sorted Addr[]
//   romFromBytes, sha1Of, profileById('agbcc'), analyze(rom, profile, {mode: 'discover', seeds: [],
//   overrides: [], trail: 'off'})
// CLI: generate --json and verify --link --json print NDJSON whose last line is
//   {"type":"summary","ok":boolean,"exitCode":number,"sha1"?:string} (sha1 of the linked ROM with --link).
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult, type GateContext } from './gate.ts';

type Addr = number;
type Mode = 'thumb' | 'arm';

interface ModuleConfig {
  readonly name: string;
  readonly start: Addr;
  readonly kind: 'asm' | 'c' | 'data';
  readonly generated: boolean;
}

interface FunctionConfig {
  readonly name: string;
  readonly mode: Mode;
  readonly label?: boolean;
  readonly aliases: readonly string[];
}

interface OverrideConfig {
  readonly start: Addr;
  readonly size: number;
  readonly kind: 'code' | 'data';
  readonly mode?: Mode;
}

interface RomliftConfig {
  readonly modules: readonly ModuleConfig[];
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
  readonly overrides: readonly OverrideConfig[];
}

type ParseConfig = (text: string) => { readonly ok: true; readonly value: RomliftConfig } | { readonly ok: false; readonly diagnostics: readonly { readonly code: string; readonly message: string }[] };
type SerializeConfig = (config: RomliftConfig) => string;

interface Rom {
  readonly sha1: string;
  readonly end: Addr;
}

interface AnalysisResult {
  readonly functions: readonly { readonly entry: Addr; readonly mode: Mode; readonly extent: { readonly start: Addr; readonly end: Addr } }[];
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (rom: Rom, profile: object, options: { readonly mode: 'discover'; readonly seeds: readonly never[]; readonly overrides: readonly never[]; readonly trail: 'off' }) => AnalysisResult;
type LegalBorders = (analysis: AnalysisResult, profile: object) => readonly Addr[];

interface CliLine {
  readonly type: string;
  readonly code?: string;
  readonly exitCode?: number;
  readonly sha1?: string;
}

interface Target {
  readonly name: string;
  readonly rom: string;
}

interface Api {
  readonly parse: ParseConfig;
  readonly serialize: SerializeConfig;
}

interface Facts {
  readonly config: RomliftConfig;
  readonly borders: readonly Addr[];
  readonly analysis: AnalysisResult;
  readonly end: Addr;
}

type LegalKind = 'move-start' | 'rename' | 'delete-function' | 'add-override' | 'split-module';
const LEGAL_KINDS: readonly LegalKind[] = ['move-start', 'rename', 'delete-function', 'add-override', 'split-module'];
const SEED = 0x6734_0001;
const DEFAULT_NAME = /^(sub|unk|gUnk)_[0-9A-F]{8}$|^_[0-9A-F]{8}$/;
const FUNCTION_LINE = /^(0x)0([0-9A-F]{7})(\s*=.*)$/;

function hex(addr: Addr): string {
  return `0x${addr.toString(16).toUpperCase().padStart(8, '0')}`;
}

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** mulberry32: a small seeded generator, so every run makes the same edits. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(random() * items.length)];
}

function nameSeed(name: string): number {
  let h = SEED;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** One legal edit of `kind`, or undefined when the config offers no place for it. */
function legalEdit(kind: LegalKind, facts: Facts, random: () => number): { readonly config: RomliftConfig; readonly what: string } | undefined {
  const { config, borders } = facts;
  const modules = config.modules;
  const starts = new Set(modules.map((m) => m.start));
  const nextStart = (i: number): Addr => modules[i + 1]?.start ?? facts.end;
  const cModules = modules.map((m, i) => ({ m, i })).filter(({ m, i }) => m.kind === 'c' && i > 0);
  switch (kind) {
    case 'move-start': {
      const options = cModules.flatMap(({ m, i }) => borders.filter((b) => b > (modules[i - 1]?.start ?? 0) && b < nextStart(i) && b !== m.start).map((b) => ({ i, b })));
      const choice = pick(random, options);
      if (choice === undefined) return undefined;
      const moved = modules[choice.i];
      return { config: { ...config, modules: modules.map((m, i) => (i === choice.i ? { ...m, start: choice.b } : m)) }, what: `move ${moved?.name ?? '?'} to ${hex(choice.b)}` };
    }
    case 'rename': {
      const entries = [...config.functions.keys()].sort((a, b) => a - b).filter((a) => DEFAULT_NAME.test(config.functions.get(a)?.name ?? ''));
      const addr = pick(random, entries);
      const fn = addr === undefined ? undefined : config.functions.get(addr);
      if (addr === undefined || fn === undefined) return undefined;
      const functions = new Map(config.functions);
      functions.set(addr, { ...fn, name: `Mutated_${hex(addr).slice(2)}` });
      return { config: { ...config, functions }, what: `rename ${fn.name}` };
    }
    case 'delete-function': {
      const entries = [...config.functions.keys()].sort((a, b) => a - b).filter((a) => !starts.has(a));
      const addr = pick(random, entries);
      if (addr === undefined) return undefined;
      const functions = new Map(config.functions);
      functions.delete(addr);
      return { config: { ...config, functions }, what: `delete ${hex(addr)}` };
    }
    case 'add-override': {
      const listed = facts.analysis.functions.filter((f) => config.functions.has(f.entry) && !config.overrides.some((o) => o.start < f.extent.end && f.extent.start < o.start + o.size));
      const fn = pick(random, listed);
      if (fn === undefined) return undefined;
      const override: OverrideConfig = { start: fn.extent.start, size: fn.extent.end - fn.extent.start, kind: 'code', mode: fn.mode };
      const overrides = [...config.overrides, override].sort((a, b) => a.start - b.start);
      return { config: { ...config, overrides }, what: `code override over ${hex(fn.entry)}` };
    }
    case 'split-module': {
      const options = cModules.flatMap(({ m, i }) => borders.filter((b) => b > m.start && b < nextStart(i) && !starts.has(b)).map((b) => ({ i, b })));
      const choice = pick(random, options);
      if (choice === undefined) return undefined;
      const parent = modules[choice.i];
      if (parent === undefined) return undefined;
      const added: ModuleConfig = { ...parent, name: `${parent.name}_split_${hex(choice.b).slice(2)}`, start: choice.b };
      return { config: { ...config, modules: [...modules.slice(0, choice.i + 1), added, ...modules.slice(choice.i + 1)] }, what: `split ${parent.name} at ${hex(choice.b)}` };
    }
  }
}

/** The illegal edits, each from the original text, with the code it must give. */
function illegalEdits(text: string, api: Api, facts: Facts): readonly { readonly text: string; readonly code: string; readonly what: string }[] {
  const out: { text: string; code: string; what: string }[] = [];
  const moved = facts.config.modules.findIndex((m, i) => i > 0 && m.kind === 'c');
  const module = facts.config.modules[moved];
  if (module !== undefined) {
    const config = { ...facts.config, modules: facts.config.modules.map((m, i) => (i === moved ? { ...m, start: m.start + 2 } : m)) };
    out.push({ text: api.serialize(config), code: 'E_MODULE_BORDER', what: `${module.name} start + 2` });
  }
  const lines = text.split('\n');
  const header = lines.findIndex((l) => l.trim() === '[functions]');
  const at = header < 0 ? -1 : lines.findIndex((l, i) => i > header && FUNCTION_LINE.test(l));
  const line = lines[at];
  if (line === undefined) throw new Error('romlift.toml has no [functions] entry in the canonical layout');
  out.push({ text: [...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join('\n'), code: 'E_DUPLICATE_ADDRESS', what: 'a repeated [functions] line' });
  out.push({ text: [...lines.slice(0, at), line.replace(FUNCTION_LINE, '$1$2$3'), ...lines.slice(at + 1)].join('\n'), code: 'E_TOML_KEY_SPELLING', what: 'a key with seven hex digits' });
  return out;
}

async function romlift(cx: GateContext, cwd: string, args: readonly string[]): Promise<{ readonly run: ExecResult; readonly lines: readonly CliLine[] }> {
  const cli = path.join(cx.repoRoot, 'src', 'cli', 'main.ts');
  const run = await cx.exec(process.execPath, ['--conditions=source', cli, ...args, '--json'], { cwd });
  const lines = cx.jsonLines<CliLine>(run.stdout);
  const last = lines[lines.length - 1];
  if (last?.type !== 'summary' || last.exitCode !== run.code) throw new Error(`romlift ${args.join(' ')} --json exited ${run.code} without a matching summary:\n${tail(run)}`);
  return { run, lines };
}

async function snapshot(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (relative === '.git' || relative === 'romlift.toml') continue;
    if (entry.isDirectory()) for (const [key, value] of await snapshot(dir, relative)) out.set(key, value);
    else if (entry.isFile()) out.set(relative, createHash('sha1').update(await readFile(path.join(dir, relative))).digest('hex'));
  }
  return out;
}

function sameTree(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

gate({
  id: 'g4.toml-mutations',
  phase: 4,
  tier: 'both',
  inputs: ['toolchain'],
  realInputs: ['roms'],
  needs: ['init', 'generate', 'parseConfig', 'serializeConfig', 'legalBorders', 'romFromBytes', 'sha1Of', 'profileById', 'analyze'],
  async run(cx) {
    const api: Api = { parse: cx.need<ParseConfig>('parseConfig'), serialize: cx.need<SerializeConfig>('serializeConfig') };
    const legalBorders = cx.need<LegalBorders>('legalBorders');
    const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
    const sha1Of = cx.need<Sha1Of>('sha1Of');
    const analyze = cx.need<Analyze>('analyze');
    const profile = cx.need<ProfileById>('profileById')('agbcc');
    if (profile === undefined) throw new Error("profileById('agbcc') returned nothing");

    const targets: Target[] = cx.fixtures.map((f) => ({ name: f.name, rom: f.rom }));
    if (targets.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    if (cx.tier === 'real') for (const d of cx.datasets) targets.push({ name: d.name, rom: path.resolve(cx.benchRoot, d.rom) });
    const base = await cx.tmpDir('romlift-toml-mutations-');
    const problems: string[] = [];
    let legal = 0;
    let illegal = 0;
    for (const target of targets) {
      const dir = path.join(base, target.name);
      await mkdir(dir, { recursive: true });
      await copyFile(target.rom, path.join(dir, 'baserom.gba'));
      const init = await romlift(cx, dir, ['init', 'baserom.gba']);
      if (init.run.code !== 0) throw new Error(`${target.name}: init exited ${init.run.code}:\n${tail(init.run)}`);
      const tomlPath = path.join(dir, 'romlift.toml');
      const text = await readFile(tomlPath, 'utf8');
      const parsed = api.parse(text);
      if (!parsed.ok) throw new Error(`${target.name}: init's romlift.toml does not parse: ${parsed.diagnostics.map((d) => d.code).join(', ')}`);
      const bytes = new Uint8Array(await readFile(target.rom));
      const rom = romFromBytes(bytes, sha1Of(bytes));
      const analysis = analyze(rom, profile, { mode: 'discover', seeds: [], overrides: [], trail: 'off' });
      const facts: Facts = { config: parsed.value, borders: legalBorders(analysis, profile), analysis, end: rom.end };
      const random = prng(nameSeed(target.name));

      for (const kind of LEGAL_KINDS) {
        const edit = legalEdit(kind, facts, random);
        if (edit === undefined) {
          cx.note(`${target.name}: no place for ${kind}`);
          continue;
        }
        await writeFile(tomlPath, api.serialize(edit.config));
        const generate = await romlift(cx, dir, ['generate']);
        const verify = generate.run.code === 0 ? await romlift(cx, dir, ['verify', '--link']) : undefined;
        const linked = verify?.lines.at(-1)?.sha1;
        if (generate.run.code !== 0 || verify?.run.code !== 0 || linked !== rom.sha1) {
          const codes = [...generate.lines, ...(verify?.lines ?? [])].filter((l) => l.type === 'diagnostic').map((l) => l.code ?? '?');
          problems.push(`${target.name}: ${edit.what}: generate exit ${generate.run.code}, verify exit ${verify?.run.code ?? 'not run'}, linked ${linked ?? 'nothing'}, codes [${codes.join(', ')}]`);
        } else {
          legal++;
        }
      }

      for (const edit of illegalEdits(text, api, facts)) {
        await writeFile(tomlPath, edit.text);
        const before = await snapshot(dir);
        const generate = await romlift(cx, dir, ['generate']);
        const codes = generate.lines.filter((l) => l.type === 'diagnostic').map((l) => l.code ?? '?');
        if (generate.run.code !== 1 || !codes.includes(edit.code)) problems.push(`${target.name}: ${edit.what}: exit ${generate.run.code}, codes [${codes.join(', ')}], expected exit 1 with ${edit.code}`);
        else if (!sameTree(before, await snapshot(dir))) problems.push(`${target.name}: ${edit.what}: the refused generate wrote files`);
        else illegal++;
      }
      await writeFile(tomlPath, text);
    }
    if (problems.length > 0) throw new Error(`TOML mutations: ${problems.join(' | ')}`);
    cx.note(`${legal} legal edits link to the SHA-1 and ${illegal} illegal edits give their codes, on ${targets.length} ROMs`);
  },
});
