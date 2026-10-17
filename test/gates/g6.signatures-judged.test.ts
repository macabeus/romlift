// g6.signatures-judged (architecture §7.2, §8.4 "Signatures", §13, D24): the signatures family, judged on
// every tuning ROM after a seedless discover run, with the PoC's placements as the floor. Per ROM:
//   - per library, at least as many functions and tables (objects) placed as the PoC's row in
//     bench/baseline/poc-2026-10-16.json (`signatures.versions`, summed per library; Klonoa: m4a 94
//     functions and 10 tables, libagbsyscall 6, libgcc 20);
//   - every placement at an ELF FUNC or at a listed untyped address; every table an ELF OBJECT of that size
//     or a label; every proposed `size` equal to the ELF size (the bench applies the 4-byte padding
//     allowance); on a ROM that is one of the specs' references, every name equal to that reference's symbol.
//
// Expected output, for the phase-6 lead to align (architecture §8.5):
//   npm run bench -- signatures --json   exit 0; the last stdout line is
//   {"schema":"romlift/bench-signatures@1","roms":[{"name",
//     "libraries":[{"library","version","functions","objects"}],
//     "placements":{"total","atElfFunc","atUntyped","wrong"},
//     "tables":{"total","objectOfSize","label","wrong"},
//     "sizes":{"proposed","equal","differ"},
//     "names":{"reference":boolean,"total","equal","differ"}}]}
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gate, type ExecResult } from './gate.ts';

interface LibraryCount {
  readonly library: string;
  readonly version: string;
  readonly functions: number;
  readonly objects: number;
}

interface JudgedRom {
  readonly name: string;
  readonly libraries: readonly LibraryCount[];
  readonly placements: { readonly total: number; readonly atElfFunc: number; readonly atUntyped: number; readonly wrong: number };
  readonly tables: { readonly total: number; readonly objectOfSize: number; readonly label: number; readonly wrong: number };
  readonly sizes: { readonly proposed: number; readonly equal: number; readonly differ: number };
  readonly names: { readonly reference: boolean; readonly total: number; readonly equal: number; readonly differ: number };
}

interface BenchSignatures {
  readonly schema: string;
  readonly roms: readonly JudgedRom[];
}

interface BaselineRow {
  readonly name: string;
  readonly signatures?: { readonly versions: readonly LibraryCount[] };
}

/** The floor architecture §13 quotes for Klonoa; the baseline file must agree with it. */
const KLONOA_FLOOR: Readonly<Record<string, { readonly functions: number; readonly objects: number }>> = {
  m4a: { functions: 94, objects: 10 },
  libagbsyscall: { functions: 6, objects: 0 },
  libgcc: { functions: 20, objects: 0 },
};

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

function perLibrary(rows: readonly LibraryCount[]): ReadonlyMap<string, { readonly functions: number; readonly objects: number }> {
  const out = new Map<string, { functions: number; objects: number }>();
  for (const row of rows) {
    const have = out.get(row.library) ?? { functions: 0, objects: 0 };
    out.set(row.library, { functions: have.functions + row.functions, objects: have.objects + row.objects });
  }
  return out;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

gate({
  id: 'g6.signatures-judged',
  phase: 6,
  tier: 'real',
  inputs: ['roms', 'elfs'],
  needs: ['matchSignatures', 'resolvePlacements', 'proposeFromSignatures', 'buildSignatures'],
  async run(cx) {
    const baseline = JSON.parse(await readFile(path.join(cx.repoRoot, 'bench', 'baseline', 'poc-2026-10-16.json'), 'utf8')) as { readonly roms: readonly BaselineRow[] };
    const floors = new Map(baseline.roms.map((r) => [r.name, perLibrary(r.signatures?.versions ?? [])]));
    const klonoa = floors.get('klonoa');
    for (const library of Object.keys(KLONOA_FLOOR).sort(byCodeUnit)) {
      const want = KLONOA_FLOOR[library];
      const have = klonoa?.get(library);
      if (want === undefined || have?.functions !== want.functions || have.objects !== want.objects) throw new Error(`the baseline's klonoa ${library} row is not the architecture's floor ${JSON.stringify(want)}`);
    }

    const run = await cx.npm('bench', ['signatures', '--json']);
    if (run.code !== 0) throw new Error(`bench signatures --json exited ${run.code}:\n${tail(run)}`);
    const result = cx.lastJson<BenchSignatures>(run.stdout);
    if (result.schema !== 'romlift/bench-signatures@1') throw new Error(`bench signatures printed schema '${String(result.schema)}'`);
    const problems: string[] = [];
    for (const dataset of cx.datasets) {
      const rom = result.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not judged`);
        continue;
      }
      const placed = perLibrary(rom.libraries);
      const floor = floors.get(dataset.name);
      if (floor === undefined) problems.push(`${dataset.name}: no PoC signatures row in the baseline`);
      for (const [library, want] of [...(floor ?? new Map())].sort((a, b) => byCodeUnit(a[0], b[0]))) {
        const have = placed.get(library) ?? { functions: 0, objects: 0 };
        if (have.functions < want.functions) problems.push(`${dataset.name}: ${library} ${have.functions} functions < the PoC's ${want.functions}`);
        if (have.objects < want.objects) problems.push(`${dataset.name}: ${library} ${have.objects} tables < the PoC's ${want.objects}`);
      }
      if (rom.placements.wrong > 0 || rom.placements.atElfFunc + rom.placements.atUntyped !== rom.placements.total) problems.push(`${dataset.name}: ${rom.placements.wrong} placements at neither an ELF FUNC nor a listed untyped address`);
      if (rom.tables.wrong > 0 || rom.tables.objectOfSize + rom.tables.label !== rom.tables.total) problems.push(`${dataset.name}: ${rom.tables.wrong} tables are neither an OBJECT of their size nor a label`);
      if (rom.sizes.differ > 0) problems.push(`${dataset.name}: ${rom.sizes.differ} proposed sizes differ from the ELF`);
      if (rom.names.reference && rom.names.differ > 0) problems.push(`${dataset.name}: ${rom.names.differ} names differ from this reference's own symbols`);
      const summary = [...placed].sort((a, b) => byCodeUnit(a[0], b[0])).map(([l, c]) => `${l} ${c.functions}/${c.objects}`).join(', ');
      cx.note(`${dataset.name}: ${summary}; ${rom.placements.total} placements, ${rom.sizes.proposed} sizes${rom.names.reference ? `, ${rom.names.equal} reference names` : ''}`);
    }
    if (problems.length > 0) throw new Error(`signatures judged: ${problems.join('; ')}`);
  },
});
