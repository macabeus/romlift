// g6.objdiff (architecture §8.4 "objdiff", §13, D34, D68 a, D92): moved from phase 3 (it was g3.objdiff) to phase 5,
// where the `expected/` objects and objdiff targets are built, by the owner's answer to Q1 of phase-3.md ("Move gate to
// phase 5"), then into phase 6 with those writers when the owner skipped phase 5 ("Keep rename and objdiff", D92); it
// applies as D34 writes it unless the owner amends it. Its baseline is phase-3.md Q1's table, the differences the
// committed classifier (bench/src/objdiff-classes.ts, bench/tools/objdiff-classes.ts) counted that D34 gates: fe7j
// 200, klonoa 320, pokeemerald 13,788, sa2 1,374, sa3 564, tmc 895. The body below is unchanged. On every tuning ROM whose readable build links, every
// function whose entry and extent agree with the ELF scores 0 under objdiff-cli (the pinned
// bench/tools/objdiff.version): 100% match and no relocation difference. The reference side is the
// project's own object (`objectsDir`); the base is the emitted function `.s`, assembled, with labels renamed
// to the ELF's names. A relocation whose reference targets a section symbol is `unnamed-target`: reported,
// not gated. Every other difference fails. The share metrics and the scoring run on all six tuning ROMs
// (D62); objdiff-cli is located by ROMLIFT_OBJDIFF, then the repository's bench/.local/objdiff-target build
// (then the main checkout's, from a worktree), then PATH, then $ROMLIFT_BENCH_ROOT/objdiff/target/release/
// objdiff-cli (D65 j).
//
// The command (architecture §8.5; aligned to the frozen API by the phase-3 lead, D62):
//   npm run bench -- run --scaffold --json   exit 0; the last stdout line is romlift/bench-run@1; --json
//   writes no committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     objdiff: {linked: boolean,              the readable build reproduced the SHA-1
//               scored: number,               functions compared (agreeing entry and extent)
//               differences: {<kind>: count}, e.g. 'unnamed-target', 'instruction', 'relocation', 'missing-symbol'
//               examples: [{function, kind, detail}]}
import { type ExecResult, byCodeUnit, gate } from './gate.ts';

interface Objdiff {
  readonly linked: boolean;
  readonly scored: number;
  readonly differences: Readonly<Record<string, number>>;
  readonly examples: readonly { readonly function: string; readonly kind: string; readonly detail: string }[];
}

interface BenchRunRom {
  readonly name: string;
  readonly objdiff: Objdiff;
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

const REPORTED_ONLY = 'unnamed-target';


function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

gate({
  id: 'g6.objdiff',
  phase: 6,
  tier: 'real',
  inputs: ['roms', 'elfs', 'objects', 'toolchain'],
  needs: ['buildModel', 'emitTree', 'linkCheck'],
  async run(cx) {
    const run = await cx.npm('bench', ['run', '--scaffold', '--json']);
    if (run.code !== 0) throw new Error(`bench run --scaffold --json exited ${run.code}:\n${tail(run)}`);
    const result = cx.lastJson<BenchRun>(run.stdout);
    if (result.schema !== 'romlift/bench-run@1') throw new Error(`bench run printed schema '${String(result.schema)}'`);
    const problems: string[] = [];
    const notes: string[] = [];
    let judged = 0;
    for (const dataset of cx.datasets) {
      const rom = result.roms.find((r) => r.name === dataset.name);
      if (rom === undefined) {
        problems.push(`${dataset.name}: not scored`);
        continue;
      }
      if (!rom.objdiff.linked) {
        notes.push(`${rom.name} not judged (readable build does not link)`);
        continue;
      }
      judged++;
      const kinds = Object.keys(rom.objdiff.differences).sort(byCodeUnit);
      const gated = kinds.filter((k) => k !== REPORTED_ONLY && (rom.objdiff.differences[k] ?? 0) > 0);
      if (rom.objdiff.scored <= 0) problems.push(`${rom.name}: no function scored`);
      if (gated.length > 0) {
        const examples = rom.objdiff.examples.filter((e) => e.kind !== REPORTED_ONLY).slice(0, 5).map((e) => `${e.function} ${e.kind} ${e.detail}`);
        problems.push(`${rom.name}: ${gated.map((k) => `${rom.objdiff.differences[k] ?? 0} ${k}`).join(', ')}; ${examples.join(' | ')}`);
      }
      notes.push(`${rom.name} ${rom.objdiff.scored} functions, ${rom.objdiff.differences[REPORTED_ONLY] ?? 0} unnamed-target`);
    }
    if (judged === 0) problems.push('no tuning ROM has a readable build that links');
    if (problems.length > 0) throw new Error(`objdiff: ${problems.join('; ')}`);
    cx.note(notes.join('; '));
  },
});
