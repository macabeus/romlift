// The committed synthetic fixtures (architecture §8.1, D28) for tests: the fixture directories under
// bench/dataset/synthetic that hold a committed build/<name>.gba (the rule test/gates/gate.ts's
// listFixtures uses, so common/ is never one), their paths, their expect.json parsed and checked, their
// ROM as romlift reads it, and the judgement of an analysis against an expect.json.
//
// expect.json (frozen by test/gates/g2.synthetic-analysis.test.ts):
//   { negative?: boolean, entries: [{ addr, mode: 'thumb' | 'arm', extent?: { start, end } }], codeEnd? }
// plus, on the phase-4 fixtures, the keys the g4 gates read (init, illegalBorder, compilers), not parsed here.
// with addresses as "0x..." strings (numbers are accepted, as the gate accepts them). The entries are
// every FUNC symbol of the fixture's ELF inside the ROM, the two startup functions of common/crt0.s
// included: the gate allows a negative fixture no entry beyond its list.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnalysisResult, type Rom, romFromBytes } from 'romlift';
import { sha1Of } from 'romlift/node';

export type FixtureMode = 'thumb' | 'arm';

export interface FixtureExtent {
  readonly start: number;
  readonly end: number;
}

export interface FixtureEntry {
  readonly addr: number;
  readonly mode: FixtureMode;
  readonly extent?: FixtureExtent;
}

export interface FixtureExpect {
  /** true: the analysis must report no entry beyond `entries`. */
  readonly negative: boolean;
  /** In ascending address order. */
  readonly entries: readonly FixtureEntry[];
  readonly codeEnd?: number;
}

/** One committed fixture; every path is absolute. */
export interface SyntheticFixture {
  readonly name: string;
  readonly dir: string;
  readonly buildMk: string;
  readonly expect: string;
  readonly rom: string;
  readonly elf: string;
}

/** bench/dataset/synthetic of this checkout. */
export const SYNTHETIC_ROOT = fileURLToPath(new URL('../../bench/dataset/synthetic/', import.meta.url));

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The fixtures under `root` that hold build/<name>.gba, sorted by name. */
export function listSyntheticFixtures(root: string = SYNTHETIC_ROOT): readonly SyntheticFixture[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(join(root, entry.name, 'build', `${entry.name}.gba`)))
    .map((entry) => entry.name)
    .sort(byCodeUnit)
    .map((name) => {
      const dir = join(root, name);
      return {
        name,
        dir,
        buildMk: join(dir, 'build.mk'),
        expect: join(dir, 'expect.json'),
        rom: join(dir, 'build', `${name}.gba`),
        elf: join(dir, 'build', `${name}.elf`),
      };
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function address(value: unknown, where: string): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^0x[0-9A-Fa-f]+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(n) || n < 0) throw new Error(`${where}: '${String(value)}' is not an address`);
  return n;
}

/**
 * The keys an expect.json may hold: the analysis expectation above, and the keys the later gates read and this parser
 * leaves to them (`init` in g4.e2e-fixtures and g4.multi-compiler, `illegalBorder` in g4.e2e-fixtures, `compilers` in
 * g4.multi-compiler, test/unit/fixtures/phase4-fixtures.test.ts checking their shapes; `ramCopy`, the hand-written
 * runs_at range, in g6.ram-code-mapped and test/local/ram-code.test.ts).
 */
const KEYS = new Set(['negative', 'entries', 'codeEnd', 'init', 'illegalBorder', 'compilers', 'ramCopy']);

/** Parses and checks the text of an expect.json; throws naming `where` and the first problem. */
export function parseExpect(text: string, where: string): FixtureExpect {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`${where}: not an object`);
  for (const key of Object.keys(value)) if (!KEYS.has(key)) throw new Error(`${where}: unknown key '${key}'`);
  const negative = value['negative'];
  if (negative !== undefined && typeof negative !== 'boolean') throw new Error(`${where}: negative is not a boolean`);
  const list = value['entries'];
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${where}: entries is not a non-empty array`);
  const entries = list.map((raw: unknown, i: number): FixtureEntry => {
    const at = `${where}: entries[${i}]`;
    if (!isRecord(raw)) throw new Error(`${at} is not an object`);
    const addr = address(raw['addr'], `${at}.addr`);
    const mode = raw['mode'];
    if (mode !== 'thumb' && mode !== 'arm') throw new Error(`${at}.mode is not 'thumb' or 'arm'`);
    const extent = raw['extent'];
    if (extent === undefined) return { addr, mode };
    if (!isRecord(extent)) throw new Error(`${at}.extent is not an object`);
    const start = address(extent['start'], `${at}.extent.start`);
    const end = address(extent['end'], `${at}.extent.end`);
    if (start !== addr || end <= start) throw new Error(`${at}.extent must start at addr and end after it`);
    return { addr, mode, extent: { start, end } };
  });
  for (let i = 1; i < entries.length; i++) {
    if ((entries[i - 1]?.addr ?? 0) >= (entries[i]?.addr ?? 0))
      throw new Error(`${where}: entries are not in ascending address order`);
  }
  const code = value['codeEnd'];
  const base = { negative: negative === true, entries };
  return code === undefined ? base : { ...base, codeEnd: address(code, `${where}: codeEnd`) };
}

/** The parsed expect.json of a fixture. */
export function readExpect(fixture: SyntheticFixture): FixtureExpect {
  return parseExpect(readFileSync(fixture.expect, 'utf8'), `${fixture.name}/expect.json`);
}

/** The fixture's committed ROM, as the gates read it. */
export function readFixtureRom(fixture: SyntheticFixture): Rom {
  const bytes = new Uint8Array(readFileSync(fixture.rom));
  return romFromBytes(bytes, sha1Of(bytes));
}

const hex = (a: number): string => `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;

/**
 * Where `result` breaks `expect`, as g2.synthetic-analysis judges it: an expected entry missed or found
 * in another mode or with another extent, another code end, and on a negative fixture every entry
 * beyond the list. Empty when the expectation holds.
 */
export function expectProblems(
  expect: FixtureExpect,
  result: Pick<AnalysisResult, 'functions' | 'codeEnd'>,
): readonly string[] {
  const problems: string[] = [];
  const found = new Map(result.functions.map((f) => [f.entry, f] as const));
  for (const e of expect.entries) {
    const f = found.get(e.addr);
    if (f === undefined) problems.push(`missed ${hex(e.addr)}`);
    else if (f.mode !== e.mode) problems.push(`${hex(e.addr)} is ${f.mode}, expected ${e.mode}`);
    else if (e.extent !== undefined && (f.extent.start !== e.extent.start || f.extent.end !== e.extent.end)) {
      problems.push(
        `${hex(e.addr)} extent [${hex(f.extent.start)}, ${hex(f.extent.end)}), expected [${hex(e.extent.start)}, ${hex(e.extent.end)})`,
      );
    }
  }
  if (expect.codeEnd !== undefined && result.codeEnd !== expect.codeEnd)
    problems.push(`code end ${hex(result.codeEnd)}, expected ${hex(expect.codeEnd)}`);
  if (expect.negative) {
    const listed = new Set(expect.entries.map((e) => e.addr));
    for (const f of result.functions) if (!listed.has(f.entry)) problems.push(`extra entry ${hex(f.entry)}`);
  }
  return problems;
}
