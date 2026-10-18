// The raw printer's PoC parity (roadmap 3.B gate, architecture §5 "Raw printer"): `--printer raw` keeps the
// proof of concept's all-data emission, so on every committed fixture romlift's printRawRange, fed the PoC's
// own chunk spans, inner labels and word kinds (a byte is part of a word when the PoC claimed it as a pool word
// or a table entry, claim kinds 2 and 3), prints exactly the body lines the PoC's rawLines printed into its
// writeGenerated() tree. The PoC's side is the dump `npm run export-poc -- --mode raw` writes to
// bench/.local/poc/raw/<fixture>/raw.json; a fixture without a dump, or a dump of another fixture build or PoC
// checkout, is `unavailable`, or fails when ROMLIFT_REQUIRE_LOCAL=1.
//
// test/local imports romlift only through its entry points (architecture §2).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { romFromBytes } from 'romlift';
import { printRawRange } from 'romlift/internal';
import { sha1Of } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SYNTHETIC = path.join(REPO, 'bench', 'dataset', 'synthetic');
const DUMPS = path.join(REPO, 'bench', '.local', 'poc', 'raw');
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const SCHEMA = 'romlift-bench/poc-raw@1';
const POC_POOL = 2;
const POC_TABLE = 3;

interface DumpLabel {
  readonly addr: number;
  readonly name: string;
  readonly note?: string;
}

interface DumpChunk {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly labels: readonly DumpLabel[];
  readonly lines: readonly string[];
}

interface Dump {
  readonly schema: string;
  readonly fixture: string;
  readonly sha1: string;
  readonly pocSourceDigest: string;
  readonly chunks: readonly DumpChunk[];
  readonly claims: readonly number[];
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const fixtures = readdirSync(SYNTHETIC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(SYNTHETIC, e.name, 'build', `${e.name}.gba`)))
  .map((e) => e.name)
  .sort(byCodeUnit);
const pocSourceDigest = (JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-source.json'), 'utf8')) as { readonly digest: string }).digest;

test('the committed fixtures are found', () => {
  assert.ok(fixtures.length >= 47, `${fixtures.length} fixtures`);
});

for (const fixture of fixtures) {
  const dumpPath = path.join(DUMPS, fixture, 'raw.json');
  const bytes = new Uint8Array(readFileSync(path.join(SYNTHETIC, fixture, 'build', `${fixture}.gba`)));
  const sha1 = sha1Of(bytes);
  const dump = existsSync(dumpPath) ? (JSON.parse(readFileSync(dumpPath, 'utf8')) as Dump) : undefined;
  const unavailable =
    dump === undefined
      ? `unavailable: ${dumpPath} (npm run export-poc -- --mode raw)`
      : dump.sha1 !== sha1 || dump.pocSourceDigest !== pocSourceDigest
        ? `unavailable: ${dumpPath} is of another fixture build or PoC checkout; re-run npm run export-poc -- --mode raw`
        : undefined;

  test(`the raw printer prints the PoC's rawLines: ${fixture}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    assert.ok(dump !== undefined);
    assert.equal(dump.schema, SCHEMA);
    assert.equal(dump.fixture, fixture);
    assert.equal(dump.claims.length, bytes.length, 'one PoC claim kind per ROM byte');
    const rom = romFromBytes(bytes, sha1);
    const isWord = (addr: number): boolean => {
      const kind = dump.claims[addr - rom.base];
      return kind === POC_POOL || kind === POC_TABLE;
    };
    let lines = 0;
    for (const c of dump.chunks) {
      assert.deepEqual(printRawRange(rom, isWord, c.start, c.end, c.labels), c.lines, `${fixture}: chunk ${c.name} [${c.start.toString(16)}, ${c.end.toString(16)})`);
      lines += c.lines.length;
    }
    t.diagnostic(`${fixture}: ${dump.chunks.length} chunks, ${lines} body lines equal`);
  });
}
