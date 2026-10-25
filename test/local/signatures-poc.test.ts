// The matcher against the PoC's own numbers (roadmap 6.B, architecture §7.2, D50): the PoC's signature files
// ($ROMLIFT_POC/signatures/*.json, schema 2, read-only) adapted to schema 3 in memory, then a seedless discover run,
// matchSignatures and resolvePlacements on each of the five ROMs the PoC judged. Per library and version, the
// settled placements must reach at least the PoC's counts in bench/baseline/poc-2026-10-16.json (`signatures.versions`:
// klonoa m4a 2001 94 functions and 10 tables, libagbsyscall 6, libgcc 20; fe7j 18, 22, 94 and 10; pokeemerald 15, 67,
// 109 and 10 with m4a 2004; sa2 12, 24, 94 and 10; sa3 13, 65, 94 and 10). The adaptation: a member's id is
// `<PoC name>@<library>.o`, a pointer's name becomes that id, and each reference's link order is its members
// (functions and tables) with their PoC `refAddr`. A missing ROM or PoC file makes the test `unavailable`, or fails
// it when ROMLIFT_REQUIRE_LOCAL=1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { discover, matchSignatures, parseSignatureFile, resolvePlacements, romFromBytes, type MemberId, type SignatureFile } from 'romlift';
import { sha1Of } from 'romlift/node';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const BENCH_ENV = process.env['ROMLIFT_BENCH_ROOT'];
const BENCH_ROOT = BENCH_ENV ? path.resolve(REPO, BENCH_ENV) : path.dirname(REPO);
const POC_ENV = process.env['ROMLIFT_POC'];
const POC = POC_ENV ? path.resolve(REPO, POC_ENV) : path.join(BENCH_ROOT, 'romlift-poc');
const POC_SIGNATURES = path.join(POC, 'signatures');
const REQUIRE = process.env['ROMLIFT_REQUIRE_LOCAL'] === '1';
const ROMS = ['fe7j', 'klonoa', 'pokeemerald', 'sa2', 'sa3'] as const;

/** The PoC's reference projects as bench datasets. */
const DATASETS: Readonly<Record<string, string>> = { FireEmblem7J: 'fe7j', kleod: 'klonoa', pokeemerald: 'pokeemerald', sa2: 'sa2', sa3: 'sa3' };

interface PocMember {
  readonly name: string;
  readonly ref: number;
  readonly refAddr: number;
  readonly size: number;
  readonly bytes: string;
  readonly mask: string;
  readonly mode?: 'thumb' | 'arm';
  readonly pointers?: readonly (string | null)[];
}

interface PocFile {
  readonly schema: 2;
  readonly library: string;
  readonly versions: readonly {
    readonly version: string;
    readonly note?: string;
    readonly references: readonly { readonly project: string; readonly commit: string | null; readonly romSha1: string }[];
    readonly functions: readonly PocMember[];
    readonly objects: readonly PocMember[];
  }[];
}

/** A PoC schema-2 file as schema 3, validated by the product's own parser. */
function adapt(poc: PocFile): SignatureFile {
  const id = (name: string): MemberId => `${name}@${poc.library}.o`;
  const json = {
    schema: 3,
    library: poc.library,
    builtWith: 'romlift-poc (adapted in test/local/signatures-poc.test.ts)',
    versions: poc.versions.map((v) => {
      const references = v.references.map((r) => ({ dataset: DATASETS[r.project] ?? r.project, commit: r.commit ?? 'unknown', romSha1: r.romSha1 }));
      return {
        id: v.version,
        idNote: v.note ?? '',
        references,
        linkOrder: references.map((r, i) => ({
          reference: r.dataset,
          members: [...v.functions, ...v.objects].filter((m) => m.ref === i).map((m) => ({ id: id(m.name), addr: m.refAddr })),
        })),
        functions: v.functions.map((f) => ({ id: id(f.name), name: f.name, mode: f.mode ?? 'thumb', size: f.size, bytes: f.bytes, mask: f.mask })),
        tables: v.objects.map((o) => ({
          id: id(o.name),
          name: o.name,
          size: o.size,
          bytes: o.bytes,
          mask: o.mask,
          ...(o.pointers === undefined ? {} : { names: o.pointers.map((n) => (n === null ? null : id(n))) }),
        })),
      };
    }),
  };
  const parsed = parseSignatureFile(JSON.parse(JSON.stringify(json)));
  if (!parsed.ok) throw new Error(`${poc.library}: the adapted file does not validate: ${parsed.error}`);
  return parsed.value;
}

interface BaselineRow {
  readonly name: string;
  readonly signatures?: { readonly versions: readonly { readonly library: string; readonly version: string; readonly functions: number; readonly objects: number }[] };
}

const baseline = (JSON.parse(readFileSync(path.join(REPO, 'bench', 'baseline', 'poc-2026-10-16.json'), 'utf8')) as { readonly roms: readonly BaselineRow[] }).roms;

const pocFiles = existsSync(POC_SIGNATURES) ? readdirSync(POC_SIGNATURES).filter((f) => f.endsWith('.json')).sort() : [];
const files = pocFiles.map((f) => adapt(JSON.parse(readFileSync(path.join(POC_SIGNATURES, f), 'utf8')) as PocFile));

for (const name of ROMS) {
  const dataset = JSON.parse(readFileSync(path.join(REPO, 'bench', 'dataset', 'real', `${name}.json`), 'utf8')) as { readonly rom: string; readonly sha1: string };
  const romPath = path.join(BENCH_ROOT, dataset.rom);
  const unavailable = files.length === 0 ? `unavailable: no PoC signature file in ${POC_SIGNATURES}` : existsSync(romPath) ? undefined : `unavailable: rom ${romPath}`;
  test(`the matcher places at least the PoC's members: ${name}`, { skip: REQUIRE ? false : (unavailable ?? false) }, (t) => {
    assert.equal(unavailable, undefined, unavailable);
    const bytes = new Uint8Array(readFileSync(romPath));
    const sha1 = sha1Of(bytes);
    assert.equal(sha1, dataset.sha1, `${romPath} is not the dataset's ROM`);
    const rom = romFromBytes(bytes, sha1);
    const analysis = discover(rom);
    const matched = matchSignatures(rom, analysis, files);
    const resolved = resolvePlacements(rom, matched);
    const count = new Map<string, { functions: number; objects: number }>();
    const rules = new Map<string, number>();
    for (const p of resolved.placements) {
      const key = `${p.library}@${p.version}`;
      const have = count.get(key) ?? { functions: 0, objects: 0 };
      count.set(key, p.kind === 'function' ? { ...have, functions: have.functions + 1 } : { ...have, objects: have.objects + 1 });
      rules.set(p.rule, (rules.get(p.rule) ?? 0) + 1);
    }
    for (let i = 1; i < resolved.placements.length; i++) {
      const a = resolved.placements[i - 1];
      const b = resolved.placements[i];
      if (a !== undefined && b !== undefined) assert.ok(a.addr + a.size <= b.addr, `${name}: ${a.member} and ${b.member} overlap`);
    }
    const row = baseline.find((r) => r.name === name);
    assert.ok(row?.signatures !== undefined, `${name}: no PoC signatures row in the baseline`);
    const short: string[] = [];
    for (const v of row.signatures.versions) {
      const key = `${v.library}@${v.version}`;
      const have = count.get(key) ?? { functions: 0, objects: 0 };
      t.diagnostic(`${name} ${key}: ${have.functions} functions (PoC ${v.functions}), ${have.objects} tables (PoC ${v.objects})`);
      if (have.functions < v.functions || have.objects < v.objects) short.push(`${key} ${have.functions}/${v.functions} functions, ${have.objects}/${v.objects} tables`);
    }
    t.diagnostic(`${name} rules: ${[...rules.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([r, n]) => `${r} ${n}`).join(', ')}`);
    t.diagnostic(`${name} regions: ${resolved.regions.map((r) => `${r.library}@${r.version} 0x${r.span.start.toString(16)}-0x${r.span.end.toString(16)}`).join(', ')}`);
    t.diagnostic(`${name} diagnostics: ${resolved.diagnostics.length} (${[...new Set(resolved.diagnostics.map((d) => d.code))].sort().join(', ')})`);
    assert.deepEqual(short, [], `${name}: fewer placements than the PoC`);
  });
}
