// Explain goldens (architecture §9.2, §10, D35, D40, g6.explain-coverage), built only from the committed fixtures.
// Each case picks one address of one fixture by what it is (an entry, a pool word, a rejected candidate, a far bl
// site, an absorbed block, the cartridge entry, the code end, a padding run, a pointer into code, and each fixture's
// subject: the last entry of its expect.json) and records three files: the composed ExplainReport as canonical JSON
// (.json), `romlift explain --json` (.ndjson) and the text output (.txt), compared byte for byte. Three kinds:
//
//   - bare: `<fixture>/<case>.*`, a bare ROM (discover); the CLI runs with $ROMLIFT_SIGNATURES naming an empty
//     directory, so no locally built signature file of a real ROM reaches a golden (D40); the W_SIGNATURES_ABSENT line
//     that run reports (it names the temporary directory, architecture-4) is left out of the golden;
//   - project: `<fixture>/project-<case>.*`, a project written to a temporary directory from init's plan (its
//     romlift.toml, with the case's [[overrides]] appended, decomp.yaml and baserom.gba), explained as `generate`'s
//     confirm run sees it (seed.listed, seed.override);
//   - sig: `sig/library/library-game.<case>.*`, the library-game ROM with the signature file built from the library
//     fixture's spec (bench/dataset/synthetic/library/spec.json, buildSignatures into a temporary directory): one case
//     per placement rule of SIGNATURE_RULES on a bare ROM (`--signatures <dir>`), with the placement's rule, and one in
//     the project init writes with that file, whose signature part is read from romlift.toml's `from` key (D35).
//
// UPDATE_GOLDEN=1 rewrites them and removes the files no case produces; the diff is the review. A rule change moves
// them, and the integrator regenerates them with UPDATE_GOLDEN=1.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../../../src/cli/main.ts';
import type { CliIo } from '../../../src/cli/registry.ts';
import { parseConfig } from '../../../src/core/config/parse.ts';
import { Claim } from '../../../src/core/analysis/types.ts';
import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import { SIGNATURE_RULE_IDS } from '../../../src/core/signatures/schema.ts';
import type { SignatureFile, SignatureRuleId } from '../../../src/core/signatures/schema.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { explain, explainOutcome, explainProject } from '../../../src/core/workflow/explain.ts';
import type { ExplainReport } from '../../../src/core/workflow/explain.ts';
import { init } from '../../../src/core/workflow/init.ts';
import { signaturesOver } from '../../../src/core/workflow/signature-layer.ts';
import { canonicalJson } from '../../../src/foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../../src/foundation/formats/types.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { hexAddr } from '../../../src/foundation/util/hex.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { readScaffoldInputs } from '../../../src/shell/project/read-inputs.ts';
import { buildSignatures, writeSignatureFile } from '../../../src/shell/signatures/build-from-references.ts';
import { SIGNATURES_ENV } from '../../../src/shell/signatures/locate.ts';
import { listSyntheticFixtures, readExpect, SYNTHETIC_ROOT } from '../../helpers/fixtures.ts';
import type { SyntheticFixture } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const EXTENSIONS = ['json', 'ndjson', 'txt'] as const;
type Outputs = Readonly<Record<(typeof EXTENSIONS)[number], string>>;

const TMP = mkdtempSync(join(tmpdir(), 'romlift-explain-golden-'));
after(() => rmSync(TMP, { recursive: true, force: true }));
/** No built signature file: what a bare ROM's CLI run locates, whatever signatures/ holds on this machine. */
const NO_SIGNATURES = join(TMP, 'no-signatures');
mkdirSync(NO_SIGNATURES);

/** Picks the address of a case from the fixture's discover result; undefined when the fixture has none. */
type Pick = (result: AnalysisResult, fixture: SyntheticFixture) => number | undefined;

const notRomEntry = (result: AnalysisResult): AnalysisResult['functions'] => result.functions.filter((f) => f.origin !== 'rom-entry' && f.origin !== 'startup-pointer');

const PICKS: Readonly<Record<string, Pick>> = {
  entry: (r) => notRomEntry(r)[0]?.entry,
  pool: (r) => notRomEntry(r).find((f) => f.pools.length > 0)?.pools[0],
  rejection: (r) => r.rejections[0]?.at,
  'far-bl': (r) => r.functions.flatMap((f) => f.blVerdicts).find((b) => b.verdict === 'far')?.site,
  absorbed: (r) => r.functions.find((f) => f.absorbed.length > 0)?.absorbed[0]?.start,
  // The cartridge entry: seed.rom-entry, and region.startup's verdict on the startup region.
  'rom-entry': (r) => r.functions.find((f) => f.origin === 'rom-entry')?.entry,
  // region.data-after-code's claim from the code end.
  'code-end': (r) => (r.codeEnd < r.rom.end ? r.codeEnd : undefined),
  // region.padding's claim of a run of zero halfwords before an aligned item.
  padding: (r) => r.claims.find((c) => c.kind === Claim.padding)?.span.start,
  // A Thumb pointer into an accepted function's code, which valid.in-rom-unclaimed rejects.
  'inside-code': (r) => r.rejections.find((x) => x.rule === 'valid.in-rom-unclaimed')?.at,
  subject: (_, fixture) => readExpect(fixture).entries.at(-1)?.addr,
};

function pick(name: string): Pick {
  const p = PICKS[name];
  if (p === undefined) throw new Error(`no pick named ${name}`);
  return p;
}

const FIXTURES = listSyntheticFixtures();

function fixtureNamed(name: string): SyntheticFixture {
  const fixture = FIXTURES.find((f) => f.name === name);
  if (fixture === undefined) throw new Error(`the fixture ${name} is missing`);
  return fixture;
}

function romOf(fixture: SyntheticFixture): Rom {
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  return romFromBytes(bytes, sha1Of(bytes));
}

async function cli(argv: readonly string[], cwd: string = DIR): Promise<string> {
  const out: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: () => undefined, cwd, env: { [SIGNATURES_ENV]: NO_SIGNATURES } };
  const code = await main(argv, io);
  assert.equal(code, 0, `romlift ${argv.join(' ')} exited ${code}`);
  return out.join('').split('\n').filter((line) => !line.includes('"code":"W_SIGNATURES_ABSENT"')).join('\n');
}

function canonical(report: ExplainReport): string {
  return `${[...canonicalJson(JSON.parse(JSON.stringify(report)) as JsonValue)].join('')}\n`;
}

// ---------------------------------------------------------------------------------------------------
// The signature file of the library fixture's spec, built once.

const LIBRARY_GAME = fixtureNamed('library-game');
const SIGNATURES_DIR = join(TMP, 'signatures');
let built: SignatureFile | undefined;

async function libfix(): Promise<SignatureFile> {
  if (built !== undefined) return built;
  const result = await buildSignatures({ specPath: join(SYNTHETIC_ROOT, 'library', 'spec.json') });
  if (!result.ok) throw new Error(`the library spec does not build: ${result.diagnostic.message}`);
  const written = await writeSignatureFile(SIGNATURES_DIR, result.value);
  if (!written.ok) throw new Error(written.diagnostic.message);
  built = result.value;
  return built;
}

// ---------------------------------------------------------------------------------------------------
// Projects.

const scaffold = await readScaffoldInputs();
if (!scaffold.ok) throw new Error('the package templates do not read');
const S = scaffold.value;
let projects = 0;

/** A project directory from init's plan for `fixture`, with `overrides` appended to its romlift.toml. */
function projectOf(fixture: SyntheticFixture, overrides: string, files?: readonly SignatureFile[]): { readonly dir: string; readonly text: string; readonly rom: Rom } {
  const rom = romOf(fixture);
  const plan = init({ rom, romFile: 'baserom.gba', options: {}, templates: S.templates, romliftVersion: S.romliftVersion, agbcc: S.agbcc, ...(files === undefined ? {} : { signatureFiles: files }) });
  if (!plan.ok) throw new Error(`init refused ${fixture.name}: ${plan.diagnostics.map((d) => d.code).join(', ')}`);
  const dir = join(TMP, `project-${projects++}`);
  mkdirSync(dir);
  let text = '';
  for (const [path, body] of plan.files) {
    const written = path === 'romlift.toml' ? `${body}${overrides}` : body;
    if (path === 'romlift.toml') text = written;
    writeFileSync(join(dir, path), written);
  }
  writeFileSync(join(dir, plan.romCopy), readFileSync(fixture.rom));
  return { dir, text, rom };
}

// ---------------------------------------------------------------------------------------------------
// The cases.

interface Case {
  /** The golden's path without extension, relative to this directory. */
  readonly file: string;
  readonly outputs: () => Promise<Outputs>;
}

function bare(fixtureName: string, name: string): Case {
  return {
    file: `${fixtureName}/${name}`,
    outputs: async () => {
      const fixture = fixtureNamed(fixtureName);
      const rom = romOf(fixture);
      const addr = pick(name)(discover(rom), fixture);
      if (addr === undefined) throw new Error(`${fixtureName} has no address for the ${name} case`);
      return {
        json: canonical(explain(rom, addr)),
        ndjson: await cli(['explain', hexAddr(addr), '--rom', fixture.rom, '--json']),
        txt: await cli(['explain', hexAddr(addr), '--rom', fixture.rom]),
      };
    },
  };
}

/** A project-mode case: init's project of `fixtureName`, `overrides` appended, explained at the case's address. */
function project(fixtureName: string, name: string, at: string, overrides: (r: AnalysisResult) => string): Case {
  return {
    file: `${fixtureName}/project-${name}`,
    outputs: async () => {
      const fixture = fixtureNamed(fixtureName);
      const result = discover(romOf(fixture));
      const addr = pick(at)(result, fixture);
      if (addr === undefined) throw new Error(`${fixtureName} has no address for the project ${name} case`);
      const p = projectOf(fixture, overrides(result));
      const parsed = parseConfig(p.text);
      if (!parsed.ok) throw new Error(`${fixtureName}: the project's romlift.toml does not parse`);
      const explained = explainProject({ rom: p.rom, config: parsed.value }, addr);
      if (!explained.ok) throw new Error(`${fixtureName}: explainProject refused`);
      return { json: canonical(explained.report), ndjson: await cli(['explain', hexAddr(addr), '--json'], p.dir), txt: await cli(['explain', hexAddr(addr)], p.dir) };
    },
  };
}

/** The address of the first placement of `rule` on library-game. */
async function placedBy(rule: SignatureRuleId): Promise<number> {
  const rom = romOf(LIBRARY_GAME);
  const placed = signaturesOver(rom, discover(rom), [await libfix()]).placements.find((p) => p.rule === rule);
  if (placed === undefined) throw new Error(`${rule} places no member of libfix on library-game: adjust the fixture`);
  return placed.addr;
}

function sigBare(rule: SignatureRuleId): Case {
  return {
    file: `sig/library/library-game.${rule}`,
    outputs: async () => {
      const rom = romOf(LIBRARY_GAME);
      const addr = await placedBy(rule);
      const report = explainOutcome(rom, addr, { signatureFiles: [await libfix()] }).report;
      assert.equal(report.signature?.rule, rule);
      const argv = ['explain', hexAddr(addr), '--rom', LIBRARY_GAME.rom, '--signatures', SIGNATURES_DIR];
      return { json: canonical(report), ndjson: await cli([...argv, '--json']), txt: await cli(argv) };
    },
  };
}

const sigProject: Case = {
  file: 'sig/library/library-game.project',
  outputs: async () => {
    const addr = await placedBy('sig.unique-fit');
    const p = projectOf(LIBRARY_GAME, '', [await libfix()]);
    const parsed = parseConfig(p.text);
    if (!parsed.ok) throw new Error('the library-game project does not parse');
    const explained = explainProject({ rom: p.rom, config: parsed.value }, addr);
    if (!explained.ok) throw new Error('explainProject refused library-game');
    assert.ok(explained.report.signature !== undefined && explained.report.signature.rule === undefined, 'read from `from`, without a rule');
    return { json: canonical(explained.report), ndjson: await cli(['explain', hexAddr(addr), '--json'], p.dir), txt: await cli(['explain', hexAddr(addr)], p.dir) };
  },
};

/** A code override over the first non-startup function's extent: seed.override seeds its start. */
function codeOverride(r: AnalysisResult): string {
  const f = notRomEntry(r)[0];
  if (f === undefined) throw new Error('no function for the code override');
  return `\n[[overrides]]\nstart = ${hexAddr(f.extent.start)}\nsize = 0x${(f.extent.end - f.extent.start).toString(16).toUpperCase()}\nkind = "code"\nmode = "${f.mode}"\n`;
}

const CASES: readonly Case[] = [
  bare('far-jump', 'entry'),
  bare('far-jump', 'pool'),
  bare('far-jump', 'far-bl'),
  bare('pool-word-push-lr', 'rejection'),
  bare('adr-handler-block', 'absorbed'),
  bare('composite', 'rom-entry'),
  bare('composite', 'code-end'),
  bare('composite', 'padding'),
  bare('library-game', 'inside-code'),
  ...FIXTURES.map((f) => bare(f.name, 'subject')),
  project('composite', 'listed', 'entry', () => ''),
  project('composite', 'override', 'entry', codeOverride),
  ...SIGNATURE_RULE_IDS.map(sigBare),
  sigProject,
];

const expected = new Set<string>();
for (const c of CASES) for (const ext of EXTENSIONS) expected.add(`${c.file}.${ext}`);

for (const c of CASES) {
  test(`explain golden ${c.file}`, async () => {
    const actual = await c.outputs();
    for (const ext of EXTENSIONS) {
      const file = join(DIR, `${c.file}.${ext}`);
      if (UPDATE) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, actual[ext]);
      }
      assert.equal(actual[ext], readFileSync(file, 'utf8'), `${c.file}.${ext}`);
    }
  });
}

/** Every golden file under the directories of `dir`, as paths relative to it. */
function goldenFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...goldenFiles(dir, relative));
    else if (prefix !== '') out.push(relative);
  }
  return out;
}

test('every explain golden file belongs to a case, every golden directory to a fixture, and sig/ to the library fixture', () => {
  const stale: string[] = [];
  for (const relative of goldenFiles(DIR)) {
    if (expected.has(relative)) continue;
    if (UPDATE) rmSync(join(DIR, relative));
    else stale.push(relative);
  }
  assert.deepEqual(stale, []);
  const names = new Set(FIXTURES.map((f) => f.name));
  for (const entry of readdirSync(DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'sig') assert.deepEqual(readdirSync(join(DIR, 'sig')), ['library'], 'sig/ holds the library fixture only');
    else assert.ok(names.has(entry.name), `${entry.name} is no committed fixture`);
  }
});
