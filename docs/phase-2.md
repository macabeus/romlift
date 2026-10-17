# Phase 2: Analysis

The record of phase 2 (roadmap "Phase 2", architecture §4, §8.3, §8.4, D10, D13, D26, D41, D53). It
was written by the milestone component `p2-milestones` (wave 3) on 17 October 2026, on its branch
`phase-2-p2-milestones`, cut from `phase-2` at `e867dae` after waves 1 and 2 had merged. Every number
here was measured on the owner's machine (macOS, Node 24.15.0, binutils 2.45.1 from Arm's GNU Toolchain
15.3.Rel1) with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`, while the other wave-3 components ran
on the same machine. Rules were tuned on the five tuning ROMs only; the held-out ROMs ran sealed, and
only their counts and verdicts were read (D25).

**Verdict.** Phase 2 does **not** land. Milestones M1 to M6 hold on the five tuning ROMs, every tuning
threshold of the roadmap holds, and the five rule changes after M1 each passed `bench regression`
against the commit before them. M7 fails: `g2.held-out` needs two passing sealed ROMs from two codebase
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

Phase 2 ran as twelve components in three waves on `phase-2` (the roadmap's "As executed" table).

| Wave | Component | Delivered |
| --- | --- | --- |
| 1 | `p2-engine` | the frozen analysis types and rule contracts, the `agbcc` profile, provenance, the driver (`run`, `grow`, `fill-gaps`, `accept`, `settle`, `validity`, `epoch`, `worklist`, `confirm`, `view`, `diagnose`), `reading.ts`, the oracle protocol and the walk skeleton |
| 1 | `p2-poc-export` | `export-poc --mode parity|queries`, the parity view and the lockstep log (`romlift-bench/poc-queries@1`), `bench/baseline/poc-digests.json` |
| 1 | `p2-fixtures` | the 26 synthetic fixtures (20 positive, 6 negative), their build and the rebuild check |
| 1 | `p2-heldout` | the sealed held-out datasets of pokefirered, pokeruby and tmc, the seal tool and the sealed classifiers |
| 2 | `p2-rules-walk-bl-claim` | the walk, `bl` and claim rules |
| 2 | `p2-rules-seed-valid-accept` | the seed, validity and acceptance rules |
| 2 | `p2-rules-gap-region` | the gap and region rules |
| 2 | `p2-lockstep` | `bench/src/{parity,lockstep}.ts`, the codec `romlift/analysis@1` |
| 2 | `p2-bench` | romlift's own scored discover run in `bench run`, `bench speed`, `ablate`, `explain`, `adopt` |
| 3 | `p2-commands` | the discover and explain workflows, the `analyze` and `explain` commands, the explain goldens |
| 3 | `p2-fixture-coverage` | fixture coverage of every rule (`g2.rule-coverage`) |
| 3 | `p2-mutation-ci` | the phase-2 mutation tests (`g2.checks-fail`) and CI |
| 3 | `p2-milestones` | this record: milestones M1 to M7 (below) |

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

| ROM | Family | Entries | ELF functions | TP | Raw precision | Raw recall | Glued | Label candidates | Extents | Code end | False entries (startup, veneer, adr-callback, inside-ELF-function) | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pokefirered | pret-gen3 | 12,395 | 12,389 | 12,389 | 99.95% | 100.00% | 0 | 0 | 12,383 / 12,386 | 0 | 4, 0, 0, 6 | pass |
| pokeruby | pret-gen3 | 11,461 | 11,455 | 11,455 | 99.95% | 100.00% | 0 | 0 | 11,449 / 11,452 | 0 | 4, 0, 0, 6 | pass |
| tmc | zeldaret-tmc | 8,589 | 8,636 | 8,582 | 99.92% | 99.37% | 51 | 3 | 8,388 / 8,388 | -4,130 | 1, 0, 0, 0 | fail |

The counts were the same at every milestone except that `walk.inline-arm-switch` added one agreeing
extent to pokefirered and pokeruby. `g2.held-out` itself reported `pending` here (it needs `discover`,
which `p2-commands` exports); from the counts it fails as the Verdict above says.

## Per tuning ROM, at `a3ce9b0`

| ROM | ELF functions | Entries | TP | PoC TP | Raw precision | Raw recall | Misses | False entries | Extents agreeing | Code end | Baseline diffs | Analysis digest | Parity digest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,735 | 7,724 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 (100.000%) | +8 | 0 | `83b9ad13…` | `963fa373…` |
| klonoa | 559 | 557 | 556 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 (100.000%) | +4 | 0 | `96084b76…` | `3211e557…` |
| pokeemerald | 15,856 | 15,862 | 15,856 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,850 / 15,853 (99.981%) | +0 | 1 (accepted) | `ec7a5a6a…` | `e7722357…` |
| sa2 | 2,892 | 2,898 | 2,892 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,887 / 2,889 (99.931%) | +0 | 1 (accepted) | `0e918184…` | `ccde8068…` |
| sa3 | 4,693 | 4,699 | 4,693 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,305 / 4,307 (99.954%) | +0 | 1 (accepted) | `c88bd265…` | `4adee160…` |

Every miss is in `labels` and every false entry in `untyped`, with no stale row and no unreviewed row;
raw precision ≥ 99.7%, true positives equal the PoC's, extents ≥ 99.9% with no agreeing extent lost,
code end within 16 bytes, two runs deterministic. The parity digests no longer equal the PoC's since
`a47de80` (the umul3232H32 extents); `results.json` meta source digest `de44a049…`, Node 24.

## Deviations from the roadmap

1. **`epoch-reuse` is built but not the default.** M2 step (c) was required because two ROMs missed 3 s;
   architecture §4.2 keeps `epoch` as the only production cache, so the internal mode is proven equal
   and measured, and the switch is left to phase 3's `g3.speed-budget`.
2. **Two rules beyond architecture §4.1's table.** `walk.inline-arm-switch` (extents) and
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
6. **`poc-lifo` survives only inside the lockstep oracle.** It is deleted from `AnalysisTuning`, the
   driver's worklist and the bench; the lockstep log is in the PoC's order, so the oracle that replays it
   supplies that order (`RuleOracle.worklist()`), and the lockstep reporter the mutation tests exercise
   keeps working.
7. **`speed.json` from M2.** It was measured under `poc-lifo` and not raised after M4: the final
   `epoch`/ascending medians are within 1.0 to 1.1 × of it.

## Fixes made during this component

- `957fed8`'s accepted improvements broke the unit test that required the committed file to be empty
  (`7bf70b7`).
- The `parity` member was dropped by `fde2f58`'s run: the artifact reader refused the previous artifact's
  retired category and the writer silently started from nothing. `c608a33` restored it from `f96c118`'s
  artifact, and a writing run now refuses to overwrite a `results.json` it cannot read.
- After M5 `g1.bench-harness` failed on the reclassified categories of rescored rows (`a3ce9b0`).

## The closing gate

What ran on `phase-2-p2-milestones` (exit codes as measured; the integrator re-runs the whole list on
`phase-2` after wave 3 merges, real tier before ci):

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | |
| `npm test` | 0 | 778 tests, 778 pass |
| `npm run fixtures -- check` | 0 | 26 of 26 fixtures agree |
| `npm run export-poc -- --mode scored` | 0 | five dumps, PoC scaffold OK, deterministic |
| `npm run export-poc -- --mode parity` | 0 | five digests, byte-identical `poc-digests.json` |
| `npm run export-poc -- --mode queries` | 0 | five logs, parity matches the committed digest |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 16 tests, 16 pass |
| `npm run bench -- doctor-real` | 0 | every input matches its digest |
| `npm run bench -- run` | 0 | five rows, three sealed entries |
| `npm run bench -- speed` | 0 | every ROM within the ratchet |
| `npm run bench -- regression` | 0 | no regression against `92bf7ce` (the PoC-sourced main) |
| `npm run bench -- gates --require 2 --tier real` | 1 | pass: g1.dataset-elf, g2.confirm-equals-discover, g2.poc-parity, g2.speed; g1.bench-harness passes after `a3ce9b0`; pending (`discover`, `explain` from p2-commands): g2.baseline-rows, g2.code-end, g2.determinism, g2.entries, g2.extents, g2.held-out, g2.no-unreviewed |
| `npm run bench -- gates --require 2 --tier ci` | 1 | pass: every g1 gate but g1.provenance (no real-tier gate record yet), g2.rule-registry, g2.second-profile, g2.synthetic-analysis, g2.vocabulary-emitted; fail: g2.checks-fail (p2-mutation-ci), g2.rule-coverage (p2-fixture-coverage: 26 rules, among them walk.inline-arm-switch and bl.self-or-accepted); pending: g2.determinism, g2.regression |

After wave 3 was integrated on `phase-2` (p2-milestones, p2-fixture-coverage, p2-commands,
p2-mutation-ci), the ci tier measured: `npm run typecheck` 0; `npm run lint` 0 (21 tests);
`npm test` 0 (881 tests, 881 pass); `npm run bench -- regression` 0 (no regression against `92bf7ce`);
`npm run bench -- gates --require 2 --tier ci` 1: pass every g1 gate but g1.provenance (the source
digest of `results.json`, `de44a049…`, is stale against the merged sources, and no real-tier gate
record exists), g2.checks-fail (5 files, 22 tests), g2.determinism (29 analyses), g2.regression,
g2.rule-registry (57 rules), g2.second-profile, g2.synthetic-analysis (29 fixtures),
g2.vocabulary-emitted; fail g2.rule-coverage on 17 rules: the 15 load-bearing rules no trail decision
event names (four acceptance rules, the gap slots prefer and skip, nine walk rules with
`walk.table-by-register` in place of `walk.table-nearest-pool-load`), plus `bl.self-or-accepted` and
`walk.inline-arm-switch`, which no fixture makes load-bearing (bench/dataset/synthetic/index.md, "No
fixture yet").

The rest of the sequence (raise `test/gates/phase.json` to 2, the closing real-tier run, `bench
provenance`, `bench stale-check`, the pull request and its CI) was not run: `g2.held-out` fails, and the
safe default of D53 is that phase 2 does not land.

## Known limitations

- **tmc fails sealed** (M7). A fix must rest on a rule's `restsOn` and be validated on the tuning set
  alone; then a fresh sealed pair from the reserve pool is needed before release 1 claims generality.
- **3 s CPU.** Under `epoch` fe7j (8.0 s) and pokeemerald (5.5 s) exceed phase 3's budget; `epoch-reuse`
  brings fe7j to 3.2 s, and pokeemerald's cost is first-round walks over zero-filled data that no cache
  avoids.
- Extent mismatches left: MultiSioIntr on sa2 and sa3, ld_r3_tp_adr_i on sa2, sa3 and pokeemerald,
  GameCubeMultiBoot_Main and GameCubeMultiBoot_Quit on pokeemerald.
