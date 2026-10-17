// The gate set equals the gate index of docs/architecture.md §13 (D29, D54 e). The index table is parsed
// strictly: each row is `| \`<id>\` | <tier> | <asserts> |` with a tier of `ci`, `real` or `ci and real`,
// optionally annotated `(historical after phase <n>)` or `(sealed)`, and its ids are those §1 lists per
// phase. Then:
//   - test/gates/ holds exactly one `<id>.test.ts` per index id and no other g*.test.ts;
//   - every gate file loads without throwing in a child process (ROMLIFT_GATE_TIER unset), whose resolve
//     hook hands the gate files a stub `./gate.ts` that records each gate() spec instead of registering a
//     test, so nothing runs; each file calls gate() exactly once, with the id of its file name, the phase of
//     its digit, tier 'both' exactly for 'ci and real', historicalAfter exactly where the index says
//     "historical after phase n", a run function, and inputs from the closed GateInput set;
//   - a gate the index marks `(sealed)` reads `cx.sealed`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Tier = 'ci' | 'real' | 'both';

interface IndexRow {
  readonly id: string;
  readonly phase: number;
  readonly tier: Tier;
  readonly historicalAfter?: number;
  readonly sealed: boolean;
}

interface LoadedSpec {
  readonly id: unknown;
  readonly phase: unknown;
  readonly tier: unknown;
  readonly needs: unknown;
  readonly inputs: unknown;
  readonly realInputs: unknown;
  readonly historicalAfter: unknown;
  readonly hasRun: boolean;
  readonly checkIsRun: boolean;
  readonly keys: readonly string[];
}

interface Loaded {
  readonly file: string;
  readonly specs?: readonly LoadedSpec[];
  readonly error?: string;
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const gatesDir = path.join(repoRoot, 'test', 'gates');
const GATE_FILE = /^g\d.*\.test\.ts$/;
const ROW = /^\| `(g([1-6])\.[a-z0-9-]+)` \| ([^|]+?) \| (.+) \|$/;
const TIER_TEXT = /^(ci and real|ci|real)(?: \((?:historical after phase ([1-6])|(sealed))\))?$/;
const GATE_INPUTS: ReadonlySet<string> = new Set(['roms', 'elfs', 'objects', 'poc', 'toolchain', 'klonoa']);
const SPEC_KEYS: ReadonlySet<string> = new Set(['id', 'phase', 'tier', 'needs', 'inputs', 'realInputs', 'historicalAfter', 'historicalCheck', 'run']);

function architecture(): string {
  return readFileSync(path.join(repoRoot, 'docs', 'architecture.md'), 'utf8');
}

function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `architecture.md has no '${heading}' heading`);
  const next = doc.indexOf('\n## ', start + heading.length + 2);
  return doc.slice(start, next < 0 ? doc.length : next);
}

/** The §13 table, one row per gate; any table row that does not parse fails. */
function gateIndex(): readonly IndexRow[] {
  const rows: IndexRow[] = [];
  for (const line of section(architecture(), '## 13. Gate index').split('\n')) {
    if (!line.startsWith('| `')) continue;
    const row = ROW.exec(line);
    assert.ok(row, `§13 row does not parse: ${line.slice(0, 120)}`);
    const [, id = '', phase = '', tierText = ''] = row;
    const tier = TIER_TEXT.exec(tierText.trim());
    assert.ok(tier, `§13 ${id}: unknown tier text '${tierText}'`);
    const [, base = '', historical, sealed] = tier;
    rows.push({
      id,
      phase: Number(phase),
      tier: base === 'ci and real' ? 'both' : base === 'ci' ? 'ci' : 'real',
      ...(historical === undefined ? {} : { historicalAfter: Number(historical) }),
      sealed: sealed !== undefined,
    });
  }
  return rows;
}

/** The gate ids §1's phase table lists, by phase. */
function phaseTableIds(): ReadonlyMap<number, readonly string[]> {
  const out = new Map<number, readonly string[]>();
  for (const line of section(architecture(), '## 1. Goals and non-goals').split('\n')) {
    const phase = /^\| ([1-6]) [A-Z]/.exec(line)?.[1];
    if (phase === undefined) continue;
    const cells = line.split('|');
    const ids = [...(cells[cells.length - 2] ?? '').matchAll(/`(g[1-6]\.[a-z0-9-]+)`/g)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));
    out.set(Number(phase), ids);
  }
  return out;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gateFiles(): readonly string[] {
  return readdirSync(gatesDir)
    .filter((name) => GATE_FILE.test(name))
    .sort(byCodeUnit);
}

// The child: a resolve hook gives every test/gates/g*.test.ts a stub './gate.ts' that re-exports the real
// framework but replaces gate() with a recorder, then each gate file is imported in turn.
const CHILD = `
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const stub = pathToFileURL(process.env.ROMLIFT_INDEX_STUB).href;
const gateFile = /\\/test\\/gates\\/g[1-6]\\.[^/]+\\.test\\.ts$/;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './gate.ts' && typeof context.parentURL === 'string' && gateFile.test(context.parentURL)) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
globalThis.__romliftGateSpecs = [];
const out = [];
for (const file of JSON.parse(process.env.ROMLIFT_INDEX_FILES)) {
  const before = globalThis.__romliftGateSpecs.length;
  try {
    await import(pathToFileURL(file).href);
    const specs = globalThis.__romliftGateSpecs.slice(before).map((s) => ({
      id: s.id, phase: s.phase, tier: s.tier, needs: s.needs, inputs: s.inputs, realInputs: s.realInputs,
      historicalAfter: s.historicalAfter, hasRun: typeof s.run === 'function', checkIsRun: s.historicalCheck === s.run, keys: Object.keys(s).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }));
    out.push({ file, specs });
  } catch (error) {
    out.push({ file, error: String(error instanceof Error ? error.stack ?? error.message : error) });
  }
}
process.stdout.write(JSON.stringify(out));
`;

function loadSpecs(files: readonly string[]): readonly Loaded[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'romlift-gates-index-'));
  try {
    const stub = path.join(dir, 'gate-stub.mjs');
    const real = pathToFileURL(path.join(gatesDir, 'gate.ts')).href;
    writeFileSync(stub, `export * from ${JSON.stringify(real)};\nexport function gate(spec) {\n  globalThis.__romliftGateSpecs.push(spec);\n}\n`);
    const env: Record<string, string | undefined> = { ...process.env, ROMLIFT_INDEX_STUB: stub, ROMLIFT_INDEX_FILES: JSON.stringify(files.map((f) => path.join(gatesDir, f))) };
    delete env['ROMLIFT_GATE_TIER'];
    delete env['ROMLIFT_GATE_REPORT'];
    delete env['NODE_TEST_CONTEXT'];
    const child = spawnSync(process.execPath, ['--conditions=source', '--input-type=module', '--eval', CHILD], { cwd: repoRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(child.status, 0, `the loader child failed:\n${child.stderr}`);
    return JSON.parse(child.stdout) as readonly Loaded[];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

test('the §13 gate index parses strictly and agrees with the phase table of §1', () => {
  const index = gateIndex();
  assert.ok(index.length >= 60, `only ${index.length} gates parsed from §13`);
  assert.equal(new Set(index.map((row) => row.id)).size, index.length, 'gate ids are unique');
  for (const row of index) assert.equal(row.id.charAt(1), String(row.phase), `${row.id}: phase digit`);
  const phases = phaseTableIds();
  for (const phase of [1, 2, 3, 4, 5, 6]) {
    const listed = [...(phases.get(phase) ?? [])].sort(byCodeUnit);
    const indexed = index.filter((row) => row.phase === phase).map((row) => row.id).sort(byCodeUnit);
    assert.deepEqual(indexed, listed, `phase ${phase}: §13 and §1 list different gates`);
  }
});

test('test/gates holds exactly one file per §13 gate and no other gate file', () => {
  const ids = gateIndex().map((row) => row.id).sort(byCodeUnit);
  const files = gateFiles().map((name) => name.slice(0, -'.test.ts'.length));
  assert.deepEqual(files.filter((id) => !ids.includes(id)), [], 'gate files with no §13 row');
  assert.deepEqual(ids.filter((id) => !files.includes(id)), [], '§13 gates with no file');
});

test('every gate file loads and declares the gate() spec §13 gives it', () => {
  const index = new Map(gateIndex().map((row) => [row.id, row]));
  const files = gateFiles();
  const loaded = loadSpecs(files);
  assert.equal(loaded.length, files.length);
  for (const result of loaded) {
    const name = path.basename(result.file);
    const id = name.slice(0, -'.test.ts'.length);
    assert.equal(result.error, undefined, `${name} throws when loaded:\n${result.error ?? ''}`);
    const specs = result.specs ?? [];
    assert.equal(specs.length, 1, `${name}: calls gate() ${specs.length} times, not once`);
    const spec = specs[0];
    const row = index.get(id);
    if (spec === undefined || row === undefined) continue;
    assert.equal(spec.id, id, `${name}: gate id`);
    assert.equal(spec.phase, row.phase, `${name}: phase`);
    assert.equal(spec.tier, row.tier, `${name}: tier (§13 '${row.tier}')`);
    assert.equal(spec.historicalAfter, row.historicalAfter, `${name}: historicalAfter`);
    assert.ok(spec.hasRun, `${name}: run is not a function`);
    // A historical gate keeps running its own check once frozen (D60, gate-honesty-r1-3, gate-honesty-r2-1):
    // its historicalCheck is its run, so raising phase.json cannot freeze a gate whose check fails.
    assert.equal(spec.keys.includes('historicalCheck'), spec.historicalAfter !== undefined, `${name}: historicalCheck exactly when historicalAfter`);
    if (spec.historicalAfter !== undefined) assert.ok(spec.checkIsRun, `${name}: historicalCheck must be the gate's own run`);
    assert.ok(isStringArray(spec.needs), `${name}: needs is not a string array`);
    for (const key of ['inputs', 'realInputs'] as const) {
      const value = spec[key];
      if (value === undefined) continue;
      assert.ok(isStringArray(value) && value.every((v) => GATE_INPUTS.has(v)), `${name}: ${key} holds an input outside the GateInput set`);
    }
    if (row.tier === 'ci') assert.equal(spec.realInputs, undefined, `${name}: a ci gate's realInputs are never checked`);
    assert.deepEqual(spec.keys.filter((k) => !SPEC_KEYS.has(k)), [], `${name}: keys outside GateSpec`);
  }
});

test('a gate §13 marks sealed reads the sealed datasets', () => {
  const sealed = gateIndex().filter((row) => row.sealed);
  assert.ok(sealed.length > 0, 'no §13 gate is marked (sealed)');
  for (const row of sealed) {
    const text = readFileSync(path.join(gatesDir, `${row.id}.test.ts`), 'utf8');
    assert.match(text, /\bcx\.sealed\b/, `${row.id} is sealed in §13 but never reads cx.sealed`);
  }
});
