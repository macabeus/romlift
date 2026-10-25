// g6.objdiff (architecture §8.4 "objdiff", §13, D34, D68 a, D92, D102): moved from phase 3 (it was g3.objdiff) to phase
// 5, where the `expected/` objects and objdiff targets are built, by the owner's answer to Q1 of phase-3.md ("Move gate to
// phase 5"), then into phase 6 with those writers when the owner skipped phase 5 ("Keep rename and objdiff", D92). The
// owner amended D34 on 25 October 2026 (phase-6.md Q6 and Q15, "Printer spells sym+addend, then ceiling", D102), and
// authorised this edit of the gate:
//   - the base is romlift's own spelling: the emitted function .s, assembled, with labels renamed to the reference
//     ELF's names by address and no word rewritten (the printer spells a word inside a named, sized entry
//     `sym + addend`, core/emit/print/pool.ts);
//   - phase-3.md Q1 option (b): the differences whose two sides are checked to link to the same word (the classes
//     resolved-call, static-callee, value-named, alias, symbol-addend, value-for-symbol of
//     bench/src/objdiff-classes.ts) are reported, not gated;
//   - phase-6.md Q6 option (c): a function objdiff-cli refuses to read (`tool`), like one no reference object defines
//     (`missing-symbol`), is counted uncompared and reported, not gated; `unnamed-target` stays reported;
//   - the rest (unverified, trailing-pad, relocation-other, instruction-other, assemble, score) is gated on a ceiling:
//     per tuning ROM, the gated count measured on the final product of the step that applied the answer, committed in
//     bench/baseline/objdiff-ceiling.json, which this gate reads. A count above its ceiling fails; a ROM without a
//     ceiling fails. The ceiling may be lowered (bench/tools/objdiff-classes.ts --write-ceiling lowers only), never
//     raised without the owner.
// On every tuning ROM whose readable build links, every function whose entry and extent agree with the ELF is compared
// by objdiff-cli (the pinned bench/tools/objdiff.version) with the project's own reference object (`objectsDir`, the
// map's object or archive member at its entry). objdiff-cli is located by ROMLIFT_OBJDIFF, then the repository's
// bench/.local/objdiff-target build (then the main checkout's, from a worktree), then PATH, then
// $ROMLIFT_BENCH_ROOT/objdiff/target/release/objdiff-cli (D65 j).
//
// The command (architecture §8.5; aligned to the frozen API by the phase-3 lead, D62):
//   npm run bench -- run --scaffold --json   exit 0; the last stdout line is romlift/bench-run@1; --json writes no
//   committed file. Per tuning ROM in `roms[]` this gate reads
//     name
//     objdiff: {linked: boolean,              the readable build reproduced the SHA-1
//               scored: number,               functions compared (agreeing entry and extent)
//               classes: {counts: {<class>: count}, gated: number, uncompared: number,
//                         gatedExamples: [{function, kind (the class), detail}]}}
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { type ExecResult, gate } from './gate.ts';

interface ObjdiffExample {
  readonly function: string;
  readonly kind: string;
  readonly detail: string;
}

interface Objdiff {
  readonly linked: boolean;
  readonly scored: number;
  readonly classes?: {
    readonly counts: Readonly<Record<string, number>>;
    readonly gated: number;
    readonly uncompared: number;
    readonly gatedExamples: readonly ObjdiffExample[];
  };
}

interface BenchRunRom {
  readonly name: string;
  readonly objdiff: Objdiff;
}

interface BenchRun {
  readonly schema: string;
  readonly roms: readonly BenchRunRom[];
}

const CEILING_FILE = join('bench', 'baseline', 'objdiff-ceiling.json');
const CEILING_SCHEMA = 'romlift-bench/objdiff-ceiling@1';

function tail(run: ExecResult, lines = 30): string {
  return `${run.stdout}${run.stderr}`.trimEnd().split('\n').slice(-lines).join('\n');
}

/** The committed ceilings: per tuning ROM a non-negative integer. */
async function readCeilings(repoRoot: string): Promise<ReadonlyMap<string, number>> {
  const value = JSON.parse(await readFile(join(repoRoot, CEILING_FILE), 'utf8')) as { readonly schema?: unknown; readonly roms?: unknown };
  if (value.schema !== CEILING_SCHEMA || typeof value.roms !== 'object' || value.roms === null) throw new Error(`${CEILING_FILE}: not a ${CEILING_SCHEMA} file`);
  const out = new Map<string, number>();
  for (const [name, n] of Object.entries(value.roms)) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`${CEILING_FILE}: roms.${name} is not a non-negative integer`);
    out.set(name, n);
  }
  return out;
}

gate({
  id: 'g6.objdiff',
  phase: 6,
  tier: 'real',
  inputs: ['roms', 'elfs', 'objects', 'toolchain'],
  needs: ['buildModel', 'emitTree', 'linkCheck'],
  async run(cx) {
    const ceilings = await readCeilings(cx.repoRoot);
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
      const classes = rom.objdiff.classes;
      const ceiling = ceilings.get(rom.name);
      if (rom.objdiff.scored <= 0) problems.push(`${rom.name}: no function scored`);
      if (classes === undefined) {
        problems.push(`${rom.name}: bench run printed no classes`);
        continue;
      }
      if (ceiling === undefined) {
        problems.push(`${rom.name}: no ceiling in ${CEILING_FILE}`);
        continue;
      }
      const counts = Object.entries(classes.counts).map(([c, n]) => `${n} ${c}`).join(', ');
      if (classes.gated > ceiling) {
        const examples = classes.gatedExamples.slice(0, 5).map((e) => `${e.function} ${e.kind} ${e.detail}`).join(' | ');
        problems.push(`${rom.name}: ${classes.gated} gated differences above its ceiling ${ceiling} (classes: ${counts}); ${examples}`);
      }
      notes.push(`${rom.name} ${rom.objdiff.scored} functions, gated ${classes.gated} of ceiling ${ceiling}, ${classes.uncompared} uncompared (classes: ${counts || 'none'})`);
    }
    if (judged === 0) problems.push('no tuning ROM has a readable build that links');
    if (problems.length > 0) throw new Error(`objdiff: ${problems.join('; ')}`);
    cx.note(notes.join('; '));
  },
});
