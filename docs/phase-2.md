# Phase 2: Analysis

The record of phase 2 (roadmap "Phase 2", architecture §4, §8.3, §8.4, D10, D13, D26, D41, D53). It
was written by the milestone component `p2-milestones` (wave 3) on 17 October 2026, on its branch
`phase-2-p2-milestones`, cut from `phase-2` at `e867dae` after waves 1 and 2 had merged. Every number
here was measured on the owner's machine (macOS, Node 24.15.0, binutils 2.45.1 from Arm's GNU Toolchain
15.3.Rel1) with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`, while the other wave-3 components ran
on the same machine. Rules were tuned on the five tuning ROMs only; the held-out ROMs ran sealed, and
only their counts and verdicts were read (D25). The integrator then fixed the two ci-tier gates that
still failed after wave 3 (`g2.rule-coverage`, `g1.provenance`) on `phase-2` (`6a74f3d`, `b2742a3`)
and re-ran the whole closing list there. The adversarial review of `4a24486` was answered by fix
round 1 (`8676557` to `6260b95`, D59; "Review", below), which re-ran the whole closing list at
`6260b95`. The re-review of `825f662` was answered by fix round 2 (`5306f1f` to `bb91cbe`, D59 (j) to
(p)), which re-ran the whole closing list at `bb91cbe` ("The closing gate", below).

**Verdict (after fix round 2).** Phase 2 still does **not** land, for the same single reason: every
command of the closing list exits 0 except `bench gates --require 2 --tier real`, whose only failing
gate is `g2.held-out` (tmc: recall 99.37%, 51 glued, code end -4,130). The round fixed every major
finding (the confirm-mode fixpoint spin, the remaining inline predicate of `grow`, the lost gate notes,
the analysis memory that grew with the number of candidates) and every minor but one, which is rejected
with its reason; the failing gate's record now carries the per-ROM counts. Nothing was tuned on a
held-out ROM; `test/gates/phase.json` stays `{ "landed": 1 }`, nothing is merged or pushed.

**Verdict (after fix round 1).** Phase 2 still does **not** land, for the same single reason: every
command of the closing list exits 0 except `bench gates --require 2 --tier real`, whose only failing
gate is `g2.held-out` (tmc). The round fixed every major finding and the minors it did not reject, and
measured where tmc's 51 glued misses lie: 3 inside a found extent, 14 in gaps, 34 past the code end.

**Verdict (wave 3).** Phase 2 does **not** land. Every gate command passes except `bench gates --require 2 --tier
real`, whose only failing gate is `g2.held-out`. Milestones M1 to M6 hold on the five tuning ROMs, every
tuning threshold of the roadmap holds, all seventeen `g2.*` gates but `g2.held-out` pass, and the five
rule changes after M1 each passed `bench regression` against the commit before them. M7 fails: `g2.held-out` needs two passing sealed ROMs from two codebase
families, one of them absent from the tuning set; pokefirered and pokeruby pass but are both
`pret-gen3`, a family of the tuning set (pokeemerald), and tmc (`zeldaret-tmc`, the only sealed ROM of
a family absent from the tuning set) fails with 51 `glued` misses, raw recall 99.37% and its code end
4,130 bytes before the ELF's. The owner decision this hits (architecture §12, item 4) was not waited on;
its safe default (D53) is that phase 2 does not land with `g2.held-out` failing, so the closing
sequence was prepared but not run, and `test/gates/phase.json` stays `{ "landed": 1 }`. tmc was not
revealed and nothing was tuned on it; fixing it needs a rule justified by its `restsOn` and validated on
the tuning set alone, and then a fresh sealed pair before any claim of generality (D53).

## What phase 2 delivered

### Components

Phase 2 ran as thirteen components in three waves on `phase-2` (the roadmap's "As executed" table, D56),
then the integrator.

| Wave | Component | Delivered |
| --- | --- | --- |
| 1 | `p2-driver` (ran as `p2-engine`, D59) | the frozen analysis types and rule contracts, the `agbcc` profile, provenance, the driver (`run`, `grow`, `fill-gaps`, `accept`, `settle`, `validity`, `epoch`, `worklist`, `confirm`, `view`, `diagnose`), `reading.ts`, the oracle protocol (deleted in fix round 1) and the walk skeleton |
| 1 | `p2-poc-export` | `export-poc --mode parity|queries`, the parity view and the lockstep log (`romlift-bench/poc-queries@1`), `bench/baseline/poc-digests.json` |
| 1 | `p2-fixtures` | the 26 synthetic fixtures (20 positive, 6 negative), their build and the rebuild check |
| 1 | `p2-heldout` | the sealed held-out datasets of pokefirered, pokeruby and tmc, the seal tool and the sealed classifiers |
| 2 | `p2-rules-walk-bl-claim` | the walk, `bl` and claim rules |
| 2 | `p2-rules-seed-valid-accept` | the seed, validity and acceptance rules |
| 2 | `p2-rules-gap-region` | the gap and region rules |
| 2 | `p2-lockstep` | `bench/src/{parity,lockstep}.ts` (`lockstep.ts` deleted in fix round 1), the codec `romlift/analysis@1` |
| 2 | `p2-bench` | romlift's own scored discover run in `bench run`, `bench speed`, `ablate`, `explain`, `adopt` |
| 3 | `p2-commands` | the discover and explain workflows, the `analyze` and `explain` commands, the explain goldens |
| 3 | `p2-fixture-coverage` | fixture coverage of every rule (`g2.rule-coverage`) |
| 3 | `p2-mutation-ci` | the phase-2 mutation tests (`g2.checks-fail`) and CI |
| 3 | `p2-milestones` | this record: milestones M1 to M7 (below) |
| — | integrator | D58: the trail cites walk steps, acceptance rules and the gap's prefer and skip slots; the `recursive-far-call` and `inline-arm-switch` fixtures |
| — | fix round 1 | D59: the review's findings ("Review"); the closing run below |
| — | fix round 2 | D59 (j) to (p): the re-review's findings ("Review", "Fix round 2"); the closing run below |

### Commands and formats

| Command | What it does |
| --- | --- |
| `romlift analyze <rom> [--json] [--disable <rule>...]` | discover mode on a bare ROM: functions with origin and provenance, rejections, diagnostics (NDJSON with `--json`) |
| `romlift explain <addr> --rom <rom> [--json]` | what the analysis decided about one address: claim, owner, provenance, the trail events of its 256-byte bucket (proposals, accepts, rejections, verdicts, waits, claims), the rules' metadata |
| `npm run bench -- run [--only <rom>] [--json] [--disable <rule>...] [--cpu-prof]` | romlift's own scored discover run on the tuning ROMs, and counts only on the sealed ones (`romlift/bench-run@1`) |
| `npm run bench -- speed [--only <rom>] [--write-baseline]` | calibrated median CPU per tuning ROM against `bench/baseline/speed.json` (`romlift-bench/speed@1`) |
| `npm run bench -- ablate <rule> [--tier synthetic\|real] [--json]` | where a rule is decisive in the trail and what moves without it (`romlift/bench-ablate@1`) |
| `npm run bench -- explain <rom> <addr>`, `adopt <rom>` | explain on a tuning ROM or fixture (`romlift/bench-explain@1`); seed a new tuning dataset's lists as unreviewed placeholders (refuses a sealed one) |
| `npm run export-poc -- --mode parity\|queries` | the PoC's parity view (`romlift-bench/parity@1`, digests in `romlift-bench/poc-digests@1`) and its lockstep log (`romlift-bench/poc-queries@1`) |
| `npm run fixtures -- rebuild\|check [--only <name>]` | build the synthetic fixtures with agbcc and binutils, or rebuild them into a temporary directory and compare (`romlift/fixtures@1`) |
| `node --conditions=source bench/tools/seal-dataset.ts` | create a sealed held-out dataset from file hashes and the checkout commit, never reading a symbol |

Formats: the analysis codec `romlift/analysis@1` (`encodeAnalysis`/`decodeAnalysis`); the parity evidence
`romlift-bench/parity-evidence@1` and the accepted improvements `romlift-bench/accepted-diffs@1` in
`bench/`; a fixture's `expect.json` (`{negative, entries: [{addr, mode, extent?}], codeEnd?}`); the sealed
dataset files `bench/dataset/real/{pokefirered,pokeruby,tmc}.json` (`heldout: true`, family, digests,
no rows).

### The milestones

| Milestone | Commit | What it did | Bench diff |
| --- | --- | --- | --- |
| M1 parity | `843eae8` | `bench run` rows carry `parity: {digest, expected}`; a run under `--worklist poc-lifo` recorded the `parity` member of `results.json`: digests, row diffs and the lockstep of five family sets per ROM | none (rows equal the PoC baseline) |
| M2 performance | `1cd57ac` | profile-driven fixes keeping every digest; the internal `epoch-reuse` cache; `bench/baseline/speed.json` | none |
| M3 tables | `d963df8` | `walk.table-by-register` replaces `walk.table-nearest-pool-load`; `tableJump.lookBehindInsns` deleted | none |
| M4 order | `ab9eea0` | the ascending worklist is the default; the seed/override permutation property test | none in rows; provenance-only digest changes |
| extents | `a47de80`, `957fed8` | `walk.inline-arm-switch`; three `extent-agrees` improvements accepted | +1 agreeing extent on pokeemerald, sa2, sa3 |
| (M4 fix) | `f96c118` | `bl.target-beyond-callee`: the order dependence M4 exposed in a fixture | none (parity views identical) |
| M5 debt | `fde2f58` | the six unreviewed rows and the misnamed category; the startup exclusion in `g2.synthetic-analysis` | categories only |
| M6 confirm | `24f876a` | a listed label is no walk boundary in confirm mode | none |
| delete `poc-lifo` | `c608a33` | the LIFO worklist and `bench run --worklist` deleted; parity checks read the committed evidence | none |
| (speed fix) | `662f86a` | `WalkCursor.back` | none |
| (harness fix) | `a3ce9b0` | `bench poc-check` compares rescored rows without dataset categories | none |
| M7 held-out | (no commit) | sealed runs of pokefirered, pokeruby, tmc | `g2.held-out` fails (below) |

#### M1: parity

The dumps were regenerated with `export-poc --mode scored`, `--mode parity` and `--mode queries` (the
PoC rewrote `poc-digests.json` byte for byte). With worklist `poc-lifo`, cache `epoch` and no oracle,
the parity view of every tuning ROM hashed to the committed digest, and `bench run --json --worklist
poc-lifo` gave 0 baseline diffs on all five. The lockstep ran for five family sets per ROM: the driver
alone (every family answered from the PoC's log), each wave-2 component's families computed with the
rest answered, and every family computed. No set diverged, so no rule or driver needed a fix:

| ROM | Records | driver: matched / answered / skipped | walk+bl+claim: compared / recalled | seed+valid+accept: compared | gap+region: compared | all: matched / compared / skipped |
| --- | --- | --- | --- | --- | --- | --- |
| fe7j | 1,426,819 | 536,147 / 528,316 / 890,672 | 1,312 / 169,878 | 508,132 | 22,458 | 1,082,218 / 1,074,387 / 344,601 |
| klonoa | 6,948 | 4,061 / 3,489 / 2,887 | 142 / 813 | 2,432 | 1,054 | 6,593 / 6,021 / 355 |
| pokeemerald | 310,185 | 179,875 / 163,974 / 130,310 | 4,520 / 35,853 | 101,669 | 57,134 | 275,845 / 259,944 / 34,340 |
| sa2 | 35,999 | 20,131 / 17,214 / 15,868 | 421 / 5,067 | 11,009 | 5,068 | 32,309 / 29,392 / 3,690 |
| sa3 | 51,966 | 31,262 / 26,544 / 20,704 | 844 / 7,464 | 14,480 | 9,443 | 47,408 / 42,690 / 4,558 |

Every set matched or skipped every record and ended at the PoC's parity digest (fe7j `73a6cd2b…`,
klonoa `849470bd…`, pokeemerald `46225fad…`, sa2 `9db7cb59…`, sa3 `8b127ab4…`). This is the `parity`
member of `bench/results.json` (`romlift-bench/parity-evidence@1`, recorded on `e867dae` plus the
uncommitted M1 wiring, committed as `843eae8`); `g2.poc-parity`, `test/local/poc-parity.test.ts` and
`test/local/poc-lockstep.test.ts` check it now that `poc-lifo` is gone.

#### M2: performance

`bench run --cpu-prof` and `node --cpu-prof` found no quadratic getter: `codeEnd`, `end` and the extent
were already computed once per reading by `makeReading` (step (a); `valid.not-pointer-table` reads
`r.codeEnd`). The time was in the walks. On pokeemerald 149 Thumb walks of data candidates over
zero-filled regions decode 3,000 to 614,377 instructions each (15.2 M of the 18.1 M instructions
walked), all in the first grow round; on fe7j about 2,850 candidates that fail validity
non-intrinsically are re-walked in each of 93 grow rounds (248,725 walks). The fixes that keep every
digest: a `Set` for the dead-end test of each `bl` site (it was `Array.includes`), direct halfword
reads, the walk order returned as is when it is ascending, a one-pass merge of the covered spans, a
paged instruction index instead of a `Map` (`walk/insn-index.ts`; `Reading.insnAt` is typed by the
`InsnLookup` it needs), and a bit per ROM byte for `isFunction`.

Step (c): fe7j and pokeemerald still missed 3 s, so `cache: 'epoch-reuse'` was built
(`driver/reuse.ts`): a Thumb reading of an entry that is not accepted is carried over an epoch boundary
when no fact it read changed (the 64-byte pages of its `isFunction` and `claimAt` queries, its
`inProgress` answers, its callees' facts with the oldest stamp; any other view query makes it opaque).
Its digests equal `epoch` on every synthetic fixture and on all five tuning ROMs
(`test/local/epoch-reuse.test.ts`). **Decision:** `epoch` stays the production cache (architecture
§4.2), so `speed.json` records `epoch`; `epoch-reuse` is the measured option for `g3.speed-budget`.

| ROM | before M2 (`epoch`, LIFO) | `speed.json` (M2, `epoch`, LIFO) | `epoch-reuse` (M2) | at `662f86a` (`epoch`, ascending) |
| --- | --- | --- | --- | --- |
| fe7j | 9,533.8 | 7,958.65 | 3,198 | 8,008.3 |
| klonoa | 1,064.1 | 407.31 | 572 | 424.5 |
| pokeemerald | 9,676.4 | 5,201.64 | 4,438 | 5,471.2 |
| sa2 | 1,065.6 | 774.75 | 823 | 795.9 |
| sa3 | 2,195.9 | 1,527.52 | 1,419 | 1,549.0 |

Median CPU milliseconds of five runs after a warm-up (`bench speed`; the `epoch-reuse` column is the
median of five warm runs of the same analysis); calibration 192.47 ms in `speed.json`, ratio 0.968 at
`662f86a`. After M4 and the extents rule fe7j measured 10,760.5 ms (1.35 × its baseline):
`walk.inline-arm-switch` decoded the whole run at every `bx rN`, which `662f86a` fixed. The final
measurement is within the 1.5 × ratchet on every ROM, so `speed.json` keeps the M2 measurement.
pokeemerald and fe7j still exceed the phase-3 budget of 3 s CPU under `epoch` (see "Known limitations").

#### M3: table jumps by register tracking

`walk.table-by-register` takes the agbcc walk slot; agbcc's `matchTableJump` idiom follows the jump
register back through the run (`core/profile/thumb-registers.ts`: moves, adds and the word load of the
table slot are followed; a constant, other arithmetic, a pop or a call's clobbers end the trail) to the
pc-relative load that set it. The 40-instruction look-behind and `tableJump.lookBehindInsns` are gone;
the unit test has a load hoisted 60 instructions ahead and a nearer decoy load into another register.
On the tuning set every analysis digest is unchanged: the nearest qualifying load always was the
register's own.

#### M4: order switch

`DEFAULT_TUNING.worklist` is `'ascending'`. The result's options record lists seeds and overrides in a
total order and confirm mode picks the listed seed after the same sort;
`test/unit/analysis/driver/order.prop.test.ts` permutes seeds and overrides with a seeded shuffle on
every fixture in both modes and requires one digest. Rows were unchanged and the parity view still
equalled the PoC's on all five; the analysis digests moved only in provenance. The fixture
`pops-unpushed-frame` regressed (it assumed LIFO acceptance), which `f96c118` fixed (Deviations, 3).

#### Extents

At parity sa2 had 2,886 of 2,889 sized extents agreeing (99.896%). `walk.inline-arm-switch`
(`a47de80`; restsOn: hand-written code enters ARM in place with `add rN, pc, #0; bx rN` and runs the ARM
body right after it as one function) makes m4a's `umul3232H32` cover its ARM body: the walker walks the
ARM code after an inline switch for its extent only (`Reading.armTails`) and leaves its bytes free, so
the ARM half is still found by `gap.arm-scan` and kleod's and FE7J's own FUNC there stay true positives.
`extent-agrees` on pokeemerald `0x082DF04C`, sa2 `0x080945E8` and sa3 `0x080B9838`, accepted in
`bench/baseline/accepted-diffs.json` by `957fed8`; nothing else moved. MultiSioIntr (the ELF's size
ends before its pool) and ld_r3_tp_adr_i (an ELF size of 1,822 bytes over several local subroutines)
remain mismatches.

#### M5: the exception debt

| Dataset | Row | Category | Confirmed by `bench explain` and the reference disassembly |
| --- | --- | --- | --- |
| klonoa | untyped `0x0804F73E` | `second-entry` | ldrb_r3_r2 + 2, reached by `bl` from MPlayJumpTableCopy |
| fe7j | untyped `0x080BE84E` | `second-entry` | the same helper's second entry |
| fe7j | untyped `0x080BE7C6`, `0x080BE804`, `0x080BE874` | `mixer-internal` | m4a_1.s labels: `bx r3`, the routine after ClearChain, the target of ply_patt's `b` |
| fe7j | untyped `0x080889FC` | `untyped-leaf` | a whole 34-byte leaf the ELF only labels, reached by two near `bl` |
| fe7j | labels `0x0800D484`, `0x0800D4AC`, `0x0800D840`, `0x0800D864`, `0x08064AD0` | `split-after-returning-call` | right after `bl _call_via_r0`, which is `bx r0` and returns |
| fe7j | label `0x0804D13C` | `disassembler-split` | follows `lsls r0, r7, #16`, not a call (Deviations, 4) |

`continuation-after-noreturn-call` and `unreviewed` are no longer categories; every category is carried
by a dataset row or a sealed classifier. The startup exclusion holds on every dataset: the tuning
scoring and the sealed classifiers already counted from the end of the startup region, and
`g2.synthetic-analysis` now does too (six negative fixtures had failed on `0x08000000` and
`0x080000C0`). `bench dataset-check` passes.

#### M6: confirm equals discover

`g2.confirm-equals-discover` failed on all five, on two or three functions each (the cartridge entry
252 bytes in discover and 4 in confirm, ld_r3_tp_adr_i 10 and 2, pokeemerald's GameCubeMultiBoot_Main
350 and 256): discover walked each before the entry inside it was a function, and confirm made every
listed entry, labels included, a walk boundary from round 0. In confirm mode a `label = true` entry is
now a boundary only once taken (`view.ts` `isListedBoundary`). The gate passes: fe7j 7,739 listed (7
labels), klonoa 560 (7), pokeemerald 15,866 (9), sa2 2,901 (7), sa3 4,702 (7), 0 unlisted each.

#### M7: sealed held-out runs

`bench run --only <rom> --json`, counts only:

| ROM | Family | Entries | ELF functions | TP | Raw precision | Raw recall | Glued (inside an extent, outside every extent, past the code end) | Label candidates | Extents | Code end | False entries (startup, veneer, adr-callback, inside-ELF-function, other) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pokefirered | pret-gen3 | 12,395 | 12,389 | 12,389 | 99.95% | 100.00% | 0 (0, 0, 0) | 0 | 12,383 / 12,386 | 0 | 4, 0, 0, 6, 0 | pass |
| pokeruby | pret-gen3 | 11,461 | 11,455 | 11,455 | 99.95% | 100.00% | 0 (0, 0, 0) | 0 | 11,449 / 11,452 | 0 | 4, 0, 0, 6, 0 | pass |
| tmc | zeldaret-tmc | 8,589 | 8,636 | 8,582 | 99.92% | 99.37% | 51 (2, 15, 34) | 3 | 8,388 / 8,388 | -4,130 | 1, 0, 0, 0, 7 | fail |

Fix round 2 changed only how the glued misses split (architecture-r1-11): a miss counts as inside an
extent only inside the extent of a found function with an ELF entry, as the label classifier reads it,
so one of fix round 1's 3 moved to "outside every extent" (it lies in a false entry's extent). Every
other count is unchanged by fix round 2. Fix round 1 measured the `other` false entries (the counts before it dropped them, correctness-3) and
the split of the glued misses (correctness-4, delivery-4) at `6260b95`; every other count is unchanged
by the round.

The counts were the same at every milestone except that `walk.inline-arm-switch` added one agreeing
extent to pokefirered and pokeruby. `g2.held-out` itself reported `pending` here (it needs `discover`,
which `p2-commands` exports); from the counts it fails as the Verdict above says.

## Per tuning ROM, at `bb91cbe`

| ROM | ELF functions | Entries | TP | PoC TP | Raw precision | Raw recall | Misses | False entries | Extents agreeing | Code end | Baseline diffs | Analysis digest | Parity digest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,735 | 7,724 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 (100.000%) | +8 | 0 | `58bfa5f4…` | `963fa373…` |
| klonoa | 559 | 557 | 556 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 (100.000%) | +4 | 0 | `765bb825…` | `3211e557…` |
| pokeemerald | 15,856 | 15,862 | 15,856 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,850 / 15,853 (99.981%) | +0 | 1 (accepted) | `97485ab6…` | `e7722357…` |
| sa2 | 2,892 | 2,898 | 2,892 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,887 / 2,889 (99.931%) | +0 | 1 (accepted) | `eaa56e03…` | `ccde8068…` |
| sa3 | 4,693 | 4,699 | 4,693 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,305 / 4,307 (99.954%) | +0 | 1 (accepted) | `3d7de6e3…` | `4adee160…` |

Every miss is in `labels` and every false entry in `untyped`, with no stale row and no unreviewed row;
raw precision ≥ 99.7%, true positives equal the PoC's, extents ≥ 99.9% with no agreeing extent lost,
code end within 16 bytes, two runs deterministic. The parity digests no longer equal the PoC's since
`a47de80` (the umul3232H32 extents) and are unchanged by fix rounds 1 and 2. The analysis digests
moved through rejections only. In fix round 1 (rule ids, zero-run and walk-limit details): at `a3ce9b0`
they were fe7j `83b9ad13…`, klonoa `96084b76…`, pokeemerald `ec7a5a6a…`, sa2 `0e918184…`, sa3
`c88bd265…`; at `6260b95` fe7j `28423de7…`, klonoa `7e4ecde3…`, pokeemerald `7b323125…`, sa2
`44a1d109…`, sa3 `bc38155a…`. In fix round 2: claimed harvest targets are now rejected by
`valid.in-rom-unclaimed` (klonoa +61 rejections, sa2 +169), the unanchored detail names the accept
rules, and accept vetoes are rejections; functions with their provenance, extents and claims are equal
(compared entry by entry on klonoa and sa2 against `825f662`). `results.json` meta: commit `bb91cbe`,
dirty false, source digest `1b4b8d87…`, Node 24.

## Deviations from the roadmap

1. **`epoch-reuse` is built but not the default.** M2 step (c) was required because two ROMs missed 3 s;
   architecture §4.2 keeps `epoch` as the only production cache, so the internal mode is proven equal
   and measured, and the switch is left to phase 3's `g3.speed-budget`.
2. **Two rules beyond architecture §4.1's table** (resolved in fix round 1: D59 and §4.1 record them). `walk.inline-arm-switch` (extents) and
   `bl.target-beyond-callee` (below) are in agbcc's pipeline, the registry and their unit tests; the
   table of §4.1 and the PoC call-site column do not list them yet (`docs/architecture.md` is not this
   component's file). New contract members: `WalkStep` `'arm-tail'`, `Reading.armTails`,
   `ReadingShape.armTails`, `WalkCursor.back`, `InsnLookup` for `Reading.insnAt`, and
   `RuleOracle.worklist`.
3. **The order switch needed a rule, not only a commit.** Under `'ascending'` the fixture
   `pops-unpushed-frame` settled Caller before Nudge accepted DropArg, so Caller's `bl DropArg` became a
   far jump and Caller ran on to `0x08000DC8`. `bl.target-beyond-callee` (a far `bl` past the entry of
   another function the caller calls is a call) answers it without an order; on the tuning set the
   parity views are identical. The fixture's note still credits `bl.self-or-accepted`, which is now
   never decisive in a fixture (`g2.rule-coverage`).
4. **A seventh category.** The §8.3 table gives all six FE7J labels `split-after-returning-call`, but
   `0x0804D13C` follows no call; it is `disassembler-split`. `unreviewed` survives only as the
   placeholder `bench adopt` writes (`UNREVIEWED`), which `g2.no-unreviewed` refuses; the retired
   `continuation-after-noreturn-call` is readable in artifacts and datasets of older commits only
   (`RETIRED_CATEGORIES`), so `bench regression` can still read its base.
5. **M6 without the resettle stage.** A resettle (fresh settles of every accepted function against the
   final function set) was measured first: it shrinks discover's own extents (ld_r3_tp_adr_i from 10 to
   2 bytes, a change to a baseline mismatch row that `g2.baseline-rows` refuses) and, on the fixture
   above, an entry accepted inside a wrongly long reading cut the fresh walk short. Confirm mode's label
   semantics make the two modes equal with discover unchanged.
6. **`poc-lifo` survives only inside the lockstep oracle** (resolved in fix round 1: the oracle is deleted, D59). It is deleted from `AnalysisTuning`, the
   driver's worklist and the bench; the lockstep log is in the PoC's order, so the oracle that replays it
   supplies that order (`RuleOracle.worklist()`), and the lockstep reporter the mutation tests exercise
   keeps working.
7. **`speed.json` from M2** (resolved in fix round 1: re-measured under the shipped tuning, `0115309`). It was measured under `poc-lifo` and not raised after M4: the final
   `epoch`/ascending medians are within 1.0 to 1.1 × of it.
8. **The trail cites walk steps, acceptance rules and the gap slots prefer and skip** (D58, `6a74f3d`).
   `g2.rule-coverage` failed after wave 3 on fifteen load-bearing rules that no decision event named.
   New contract members: `WalkDecision`, `Reading.steps` (filled only when `WalkEnv.trace` is set, that
   is when a trail is on, so an untraced run and every digest are unchanged), `WalkEnv.trace`,
   `WalkRecord.step`. grow emits an `accept` event under the acceptance rule beside the proposer's;
   take and absorb emit a `verdict` per walk step of the reading that became a function (settle keeps
   the steps of every round); fill-gaps emits a `verdict` for the prefer and skip slots. `verdict` now
   covers those decisions, and `romlift explain` prints the group as "verdicts" (it said "bl
   verdicts"); the explain goldens were regenerated.
9. **Two more fixtures** (31 in all): `recursive-far-call` makes `bl.self-or-accepted` load-bearing (an
   agbcc recursive call 2.4 KiB past the entry after a guard that calls a never-returning function) and
   `inline-arm-switch` makes `walk.inline-arm-switch` load-bearing (m4a's umul3232H32 shape). The
   `pops-unpushed-frame` note now credits `bl.target-beyond-callee`. `g2.rule-coverage`: 49 of 57 rules
   decisive and load-bearing on 31 fixtures, 8 exempted by D57.
10. **No rule was written for tmc.** The only signal is the sealed counts: 51 `glued`, 3 label
    candidates, every one of the 8,388 sized extents agreeing, and the code end 4,130 bytes short. No
    tuning ROM shows a matching phenomenon: all five end their code within 16 bytes of the ELF, and on
    each the bytes after the code end are data (strings, tables, zero words), none opening with
    `push {.., lr}`. A rule could therefore be shown harmless on the tuning set but not validated by it,
    and writing one because tmc's code end is short would be tuning on a held-out ROM's misses, which
    AGENTS.md and D53 forbid. Revealing tmc would make it tuning data and leave no sealed ROM of a family
    absent from the tuning set; the reserve pool has no admitted pair on this machine (no Kirby or
    Pinball checkout).

## Fixes made during this component

- `957fed8`'s accepted improvements broke the unit test that required the committed file to be empty
  (`7bf70b7`).
- The `parity` member was dropped by `fde2f58`'s run: the artifact reader refused the previous artifact's
  retired category and the writer silently started from nothing. `c608a33` restored it from `f96c118`'s
  artifact, and a writing run now refuses to overwrite a `results.json` it cannot read.
- After M5 `g1.bench-harness` failed on the reclassified categories of rescored rows (`a3ce9b0`).

## Review

### Fix round 1

The adversarial review of phase 2 at `4a24486` (17 October 2026) raised 35 findings: two blockers, ten
majors and twenty-three minors. Fix round 1 ran on `phase-2` from `4a24486` to `6260b95` (nine commits,
then this record; the decisions are D59). Every major is fixed (delivery-3 in part, with the reason); the two blockers are the held-out
failure itself and cannot be fixed without tuning on a held-out ROM (below); every minor is fixed or
rejected with its reason.

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-1 | blocker | **Not fixable in this round; recorded.** `g2.held-out` still fails, now with the split of tmc's 51 glued misses: 3 strictly inside a found extent (true glued splits), 14 in no found extent below the code end, 34 past the code end. A rule for the tail would rest on "unreferenced functions follow the last referenced one", which no tuning ROM shows (all five end their code within 16 bytes of the ELF), and it could not fix the 3 glued splits inside extents, so tmc would still fail on zero glued; diagnosing those needs a reveal, which would leave no sealed ROM of a family absent from the tuning set. D53's safe default holds: phase 2 does not land, nothing is merged or pushed, `test/gates/phase.json` stays `{ "landed": 1 }`. |
| delivery-1 | blocker | Same as correctness-1. Route (b) needs an owner-supplied reserve pair (Kirby & the Amazing Mirror or Pokémon Pinball; neither checkout is on this machine); route (c) is architecture §12 item 4, which the owner has not answered. |
| architecture-1 | major | Fixed (`8676557`). The gap's head is accepted only through the proposers after the pair (`gap.tiled-hole-inner`), at the gap start and after the end-anchor loop, and cites the head rule and the proposer; `valid()` judges outside, odd and claimed entries through the validity slot, whose rejection names `valid.in-rom-unclaimed`. Tests: disabling `gap.tiled-hole-inner` leaves a filling head unaccepted (`fill-gaps.test.ts`); disabling `valid.in-rom-unclaimed` makes a claimed entry valid (`validity.test.ts`). |
| architecture-2 | major | Fixed (`8676557`). The calls of an absorbed block go through `s.rules.queue`; `pointerCandidates` returns one list per resolved harvest rule; an unanchored rejection names the proposer. Test: a dummy profile with three harvest rules and no `seed.call` (`grow.test.ts`). |
| architecture-3 | major | Fixed (`245aae5`). The ARM walk and `gap.arm-scan` follow the decoder's Flow; walkFlow and its PoC tests are deleted; no analysis digest moves on the five tuning ROMs and 31 fixtures, and the sealed counts are unchanged. Register effects are row data (`InsnSpec.registers`, `registerEffect`); `core/profile/thumb-registers.ts` is deleted; a test fails when a row with an `rd` field that writes lacks its spec. |
| architecture-4 | major | Fixed (`8676557`): the oracle, `consult`, `ORACLE_ORIGINS`, `OracleQueries`, the oracle branch of `resolveRules`, `bench/src/lockstep.ts` and their tests are deleted (D59 a). `poc-log.ts` stays: `export-poc --mode queries`, which the exit list runs, re-reads every log it writes through it. |
| architecture-5 | major | Fixed by deletion (`8676557`). |
| correctness-2 | major | Fixed (`a5e2ecf`, `0115309`). `LIMITS.zeroRun` (64) ends a path in a zero-filled region; `LIMITS.walkInsns` (65,536) ends a walk with `W_WALK_LIMIT`. klonoa padded with 4 MiB of zeros: out of heap before, 0.46 s and 259 MB peak RSS now; +1 MiB: 4.47 GB before, 226 MB now. A unit test analyses a 32 MiB mostly-zero image under a 256 MiB V8 heap (`test/unit/analysis/large-zero-rom.test.ts`); with the limits lifted it runs out of memory. |
| correctness-3 | major | Fixed (`1f4b133`). `falseEntries.other` is counted, printed by `bench run` and the gate note, and the unit test asserts that the non-startup classes sum to entries - tp. tmc: other 7 (the M7 table below). |
| delivery-2 | major | Fixed (`153d648`). D59 records the two rules (summary, restsOn, slot), the contract members, confirm mode's label semantics and the deletion of `'poc-lifo'` and the oracle; architecture §2, §3.3, §4.1 (contracts, rule table, PoC call sites), §4.2 to §4.5, §9.1, §10 and §13 follow the code. |
| delivery-3 | major | Partly rejected. The lockstep cannot be re-run at HEAD: it replays the PoC's log in the PoC's LIFO order, which only the deleted oracle supplied, and architecture-4 asks for that deletion; the 2.A to 2.D lockstep gates are therefore historical (roadmap, D59). Re-recording the evidence from a clean commit needs the same oracle. What was done: `g2.poc-parity` checks that the commit the evidence names (`e867dae`, recorded with the uncommitted M1 wiring that became `843eae8`) is an ancestor of HEAD, and the M1 section above says it was dirty. |
| delivery-4 | major | Fixed (`1f4b133`): `gluedWhere` splits the glued misses, counts only; the gate's verdict is unchanged. |
| architecture-6 | minor | Fixed (`8676557`, `80df4e6`): `driver/{state,facts,trail,view}.ts`, `walk/{cursor,record,predicates}.ts`. `types.ts` stays one file: it is the frozen contract module rules may import (architecture §2's edge table). |
| architecture-7 | minor | Fixed (`80df4e6`): `ClaimCode` is gone; `CLAIM_KINDS` and `claimName` derive from `Claim`; the codec, `romlift explain` and `bench explain` use them; diagnose's phrases are a record total over `ClaimKind`. |
| architecture-8 | minor | Fixed (`80df4e6`): `isPadding` loses `next` (architecture §4.3 updated); `misfitThreshold` leaves the profile until `W_PROFILE_MISFIT` has a raiser (D59 g). |
| architecture-9 | minor | Fixed (`8676557`, `153d648`): `compareCodeUnits` replaces `compareText` and the inline comparators of `rules.ts`, `families.ts` and `seal.ts`; `compareOverrides` sits beside `compareSeeds`; `HEADER_END` is exported by `foundation/rom/rom.ts`. |
| architecture-10 | minor | Fixed (`80df4e6`): `withVerdicts` in reading.ts builds the settled reading; `WalkRecord.finish` lost its unused `extra`. |
| architecture-11 | minor | Fixed (`80df4e6`): proposers return a `Proposal` and accept rules an `AcceptHold`; the driver stamps the slot's rule id; the accept rules compare `v.originOf(proposedBy)` with an origin. Test: a renamed harvest rule of origin data-pointer is still taken by `accept.pointer-table-run`. |
| architecture-12 | minor | Fixed (`1f4b133`): `shell/rom.ts` `readRom`; `cli/commands/analysis-records.ts`; `columns` in `reporters/text.ts`. |
| architecture-13 | minor | Fixed (`8676557`): `AnalysisOptionsRecord = AnalysisOptions`; the WalkStep comment sits on WalkStep. |
| architecture-14 | minor | Fixed, one part rejected. `test/unit/analysis` mirrors src (`rules/<family>/`, `walk/`, the top-level modules at the top); new cases bring branch coverage of `confirm.ts` to 97.6%, `diagnose.ts` to 96.7% and `pointers.ts` to 100% (`6b8a1f1`); `g2.rule-registry` looks for rule tests in the new tree (`6260b95`). Rejected: moving `test/unit/util` to `test/unit/foundation/util`; every foundation module's tests sit at `test/unit/<module>` (`isa`, `rom`, `formats`, `corpus`), and `util` follows that convention. |
| architecture-15 | minor | Fixed (`153d648`): `p2-driver` in the roadmap, this record and D56; the §4.1 table, the worklist type and the two rules are in the architecture. |
| correctness-4 | minor | Fixed with delivery-4. |
| correctness-5 | minor | Partly fixed. `g2.poc-parity` ties the evidence to its commit (an ancestor of HEAD); it becomes `historical` when phase 2 lands, as `historicalAfter: 2` says, and cannot be marked so earlier without raising `phase.json`. Rejected: dropping `export-poc --mode parity/queries` from the exit list; both still check the pinned PoC (parity reproduces `poc-digests.json` byte for byte; queries re-reads its log and checks the committed parity digest), and the orchestrator's gate list runs them. |
| correctness-6 | minor | Trail duplicates fixed (`8676557`: runDriver no longer emits a second 'propose' per seed). The entry function's extent over the header is deferred to phase 3 (Known limitations): bounding it changes an extent on every ROM and the confirm-mode agreement M6 established, and the header's claim belongs with the emission of the header (phase 3, `writers/header.ts`). |
| correctness-7 | minor | Fixed (`1f4b133`): EPIPE on stdout or stderr ends the CLI quietly (test: 4,096 rejection lines into a reader that closes after one chunk); E_IO_READ names the code once. |
| correctness-8 | minor | Fixed (`153d648`): (a) the roadmap threshold says "absent from the tuning set"; (b) thirteen components; (c) D57 names 29 and then 31 fixtures; (d) architecture-review.md and D53 say codebase family; (e) the g2.synthetic-analysis note says "no extra entries allowed in 31". |
| correctness-9 | minor | Fixed. `speed.json` re-measured under the shipped tuning (`0115309`); `romlift explain` runs the analysis once with the trail kept to a 64 KiB window and filters it afterwards, a second run only for an extent past the window (`1f4b133`): FE7J 11.6 s to 7.1 s wall. |
| delivery-5 | minor | Fixed (`153d648`): thirteen components; D56 (a) numbers the waves as the table does. |
| delivery-6 | minor | Fixed (`8676557`): the comments say "deleted by the phase-2 integration (c608a33)". |
| delivery-7 | minor | Fixed: the per-ROM table below is restated at the closing commit. |
| delivery-8 | minor | Fixed in the note (correctness-8 e); the flag keeps its name, because 31 committed `expect.json` files and the fixture tool read it. |
| delivery-9 | minor | Fixed with correctness-6: `romlift explain 0x08000100 --rom bench/dataset/synthetic/far-jump/build/far-jump.gba --json` lists 15 events, all distinct. |
| delivery-10 | minor | Fixed (`153d648`): `defineRule` stays in `romlift/internal`; D59 (h) and roadmap 2.0 say why. |
| delivery-11 | minor | Run: `npm run bench -- regression --base 55ecf36` on a worktree of `6a74f3d` after its own `bench run` prints "no regression against 55ecf36" (exit 0); its rows equal those of the closing run at `b2742a3`. |

### Fix round 2

The re-review of `825f662` (17 October 2026) raised 15 findings: two blockers (the same held-out
failure, raised by both reviewers), four majors and nine minors. Fix round 2 ran on `phase-2` from
`825f662` to `bb91cbe` (five commits, then this record; the decisions are D59 (j) to (p)).

| Finding | Severity | Disposition |
| --- | --- | --- |
| architecture-r1-1 | blocker | **Not fixable in this round; recorded.** `g2.held-out` fails at `bb91cbe` exactly as before (tmc recall 99.37%, 51 glued, code end -4,130; pokefirered and pokeruby pass but are both `pret-gen3`). D53's routes are unchanged: an owner-supplied reserve pair from a family absent from the tuning set (none is on this machine), or the owner's answer to architecture §12 item 4. Not merged, not pushed; `phase.json` stays `{ "landed": 1 }`. |
| correctness-r1-1 | blocker | Same as architecture-r1-1. The third route (a rule whose `restsOn` is validated on the tuning set alone) is not available for the reason in deviation 10: no tuning ROM shows the behaviour, so no rule can be validated on it, and writing one from tmc's misses is tuning on a held-out ROM. |
| architecture-r1-2 | major | Fixed (`5306f1f`). The mid-gap hole head goes through `acceptHead` (accepted under the head rule wherever it is taken, as both PoC call sites say 'tiled hole') and its count is added; `absorb` returns `acceptQueued`'s count into `added`. Tests: a mid-gap head is accepted under `gap.tiled-hole` and counted once (`fill-gaps.test.ts`); in confirm mode an unlisted mid-gap head adds 0 and `runAnalysis` raises no `W_FIXPOINT_LIMIT`; a mid-gap absorbed block's callee is counted. |
| correctness-r1-3 | major | Fixed with architecture-r1-2. The reviewer's repro (adr-handler-block, confirm with 0x08000104 omitted) raised `W_FIXPOINT_LIMIT` at `825f662` (checked) and raises only the two `W_UNLISTED_FUNCTION` now; it is a unit test (`confirm.test.ts`). |
| architecture-r1-3 | major | Fixed (`5306f1f`). `grow` drops only targets that are already functions and asks `valid()` about the rest, claimed ones included (`valid.in-rom-unclaimed`'s `checkEntry` rejects them before any reading, so no walk is added); the unanchored detail names the accept rules that declined instead of the driver reading `isPrologue`. Tests: a claimed target is rejected by `valid.in-rom-unclaimed` with no reading taken; with that rule disabled the claimed target is accepted. |
| correctness-r1-2 | major | Fixed (`1bf529c`). `failureDetail` appends the notes a gate wrote to its failure message, so `g2.held-out`'s record and console line now carry each sealed ROM's counts (the closing run below); unit test in `gate.test.ts`. |
| correctness-r1-4 | major | Fixed (`d84f4f0`). `LIMITS.candidateBudget` (262,144; tuning maximum 13,612) binds: a grow round judges that many and raises `W_CANDIDATE_BUDGET`. `LIMITS.epochReadingBytes` (256 MiB by `readingBytes`' estimate; tuning maximum about 105 MB): past it the held candidate readings are dropped, verdicts kept, and `W_READING_BUDGET` (new) is raised once. The reviewer's input (klonoa plus a self-referencing Thumb pointer flood): +8 MiB ran out of heap before; now `analyze` alone peaks at 2.2 GB RSS (1.07 GB heap live, 2.1 M rejections) under the default heap. A unit test analyses a 32 MiB image whose last 28 MiB are such pointers under a 512 MiB V8 heap in a child process (`pointer-flood-rom.test.ts`, about 12 s); with both budgets lifted it runs out of heap. No tuning ROM reaches either budget (no new diagnostic; functions unchanged). |
| architecture-r1-4 | minor | Fixed in part (`5306f1f`), the rest rejected with its reason. Fixed: the zero-halfword retry (and the claimed-halfword step) moved into `gap.adr-block-absorb`, which now owns every absorb position; gap positions are bus addresses; the forward slot is `{ thumb, arm, after }` with the ranks of the old list (a test resolves an ARM-only slot and finds no Thumb proposer). Rejected: moving the header skip and the claimed-byte step into slots. The first is a fact of the cartridge format, like `contains(rom, …)`, which the driver also applies without a rule; disabling it could only make the scan read the 192 header bytes as code, and phase 3 claims the header (correctness-6), which removes the line. The second moves the cursor past bytes a claim rule already decided (and cited); it decides nothing. Both are documented as traversal and format in architecture §4.2 and D59 (l). |
| architecture-r1-5 | minor | Fixed (`5306f1f`): `AnalysisTuning.worklist` and its writers are gone; architecture §3.3 says the worklist is always ascending. |
| architecture-r1-6 | minor | **Rejected.** `export-poc --mode queries` is one of the commands of this phase's closing list as the orchestrator runs it (it is in the gate list this round was given, and it passed below), so deleting the mode and `poc-log.ts` would make a required command fail. It is not circular in effect: it is the only command that re-runs the pinned PoC's instrumented query path and checks that the PoC still reaches the committed parity digest through it. Its removal belongs with the closing list's next revision (D59 a). |
| architecture-r1-7 | minor | Fixed (`31a86ef`): `isConditional` (the row's `cond` field) and `thumbWordAt` in `foundation/isa/decode.ts` replace the hand decoding in `walk/arm.ts`, `gap.arm-scan`, `walk/thumb.ts` and `accept.tiny-anchored-at-start`. Only `arm.nv` and `arm.undefined` lack a cond field, both `invalid`, so no reading changes. |
| architecture-r1-8 | minor | Fixed (`31a86ef`): `effectOf` throws `RomliftInvariantError` for an operand name the row lacks; a table test checks every `writes`, `list` and `from` name of every Thumb and ARM row against its `toOps` keys. |
| architecture-r1-9 | minor | Fixed (`5306f1f`): a veto calls `reject()` with the veto's id and `reason` (and the proposal's cites); `diagnoseMiss` names the veto of a vetoed miss. Two explain goldens changed (false-stub-2byte, mixer-tiled-hole). |
| architecture-r1-10 | minor | Fixed (`d84f4f0`, `31a86ef`, `5306f1f`): unit tests for the ARM walk limit, the ARM 'table' and 'switch-mode' steps (the latter conditional and not), and a mid-gap absorb resume. |
| architecture-r1-11 | minor | Fixed (`1bf529c`): `gluedWhere` in `classify.ts` uses labelClause's function filter (ELF entry, strictly inside); `seal.ts` calls it; three-way unit tests. tmc's split is now 2 / 15 / 34 (one miss lies in a false entry's extent). |

The orchestrator also asked to correct docs/benchmark-roms.md where it said tmc has no ELF: it already
records `tmc/tmc.elf` and `tmc/build/USA/tmc.map` (since `f4b5c20`), so no change was needed.

## The closing gate

Fix round 2's run on `phase-2` at `bb91cbe` (working tree clean but for the `bench/results.json` the run
itself rewrites), every command from the repository root with
`ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`, in this order (the real tier before the
ci tier). `npm run corpus` was run first (exit 0, inputs digest `144770c8…`), because the round changed
`foundation/isa`, which is in the corpus's import closure. `test/gates/phase.json` stays
`{ "landed": 1 }`.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages, 0 vulnerabilities |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 21 tests, 21 pass |
| `npm test` | 0 | 904 tests, 904 pass |
| `npm run fixtures -- check` | 0 | 31 of 31 fixtures agree (agbcc commit not named, the bytes decide) |
| `npm run bench -- doctor-real` | 0 | every ROM, ELF, PoC file and toolchain matches its digest |
| `npm run export-poc -- --mode scored` | 0 | five dumps, PoC scaffold OK, deterministic (215 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical (77 s) |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs re-read, parity matches the committed digest (50 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 16 tests, 16 pass |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | binutils, corpus and JUMP11 ok; agbcc and old_agbcc reported missing (not required) |
| `npm run bench -- run` | 0 | five rows (the per-ROM table above); sealed: pokefirered pass, pokeruby pass, tmc FAIL (the M7 table); `results.json` written at `bb91cbe`, gate record cleared |
| `npm run bench -- speed` | 0 | calibration ratio 0.972; fe7j 8,390 ms (limit 12,850), klonoa 190 (310), pokeemerald 2,866 (4,271), sa2 551 (793), sa3 1,009 (1,511) |
| `npm run bench -- regression` | 0 | no regression against `92bf7ce` (the PoC-sourced main) |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | five ROMs: rows equal, PoC row equal, scaffold OK, deterministic, PoC source pinned |
| `npm run bench -- gates --require 2 --tier real` | **1** | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end (fe7j 8, klonoa 4, others 0), g2.confirm-equals-discover, g2.determinism, g2.entries, g2.extents, g2.no-unreviewed, g2.poc-parity (evidence of `e867dae`, an ancestor of HEAD), g2.speed (ratio 1.032; fe7j 8,390 of 13,640 ms, klonoa 218 of 329); **fail: g2.held-out** ("the passing ROMs span 1 codebase families, at least two must; no passing ROM is from a family absent from the tuning set", now followed by the three sealed ROMs' counts: tmc "fail (recall 99.37% < 99.46%; 51 glued; code end -4130 bytes off)"); g3 to g6 pending (228 s) |
| `npm run bench -- gates --require 2 --tier ci` | 0 | every g1 gate passes (g1.provenance current, source digest `1b4b8d87…`); g2.checks-fail (4 files, 19 tests), g2.determinism, g2.regression, g2.rule-coverage (49 of 57 rules on 31 fixtures, 8 kept by D57), g2.rule-registry (57 rules), g2.second-profile (31 fixtures, 188 functions), g2.synthetic-analysis (31 fixtures, no extra entries allowed in 31), g2.vocabulary-emitted pass; g3 to g6 pending (56 s) |
| `npm run bench -- provenance` | 0 | source digest `1b4b8d87…` current; gate record, families (scaffold, printer), dataset and held-out rows ok |
| `npm run bench -- stale-check` | 0 | the artifact is current |

Not run, because `g2.held-out` fails and the safe default of D53 (architecture §12, item 4, not waited
on) is that phase 2 does not land: raising `test/gates/phase.json` to 2, the closing real-tier run under
the raised marker, pushing `phase-2`, the pull request to `main` and its CI workflows, and the merge.

Fix round 1's run at `6260b95` and the wave-3 integrator's at `b2742a3` had the same verdicts (every
command 0 but the real tier, failing on `g2.held-out` only); their numbers are in the Git history of
this file (`825f662`, `4a24486`).

## Known limitations

- **tmc fails sealed** (M7), so `g2.held-out` fails and phase 2 does not land. Of its 51 glued misses, 2
  lie inside the extent of a found function with an ELF entry, 15 in no such extent below the code end
  and 34 past it (the code end is 4,130 bytes short). A fix must rest on a rule's `restsOn` and be validated on the tuning set alone (deviation 10
  and the Review say why none was written); then a fresh sealed pair from the reserve pool is needed
  before release 1 claims generality. The owner's answer to architecture §12 item 4 (land with the
  failure recorded) or an admitted reserve pair of a family absent from the tuning set would unblock
  the closing sequence.
- **3 s CPU.** Under `epoch` fe7j (8.4 s) exceeds phase 3's budget; pokeemerald (2.8 s) is under it since
  the zero-run limit; `epoch-reuse` brings fe7j to about 3.2 s (M2).
- **The speed ratchet on klonoa is tight in absolute terms:** its analysis now takes about 0.2 s, so the
  1.5 × ratchet leaves about 0.1 s; single `--only klonoa` runs measured 194 to 264 ms against a limit of
  about 310 ms.
- **The cartridge entry's extent covers the header** (correctness-6): discover reads `b` at 0x08000000
  before the startup code at 0x080000C0 is a function, so its extent is 0x08000000..0x080000FC and
  `explain` reports header bytes as owned by it; confirm mode agrees (M6). Bounding it changes an extent
  on every ROM and belongs with the header's emission in phase 3 (a claimed header region no extent may
  cover).
- **Past the analysis budgets the result is partial, by design** (D59 m): a grow round judges at most
  262,144 candidates and the rest of its snapshot waits for a later round that never reaches them; past
  256 MiB of held readings a dropped reading is walked again, possibly against later facts. Both raise a
  warning; no tuning ROM comes within an order of magnitude of either.
- Extent mismatches left: MultiSioIntr on sa2 and sa3, ld_r3_tp_adr_i on sa2, sa3 and pokeemerald,
  GameCubeMultiBoot_Main and GameCubeMultiBoot_Quit on pokeemerald.
