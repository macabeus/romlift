// g2.synthetic-analysis (architecture §8.1, §13): every committed fixture's expect.json holds: each
// expected entry is found with its mode and, where given, its extent; the code end matches; a negative
// fixture gets zero entries beyond the expected ones. As on every dataset (§8.4, milestone M5), entries
// are counted from the end of the startup region: the cartridge entry and the startup code of the
// shared crt0.s are the startup region, not entries a fixture expects.
//
// Calls the phase-2 API as frozen in architecture §3.3: romFromBytes(bytes, sha1), sha1Of(bytes),
// profileById('agbcc'), analyze(rom, profile, {mode: 'discover', seeds: [], overrides: [], trail: 'off'}).
//
// Expected bench/dataset/synthetic/<name>/expect.json, for the 2.E author to align (addresses are "0x..."
// strings or numbers):
//   { negative?: boolean,                         true: zero entries beyond `entries`
//     entries: [{ addr, mode: 'thumb' | 'arm', extent?: { start, end } }],
//     codeEnd?: addr }
import { readFile } from 'node:fs/promises';

import { gate } from './gate.ts';

type Mode = 'thumb' | 'arm';
type AddrText = string | number;

interface Expect {
  readonly negative?: boolean;
  readonly entries: readonly {
    readonly addr: AddrText;
    readonly mode: Mode;
    readonly extent?: { readonly start: AddrText; readonly end: AddrText };
  }[];
  readonly codeEnd?: AddrText;
}

interface FunctionFact {
  readonly entry: number;
  readonly mode: Mode;
  readonly extent: { readonly start: number; readonly end: number };
}

interface AnalysisResult {
  readonly functions: readonly FunctionFact[];
  readonly codeEnd: number;
  readonly startup: { readonly span: { readonly start: number; readonly end: number } };
}

interface Rom {
  readonly sha1: string;
}

type RomFromBytes = (bytes: Uint8Array, sha1: string) => Rom;
type Sha1Of = (data: Uint8Array) => string;
type ProfileById = (id: string) => object | undefined;
type Analyze = (
  rom: Rom,
  profile: object,
  options: {
    readonly mode: 'discover';
    readonly seeds: readonly never[];
    readonly overrides: readonly never[];
    readonly trail: 'off';
  },
) => AnalysisResult;

function addr(value: AddrText, where: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${where}: '${String(value)}' is not an address`);
  return n;
}

function hex(a: number): string {
  return `0x${a.toString(16).toUpperCase().padStart(8, '0')}`;
}

gate({
  id: 'g2.synthetic-analysis',
  phase: 2,
  tier: 'ci',
  needs: ['romFromBytes', 'sha1Of', 'profileById', 'analyze'],
  async run(cx) {
    if (cx.fixtures.length === 0) throw new Error('no committed fixture under bench/dataset/synthetic');
    const romFromBytes = cx.need<RomFromBytes>('romFromBytes');
    const sha1Of = cx.need<Sha1Of>('sha1Of');
    const analyze = cx.need<Analyze>('analyze');
    const profile = cx.need<ProfileById>('profileById')('agbcc');
    if (profile === undefined) throw new Error("profileById('agbcc') returned undefined");

    const problems: string[] = [];
    let negatives = 0;
    for (const fixture of cx.fixtures) {
      const expect = JSON.parse(await readFile(fixture.expect, 'utf8')) as Expect;
      const bytes = new Uint8Array(await readFile(fixture.rom));
      const result = analyze(romFromBytes(bytes, sha1Of(bytes)), profile, {
        mode: 'discover',
        seeds: [],
        overrides: [],
        trail: 'off',
      });
      const found = new Map(result.functions.map((f) => [f.entry, f] as const));
      const expected = new Set<number>();
      for (const entry of expect.entries) {
        const at = addr(entry.addr, `${fixture.name}/expect.json`);
        expected.add(at);
        const fact = found.get(at);
        if (fact === undefined) {
          problems.push(`${fixture.name}: missed ${hex(at)}`);
          continue;
        }
        if (fact.mode !== entry.mode)
          problems.push(`${fixture.name}: ${hex(at)} is ${fact.mode}, expected ${entry.mode}`);
        if (entry.extent !== undefined) {
          const start = addr(entry.extent.start, `${fixture.name}/expect.json`);
          const end = addr(entry.extent.end, `${fixture.name}/expect.json`);
          if (fact.extent.start !== start || fact.extent.end !== end) {
            problems.push(
              `${fixture.name}: ${hex(at)} extent [${hex(fact.extent.start)}, ${hex(fact.extent.end)}), expected [${hex(start)}, ${hex(end)})`,
            );
          }
        }
      }
      if (expect.codeEnd !== undefined && result.codeEnd !== addr(expect.codeEnd, `${fixture.name}/expect.json`)) {
        problems.push(
          `${fixture.name}: code end ${hex(result.codeEnd)}, expected ${hex(addr(expect.codeEnd, fixture.name))}`,
        );
      }
      if (expect.negative === true) {
        negatives++;
        const extra = result.functions
          .filter((f) => f.entry >= result.startup.span.end && !expected.has(f.entry))
          .map((f) => hex(f.entry));
        if (extra.length > 0)
          problems.push(`${fixture.name} (negative): ${extra.length} extra entries ${extra.slice(0, 8).join(', ')}`);
      }
    }
    if (problems.length > 0) throw new Error(`fixture expectations fail: ${problems.join('; ')}`);
    // `negative` is the flag that forbids extra entries; every committed fixture sets it (bench/dataset/synthetic/index.md,
    // "Exhaustive"), so the note says how many allow none, not how many are negative fixtures in the §8.1 sense.
    cx.note(`${cx.fixtures.length} fixtures hold their expect.json, no extra entries allowed in ${negatives}`);
  },
});
