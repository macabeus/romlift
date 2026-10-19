# bench

The benchmark and regression harness (architecture §8). Development only: it is not published and
imports romlift only through `romlift`, `romlift/node`, `romlift/isa` and `romlift/internal` (D37).

It scores a seedless discover run of every dataset against the `FUNC` symbols of an ELF that rebuilds
the ROM, judges signatures afterwards, and runs the gates. ROMs, ELFs and maps are read from
`ROMLIFT_BENCH_ROOT` and are never committed; what is committed is `dataset/` (authored exception lists,
SHA-1s and ELF digests), `baseline/` and `results.json`, which only a phase lead regenerates (D43).
Held-out datasets run sealed: counts and verdicts only (D25, D53).

Run it with `npm run bench -- <command>` (the commands are listed in AGENTS.md and architecture §8.5).
The harness landed in phase 1 (component 1.D) and rescored the proof of concept's dumps; from phase 2
`bench run` scores romlift's own discover run, with a `parity` digest per row against the PoC's
(`baseline/poc-digests.json`), and runs the sealed datasets for counts only. `baseline/` holds the PoC's
rows (`poc-2026-10-16.json`), the improvements accepted against them (`accepted-diffs.json`, each with
its commit), the parity digests, the pinned PoC source and the speed baseline (`speed.json`, written by
`bench speed --write-baseline`); `results.json` keeps the PoC-parity evidence of milestone M1 (the
`parity` member: digests, row diffs and the lockstep of every rule family, recorded before the PoC's LIFO
worklist was deleted). docs/phase-2.md records the numbers.

## Phase 3: the emission families

Every `bench run` also builds the model of each tuning ROM's discover run (`configFromDiscover`,
`buildModel`) and measures the readability family (`src/readability.ts`): the readable printer's shares over
the `PrintStats` of every code chunk (`mnemonicShare` = 1 - raw instructions / instructions,
`symbolicBranchShare`, `symbolicPoolShare`, each 1 over an empty denominator), each row's `readability`
member with its `floor` from `baseline/readability.json` (`null` when the ROM has none, which fails
`g3.readability`), and the row's `treeDigest` (sha256 over path, NUL, text, NUL of the readable stream, as
`g3.tree-determinism` computes it). Sealed datasets get no emission family.

| Command | Does |
| --- | --- |
| `run --scaffold [--json]` | also builds each printer's tree in a temporary directory as a fresh project (`planWrites` without a manifest, `applyWrites`) and links it (`linkCheck`): the raw link is the row's `scaffold: {ok}` (it replaces the PoC dump's verdict from phase 3 on), the readable link is `objdiff.linked`; then the objdiff family (`src/objdiff.ts`, D34) on every function whose entry and extent agree with the ELF, against the dataset's `objectsDir` (its digest checked and recorded in `meta.inputs`) with objdiff-cli at the pinned `tools/objdiff.version` (found by `ROMLIFT_OBJDIFF`, the repository's or the main checkout's `bench/.local/objdiff-target`, the `PATH`, then `$ROMLIFT_BENCH_ROOT/objdiff`); each row gets `objdiff: {linked, scored, differences: {kind: count}, examples}` |
| `run --scaffold --write-readability-floor` | the phase lead, once: adds the measured shares of every tuning ROM without a floor to `baseline/readability.json` (schema `romlift-bench/readability-floor@1`); an existing floor is never changed |
| `large-rom [--json] [--rom <path>]` | runs `src/large-rom.ts` (the memory family, `g3.large-rom`) with the same arguments and relays its output and exit code; each child runs under the `romlift` bin's heap cap, `--max-old-space-size=256` (D68 b); `--rom` measures that ROM instead of the 32 MiB synthetic one (how the tuning ROMs are recorded) |

The objdiff base of a function is its function writer's text under the dialect preamble, from the model of
the discover config with the reference ELF's names put in by address (FUNC names on the listed functions,
OBJECT and untyped symbols outside every function as data symbols), assembled alone with
`assembleWithBinutils`; the functions of one reference object are joined with `ld -r` (which keeps every
relocation) so objdiff-cli reads each reference object once. Only the objects the dataset's map links
define names, so a stale copy in a build directory makes no name ambiguous.
A difference has a kind: `instruction`, `resolved-call` (a `bl` the reference's assembler resolved to a
function of its own object at the offset the base relocates against: the same call, counted apart),
`relocation` (targets differ, or only the base relocates),
`missing-relocation` (the reference names a symbol where the base holds a plain value), `missing-symbol`,
`score`, `assemble`, `tool`, and `unnamed-target` (the reference targets a section symbol), which alone is
reported and not gated.

A lead run (without `--json`) also runs `src/large-rom.ts --json` as a child and writes its ROM SHA-1 and
each command's exit code and peak RSS into the artifact's `memory` member (the global memory family); its
times, and each ROM's readability, link and objdiff times, go to `timings.json`. `meta.families` records
`readability` for every tuning ROM and `scaffold` only from romlift's own raw link; `meta.toolchain.objdiff`
is the objdiff-cli version of a `--scaffold` run. `bench regression` fails on a readability share lower than
the base artifact's (a base without the family is not compared).
