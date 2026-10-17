# Phase 1: Decoder, as integrated

The record of phase 1 (roadmap "Phase 1", architecture §5, §8, §13), written by the integration
component `p1-integration` on 17 October 2026 against the merged tree of waves 0 and 1 (branch
`phase-1` at `255f9e3`) plus the fixes listed below, and brought up to date when wave 3
(`p1-doctor`, `p1-gates-late`, `p1-integration`) was merged into `phase-1` (merge `78a6af9`). Every number here was measured on the owner's
machine (macOS, Node 24.15.0, Arm GNU Toolchain 15.3.Rel1 binutils 2.45.1) with
`ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. Only the five tuning ROMs were read;
the held-out checkouts were not opened.

**Verdict.** Every phase-1 exit command passes. With `p1-doctor` merged, all twelve `g1.*` gates
pass: `bench gates --require 1` exits 0 on the real tier and on the ci tier. The phase marker
`test/gates/phase.json` is raised to `{ "landed": 1 }`, and `bench/results.json` is regenerated on
the merged tree (commit `78a6af9`, clean tree, source digest `5020f30b…7cce02c`, Node 24).

## What phase 1 delivered

| Part | Where | What |
| --- | --- | --- |
| Instruction set | `src/foundation/isa/**`, `romlift/isa` | one table per mode driving `decode`, `encode`, `format`, `parse`, `assemble`, `roundTrips` and `rawReason` (D14); Thumb through a 65,536-entry index, ARM through buckets; `specOf` |
| Assembler dialect | `src/foundation/asm/dialect.ts` | `DIALECT.preamble(mode)` and `macros.inc`, the one text every corpus file and later every writer opens with (D49) |
| Round-trip corpus | `src/foundation/isa/corpus*.ts`, `test/corpus/generate.ts` | the pure case generator and comparator (D54 c) and the driver behind `npm run corpus` |
| ROM, formats, utilities | `src/foundation/{rom,formats,util}/**`, `src/shell/{hash,fs}.ts` | `romFromBytes`, header, memory map, `parseElf`, `parseGnuMap`, `canonicalJson`, `hex`, `sortedKeys`/`sortedEntries`, the seeded PRNG; `sha1Of`, `sha256Stream`, `listDir`, `atomicWrite` |
| Binutils runner | `src/shell/toolchain/binutils.ts` | `assembleWithBinutils`, `findBinutils`, `binutilsVersions` |
| CLI framework | `src/cli/**` | frozen `CommandSpec`/`ExitCode`/`CliIo` types, the parser, `main`, text and NDJSON reporters |
| Doctor | `src/shell/toolchain/doctor.ts`, `src/cli/commands/doctor.ts` | `romlift doctor [--json] [--full]`: binutils versions, the corpus re-assembled with the user's `as` (259,462 cases by default, 1,242,502 with `--full`), the `R_ARM_THM_JUMP11` probe through `linkWithBinutils`, and agbcc/old_agbcc reported either way; `runDoctor` in `romlift/node` |
| Vocabularies | `src/core/provenance/vocabulary.ts` | `MISS_REASONS`, `ORIGINS` |
| Bench harness | `bench/src/**`, `bench/tools/**` | datasets, rescoring of the PoC's `scored.json`, `run`, `poc-check`, `dataset-check`, `doctor-real`, `provenance`, `stale-check`, `gates`, `regression`, `report`, `web`; export-poc (`--mode scored`) pinned by `bench/baseline/poc-source.json` (D50) |
| Gates | `test/gates/gate.ts`, `g1.*`–`g6.*`, `test/gates-index.test.ts` | executable gates with five verdicts (D29), one file per §13 id; `test/gates-index.test.ts` keeps the gate set, tiers and annotations equal to §13 |
| Checkers | `test/architecture.test.ts`, `test/helpers/architecture.ts`, `test/mutation/phase1/**` | the architecture checker (`npm run lint`) and the mutation tests of the four phase-1 checkers |

## Deviations (D54, plus integration)

Phase 1 ran as nine components in three waves (roadmap, "As executed"); D54 records why. The
deviations from roadmap 1.0–1.D, in short: (a) 1.B moved into wave 0 as `p1-foundation`; (b)
`foundation/isa/types.ts` belongs to `p1-isa`; (c) the binutils runner and the corpus belong to
the ISA component, with the corpus core in `src`; (d) `doctor` moved to wave 2; (e) two gate
components, `p1-gates-early` (g1–g3) and `p1-gates-late` (g4–g6); (f) new files `src/api/files.ts`,
`src/foundation/util/prng.ts`, `test/helpers/architecture.ts`; (g) the CLI types were frozen in
wave 0; (h) `GateSpec.tier` accepts `'both'`; (i) the real tier runs before the ci tier; (j)
`npm run lint` is the architecture checker alone.

Found during integration:

- **Branch name.** Git cannot hold both a branch `phase-1` and a branch `phase-1/p1-integration`
  (a ref cannot be a file and a directory), so this component's branch is `phase-1-p1-integration`,
  the spelling the earlier components used (`phase-1-p1-isa`, `phase-1-p1-bench`, ...).
- **Mutation-suite command.** `node --conditions=source --test test/mutation/phase1/` fails on
  Node 24.15 with `MODULE_NOT_FOUND`: the test runner treats a directory argument as a module to run.
  The working spelling is a glob, `node --conditions=source --test 'test/mutation/phase1/*.test.ts'`
  (what `npm test` already does); `npm run lint` runs the architecture mutation file. The same holds
  for the gates: `node --test test/gates/` fails, `'test/gates/*.test.ts'` loads all 68 gate files.

## Fixes made during integration

1. **The printer family never reached `results.json`** (`8df5e73`). The corpus driver and the bench
   computed the summary's `inputsDigest` by two different formulas (the driver hashed
   `path\0bytes\0` plus the `as` line and the options; the bench hashed `path\0bytes` plus a
   pseudo-file `as --version` and `node\00`), so `bench run` judged every summary stale and left out
   the `printer` member. With `landed: 1` the provenance check fails on exactly that ("the printer
   family is absent from the artifact"). `bench/src/printer.ts` now holds the one definition
   (`corpusInputsDigest(repoRoot, asVersion, options)`, over `src/foundation/isa`,
   `src/foundation/asm` and `test/corpus`), the driver imports it, and
   `test/unit/bench/printer.test.ts` pins what it covers. No frozen contract changed: the summary is
   still `romlift/corpus-summary@1` and only its digest value moved.
2. **The phase marker** (`340acda`): `test/gates/phase.json` raised to 1 before the final real-tier
   run, because it is part of the source digest.

Nothing else needed a change: the ISA tables, the corpus, the gate bodies and the baselines are as
the waves merged them.

## Exit commands

Run in `/Users/macabeus/ApenasMeu/decompiler/romlift-wt/phase-1-p1-integration`, in this order.

| Command | Exit | Key output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | |
| `npm test` | 0 | 297 tests, 297 pass (295 before the printer test was added) |
| `npm run corpus` | 0 | 100.00% on thumb, bl and arm; 0 disagree anywhere; 6.9 s |
| `npm run bench -- doctor-real` | 0 | 5 ROMs, 5 ELFs, 5 maps, PoC checkout and toolchain ok |
| `npm run export-poc -- --mode scored` | 0 | all five dumped, scaffold OK, deterministic; 3 min 41 s wall |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | decoder differential: 143,360 encodings compared, 1 test pass |
| `npm run bench -- run` | 0 | 5 rows (table below) |
| `npm run bench -- poc-check` | 0 | 5 × "rows equal, PoC row equal, scaffold OK, deterministic, PoC source pinned" |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- run` (after `landed: 1`) | 0 | artifact at `340acda`, clean tree |
| `npm run bench -- gates --require 1 --tier real` | 0 | `g1.bench-harness` pass, `g1.dataset-elf` pass; 20 real-tier records written |
| `npm run bench -- gates --require 1 --tier ci` | 1 | 10 of 11 ci `g1.*` gates pass; `g1.doctor` pending (`runDoctor`) |
| `npm run bench -- provenance` | 0 | all five checks ok |
| `npm run bench -- stale-check` | 0 | |
| `node --conditions=source --test 'test/mutation/phase1/*.test.ts'` | 0 | 32 tests pass |
| `npm run lint` | 0 | |

`doctor-real` was run again after export-poc and the PoC checkout still matched
`bench/baseline/poc-source.json` (digest `86776e78…c79345`), so export-poc left it untouched.

## The PoC rescored, per tuning ROM

`bench run` rescores the PoC's fresh `scored.json` dumps. Precision and recall are raw (startup
region excluded, as the PoC counts); extents are agreeing / sized functions; the code end is found
minus ELF; `make` is the PoC's scaffold rebuilt to the ROM's SHA-1; determinism is two PoC runs with
one digest.

| ROM | ELF functions | Found | True positives | Precision | Recall | Misses | False entries | Extents | Code end | `make` | Deterministic |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |
| klonoa | 559 | 557 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 | +4 | SHA-1 OK | yes |
| sa2 | 2,892 | 2,898 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,886 / 2,889 | 0 | SHA-1 OK | yes |
| sa3 | 4,693 | 4,699 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,304 / 4,307 | 0 | SHA-1 OK | yes |
| fe7j | 7,735 | 7,735 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 | +8 | SHA-1 OK | yes |
| pokeemerald | 15,856 | 15,862 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,849 / 15,853 | 0 | SHA-1 OK | yes |

Every miss and every false entry is listed in its dataset (0 unlisted on every ROM):

- klonoa: misses 3 × `mixer-internal`; false entry `0x0804F73E` (`unreviewed`, the second entry of
  the m4a helper, classified in phase 2 M5).
- fe7j: misses 6 × `continuation-after-noreturn-call`, 1 × `loop-label`, 4 × `mixer-internal`;
  false entries 6 × `veneer`, 5 × `unreviewed` (M5).
- sa2, sa3, pokeemerald: false entries 3 × `mixer-internal` (ARM gap scan) and 3 ×
  `local-subroutine` each. Extent mismatches: `umul3232H32` and `ld_r3_tp_adr_i` on all three, plus
  `MultiSioIntr` (sa2, sa3) and `GameCubeMultiBoot_Main`, `GameCubeMultiBoot_Quit` (pokeemerald).

**Against the baseline.** The five rows equal `bench/baseline/poc-2026-10-16.json` row for row on
every scored field; the comparison leaves out only `seconds`, `signatures` (judged in phase 6),
`scaffold.summary` and `datasetProblems` (`bench/src/poc-check.ts`). The PoC's own fresh row (its
`pocRow`) also equals the baseline row on every field but `seconds` and `signatures`. Nothing
differed, so the baseline file was not replaced.

## The corpus

`npm run corpus` with `GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126`,
seed 539365399 (`0x20261017`), ARM sample 1,048,576 words, `bl` sample 65,536 pairs. Summary
`romlift/corpus-summary@1`, inputs digest `f709d82b…4f3155d`.

| Section | Cases | Mnemonic | Raw | Agree with `as` | Disagree |
| --- | ---: | ---: | ---: | ---: | ---: |
| thumb | 75,332 | 64,730 | 10,602 | 75,332 (100.00%) | 0 |
| bl | 77,828 | 77,828 | 0 | 77,828 (100.00%) | 0 |
| arm | 1,089,342 | 579,700 | 509,642 | 1,089,342 (100.00%) | 0 |

Raw count per `RawReason`:

| Section | undefined | unpredictable | sbz-set | as-alias | no-roundtrip |
| --- | ---: | ---: | ---: | ---: | ---: |
| thumb | 9,216 | 1,138 | 112 | 136 | 0 |
| bl | 0 | 0 | 0 | 0 | 0 |
| arm | 275,530 | 157,967 | 75,720 | 267 | 158 |

- **Encoder agrees:** `assemble` equals `as` on all 722,336 printed texts, 0 disagree.
- **Context:** 221,898 address-dependent cases at 0-mod-4 and 2-mod-4 and 156 offset extremes
  (including one step past each end, which `as` must reject), 0 disagree.
- **ARM coverage classes:** 150 rows (133 reachable by `decode`; `arm.nv` and `arm.undefined` are
  fieldless raw-only rows), 776 field classes swept exhaustively, 90 covered only by sampling: the
  rotated `imm12` of the data-processing immediates, the shift amount `samt` of the register forms,
  the 12-bit `imm` offsets of single transfers, the register `list` of `ldm`/`stm`, the 24-bit `off`
  of `b`/`bl`, and `swi`'s comment field. The per-row list is in `bench/results.json` under
  `printer.sections.arm.coverage`.
- **The 158 ARM `no-roundtrip` cases** were checked one by one against `as`: 110 `adr_sub` and 22
  `adr_add` whose target wraps the 32-bit address space (`as`: "invalid constant … after fixup") or
  that `as` would encode in the other direction, 24 `str pc, [pc, #imm]` with an offset that is not a
  multiple of 4 (`as`: "must be 4-byte aligned"), and 2 `add pc, pc, #imm` that `as` refuses or
  encodes as `sub`. In each case the mnemonic would not give the original bytes back, so the raw
  fallback is the right print and `no-roundtrip` its true reason.

## `doctor-real` and `dataset-check`

`bench doctor-real` (exit 0): the ROM SHA-1, ELF sha256 and map of each tuning dataset match
(klonoa `a0a298d9…`, sa2 `7bcd6a07…`, sa3 `685af3a2…`, fe7j `037702b1…`, pokeemerald `f3ae0881…`), the
PoC checkout matches `poc-source.json`, and `as`, `ld` and `objcopy` report binutils 2.45.1.

`bench dataset-check` (exit 0): every `labels` row of the five datasets is an ELF `FUNC` inside a
function the run found, every `untyped` row is not a `FUNC`, and no row is stale.

## Mutation tests (`g1.checks-fail`)

`test/mutation/phase1/` holds 32 tests over the four phase-1 checkers, and all pass:

| File | Tests | Fault injected |
| --- | ---: | --- |
| `architecture.test.ts` | 20 | a clean mini-repository, then 19 faults (illegal import edges, a rule file importing the profile or another rule, banned globals and members, a bare `.sort()`, Map/Set iteration, `readdir` outside `shell/fs.ts`, barrel shape, a non-literal dynamic import, bench importing `src`), each exactly one violation of its rule |
| `corpus.test.ts` | 1 | one flipped byte in an assembled `thumb-000.s` (real `as`) fails exactly that case and the summary |
| `dataset.test.ts` | 6 | the clean synthetic dataset, then not-a-func, is-a-func, malformed-address, unknown-category and stale-exception, each exit 1 |
| `provenance.test.ts` | 5 | a fresh artifact passes, then a stale source digest ("re-run the real tier"), a held-out row, a missing family and `landed: 1` without a gate record, each exit 1 |

Each test was shown to depend on its fault: with every injected fault neutralised in a temporary
copy of the four files (the architecture faults dropped, the byte XORed with 0, the dataset
overrides and dump replaced by the clean ones, the four provenance edits removed), all 29 fault
tests failed and only the three clean-baseline tests passed; the copies were then deleted.

## Gate verdicts

`bench gates --require 1`, both tiers, on the final tree (`--tier real` first, D54 i):

| Gate | Tier | Verdict | Detail |
| --- | --- | --- | --- |
| `g1.architecture` | ci | pass | checker 1 pass 0 fail; `tsc --noEmit` 0 errors |
| `g1.runtime-deps` | ci | pass | `@match-kit/decomp-yaml`, `smol-toml`, `zod`; 5 production packages, no install script, `.node` or `binding.gyp` |
| `g1.thumb-roundtrip` | ci | pass | 75,332 cases, 0 disagree |
| `g1.bl-sample` | ci | pass | 77,828 cases, 0 disagree |
| `g1.arm-sample` | ci | pass | 1,089,342 cases, 0 disagree; coverage classes recorded |
| `g1.encoder-agrees` | ci | pass | 722,336 texts |
| `g1.context-corpus` | ci | pass | 221,898 forms, 156 extremes |
| `g1.doctor` | ci | pass | binutils 2.45.1 ok; corpus 259,462 cases, 0 disagree; thumb-jump11 `0xE3FF` as expected; agbcc and old_agbcc reported `missing` (not on the PATH nor under `tools/agbcc`), which the gate allows |
| `g1.provenance` | ci | pass | source digest `5020f30b…7cce02c` (Node 24); 2 real gates of phase ≤ 1 pass; families scaffold, printer; 5 rows; no sealed rows |
| `g1.checks-fail` | ci | pass | 4 mutation files, 32 tests |
| `g1.bench-harness` | real | pass | 5 ROMs: rows equal the baseline, PoC rows equal, scaffold SHA-1 OK, deterministic, PoC pinned |
| `g1.dataset-elf` | real | pass | 5 datasets agree with their ELFs |

Every `g2.*`–`g6.*` gate reports `pending` (their exports arrive in phases 2 to 6) or skips by tier;
they do not count toward `--require 1`. The real tier wrote 33 gate records into `results.json`.
Both tiers exit 0.

## Open items

- **Wave 3 re-run.** Merging `p1-doctor` added files under `src/` and moved the source digest
  (`627c26ae…` to `5020f30b…`), so `g1.provenance` failed until the real tier was re-run. On the
  merged tree the integrator re-ran `npm run corpus`, `bench doctor-real`, `export-poc --mode scored`,
  `test:local`, `bench run`, `poc-check`, `dataset-check`, then `gates --require 1 --tier real` and
  `--tier ci`, `provenance` and `stale-check`, all exit 0, with the same five rows as above, and
  committed the refreshed `results.json`.
- **`printer.yml`** must run on apt and Homebrew binutils in CI once the phase branch is pushed; it
  cannot run locally, so the "two binutils versions" threshold is not yet measured (only Homebrew's
  Arm GNU Toolchain 2.45.1 here).
- **Node 22.18.** `@match-kit/decomp-yaml` declares `node >=24`, so `npm ci` on Node 22.18 prints an
  `EBADENGINE` warning (a warning only; `engine-strict` stays off). The source digest includes the
  Node major, so the committed artifact (Node 24) is checked by a Node 24 provenance job.
- **README.md** still says phase 1 is in progress; it is outside this component's files and is
  updated with the merge to `main`.
- The owner decisions of architecture §12 are taken at their documented defaults; none applies to
  phase 1 (held-out runs and D53 start in phase 2; `romlift/isa` stays a subpath export).
