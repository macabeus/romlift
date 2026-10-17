// Explain goldens (architecture §9.2, §10, D35), built only from the committed fixtures. Each case picks
// one address of one fixture by what it is (an entry, a pool word, a rejected candidate, a far bl site, an
// absorbed block, and each fixture's subject: the last entry of its expect.json) and records three files
// under <fixture>/<case>: the composed ExplainReport as canonical JSON (.json), `romlift explain --json`
// (.ndjson) and the text output (.txt), compared byte for byte. UPDATE_GOLDEN=1 rewrites them and removes
// the files no case produces; the diff is the review. A rule change moves them, and the integrator
// regenerates them with UPDATE_GOLDEN=1.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../../../src/cli/main.ts';
import type { CliIo } from '../../../src/cli/registry.ts';
import type { AnalysisResult } from '../../../src/core/analysis/types.ts';
import { discover } from '../../../src/core/workflow/discover.ts';
import { explain } from '../../../src/core/workflow/explain.ts';
import { canonicalJson } from '../../../src/foundation/formats/canonical-json.ts';
import type { JsonValue } from '../../../src/foundation/formats/types.ts';
import type { Rom } from '../../../src/foundation/rom/rom.ts';
import { romFromBytes } from '../../../src/foundation/rom/rom.ts';
import { hexAddr } from '../../../src/foundation/util/hex.ts';
import { sha1Of } from '../../../src/shell/hash.ts';
import { listSyntheticFixtures, readExpect } from '../../helpers/fixtures.ts';
import type { SyntheticFixture } from '../../helpers/fixtures.ts';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';
const EXTENSIONS = ['json', 'ndjson', 'txt'] as const;

/** Picks the address of a case from the fixture's discover result; undefined when the fixture has none. */
type Pick = (result: AnalysisResult, fixture: SyntheticFixture) => number | undefined;

interface Case {
  readonly fixture: string;
  readonly name: string;
  readonly pick: Pick;
}

const notRomEntry = (result: AnalysisResult): AnalysisResult['functions'] => result.functions.filter((f) => f.origin !== 'rom-entry' && f.origin !== 'startup-pointer');

const PICKS: Readonly<Record<string, Pick>> = {
  entry: (r) => notRomEntry(r)[0]?.entry,
  pool: (r) => notRomEntry(r).find((f) => f.pools.length > 0)?.pools[0],
  rejection: (r) => r.rejections[0]?.at,
  'far-bl': (r) => r.functions.flatMap((f) => f.blVerdicts).find((b) => b.verdict === 'far')?.site,
  absorbed: (r) => r.functions.find((f) => f.absorbed.length > 0)?.absorbed[0]?.start,
  subject: (_, fixture) => readExpect(fixture).entries.at(-1)?.addr,
};

function pick(name: string): Pick {
  const p = PICKS[name];
  if (p === undefined) throw new Error(`no pick named ${name}`);
  return p;
}

const FIXTURES = listSyntheticFixtures();

const CASES: readonly Case[] = [
  { fixture: 'far-jump', name: 'entry', pick: pick('entry') },
  { fixture: 'far-jump', name: 'pool', pick: pick('pool') },
  { fixture: 'far-jump', name: 'far-bl', pick: pick('far-bl') },
  { fixture: 'pool-word-push-lr', name: 'rejection', pick: pick('rejection') },
  { fixture: 'adr-handler-block', name: 'absorbed', pick: pick('absorbed') },
  ...FIXTURES.map((f): Case => ({ fixture: f.name, name: 'subject', pick: pick('subject') })),
];

function romOf(fixture: SyntheticFixture): Rom {
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  return romFromBytes(bytes, sha1Of(bytes));
}

async function cli(argv: readonly string[]): Promise<string> {
  const out: string[] = [];
  const io: CliIo = { stdout: (t) => out.push(t), stderr: () => undefined, cwd: DIR, env: {} };
  const code = await main(argv, io);
  assert.equal(code, 0, `romlift ${argv.join(' ')} exited ${code}`);
  return out.join('');
}

async function outputs(c: Case): Promise<Readonly<Record<(typeof EXTENSIONS)[number], string>>> {
  const fixture = FIXTURES.find((f) => f.name === c.fixture);
  if (fixture === undefined) throw new Error(`the fixture ${c.fixture} is missing`);
  const rom = romOf(fixture);
  const addr = c.pick(discover(rom), fixture);
  if (addr === undefined) throw new Error(`${c.fixture} has no address for the ${c.name} case`);
  const report = JSON.parse(JSON.stringify(explain(rom, addr))) as JsonValue;
  return {
    json: `${[...canonicalJson(report)].join('')}\n`,
    ndjson: await cli(['explain', hexAddr(addr), '--rom', fixture.rom, '--json']),
    txt: await cli(['explain', hexAddr(addr), '--rom', fixture.rom]),
  };
}

const expected = new Set<string>();
for (const c of CASES) for (const ext of EXTENSIONS) expected.add(`${c.fixture}/${c.name}.${ext}`);

for (const c of CASES) {
  test(`explain golden ${c.fixture}/${c.name}`, async () => {
    const actual = await outputs(c);
    for (const ext of EXTENSIONS) {
      const file = join(DIR, c.fixture, `${c.name}.${ext}`);
      if (UPDATE) {
        mkdirSync(join(DIR, c.fixture), { recursive: true });
        writeFileSync(file, actual[ext]);
      }
      assert.equal(actual[ext], readFileSync(file, 'utf8'), `${c.fixture}/${c.name}.${ext}`);
    }
  });
}

test('every explain golden file belongs to a case, and every golden directory to a fixture', () => {
  const stale: string[] = [];
  for (const entry of readdirSync(DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of readdirSync(join(DIR, entry.name))) {
      const relative = `${entry.name}/${file}`;
      if (expected.has(relative)) continue;
      if (UPDATE) rmSync(join(DIR, relative));
      else stale.push(relative);
    }
  }
  assert.deepEqual(stale, []);
  const names = new Set(FIXTURES.map((f) => f.name));
  for (const entry of readdirSync(DIR, { withFileTypes: true })) if (entry.isDirectory()) assert.ok(names.has(entry.name), `${entry.name} is no committed fixture`);
});
