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
(p)), which re-ran the whole closing list at `bb91cbe`. The re-review of `e151012` was answered by fix round 3
(`4628c1e` to `22cbc77`, D59 (m) revised, (q) to (t)), which re-ran the whole closing list at `22cbc77` in
a fresh `git worktree` with no local caches. The owner's answer of 17 October 2026 to architecture §12
item 4 ("Tune on tmc, no new ROM", D60) was implemented from `306eaf2` to `808513f` ("The owner's decision",
below), and the whole closing list ran at `808513f` in a fresh worktree. The adversarial review of `74ec273` was
answered by fix round 1 of D60 (`baa6161` to `9c8b282`; "Review", below), which lowered `phase.json` back
to 1 and re-ran the whole closing list at `9c8b282` in a fresh worktree ("The closing gate", below).

**Verdict (after fix round 1 of D60).** Phase 2 does **not** land. The review found that the landing at
`808513f` rested on gate changes the owner had not authorised; fix round 1 withdrew them, and with
`test/gates/phase.json` back at `{ "landed": 1 }` every command of the closing list exits 0 at `9c8b282`
except `bench gates --require 2 --tier real`, whose failing gates are all on tmc and none on another ROM:
`g2.poc-parity` (tmc has no M1 lockstep evidence), `g2.baseline-rows` (8 tmc rows the pinned PoC's own run
of tmc does not have, none of them an improvement) and `g2.confirm-equals-discover` (6 tmc functions, with
D8 restored). `g2.held-out` passes with its family conditions waived, now bound to the sealed pair and the
tuning families of the decision. tmc's rows are unchanged from `808513f` (tp 8,631, 5 listed misses, 12
listed false entries, 8,388/8,388 extents, code end 0); the five original rows equal those of `808513f`
but the code end of klonoa and fe7j (+4 and +8 → 0, one convention for every ROM); pokefirered and
pokeruby pass sealed with unchanged counts. Phase 2 waits for the owner's answers ("Owner questions",
below). Nothing is merged or pushed.

**Verdict (after the owner's decision, D60; superseded by fix round 1).** Phase 2 passes its closing gate: all 21 commands of the
closing list exit 0 at `808513f` (`test/gates/phase.json` raised to `{ "landed": 2 }` before the run, as
the landing procedure requires), including `bench gates --require 2 --tier real` (every g1 and g2 gate
`pass`, `g2.poc-parity` `historical`) and `--tier ci`. tmc is the sixth tuning ROM: raw recall 99.37% →
99.94%, 51 glued misses → 5 listed label rows, code end −4,130 → 0; pokefirered and pokeruby pass sealed
with unchanged counts, and `g2.held-out` prints that its family conditions are waived by the owner (no
held-out ROM of a family absent from the tuning set remains). Nothing is pushed or merged: the pull request
to `main`, its CI workflows (`ci.yml`, `printer.yml`, `provenance.yml`) and the merge remain.

**Verdict (after fix round 3).** Phase 2 still does **not** land, for the same single reason: every
command of the closing list exits 0 except `bench gates --require 2 --tier real`, whose only failing
gate is `g2.held-out` (tmc: recall 99.37%, 51 glued, code end -4,130; pokefirered and pokeruby pass but
are both `pret-gen3`). The round fixed the other blocker (a clean checkout's `bench run` dropped the
printer member, so the ci tier and `bench provenance` failed: the closing run below is from a fresh
worktree without the corpus pre-step and both pass), the major (the candidate budget is now run-wide,
so a flood's rejections are bounded by it) and every minor. Nothing was tuned on a held-out ROM; the
analysis digests of the five tuning ROMs are unchanged; `test/gates/phase.json` stays
`{ "landed": 1 }`; nothing is merged or pushed.

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

## Owner questions

Fix rounds 1 and 2 of D60 withdrew every gate change the owner had not authorised. Four gates now fail on
tmc (`g2.poc-parity`, `g2.baseline-rows`, `g2.confirm-equals-discover`, `g2.code-end`) and `g2.held-out`
fails on its two-families condition, which the decision's words do not waive; phase 2 lands only once the
owner answers these (D53's safe default: it does not land while a gate fails).

1. **`g2.poc-parity` on tmc** (gate-honesty-r0-1). The gate checks the M1 evidence (the PoC parity digests,
   rows equal to the PoC baseline, the lockstep of five rule-family sets), recorded at `843eae8` under the
   `poc-lifo` worklist, which was deleted in phase 2; it covers the five ROMs of the pinned PoC baseline.
   tmc has no M1 run and none can be made without restoring deleted code, and the pinned baseline has no
   tmc row to compare rows with. At `landed` 1 the gate fails ("tmc: no parity evidence or committed
   digest"). Facts for the answer: the pinned PoC's own run of tmc (measured this round) has 8,589 entries
   and tp 8,582, as romlift's sealed run at `d645160`; romlift's rescoring reproduces that run's row field
   for field (`bench poc-check`), and that row is pinned by content in `bench/baseline/poc-dump-rows.json`
   (fix round 2). Enforcement (gate-honesty-r1-3): until fix round 2 the landing procedure (raise
   `phase.json` to 2, then the closing real-tier run) made the gate `historical` without judging it, so a
   "no" could not be enforced; since fix round 2 the gate, once historical, still checks that the committed
   evidence covers every tuning dataset (`test/gates/poc-parity-coverage.ts`) and fails on tmc, so a "no"
   holds mechanically and a "yes" is written into that file's `SCOPED_OUT` with the decision. **May
   `g2.poc-parity` be scoped to the ROMs of the M1 evidence, printing "tmc: not applicable, no M1 lockstep
   run"?**
2. **`g2.baseline-rows` on tmc** (gate-honesty-r0-5; facts corrected in fix round 2, gate-honesty-r1-4).
   tmc's PoC reference is the pinned PoC's own run of it, so every row that differs from that run must be
   a listed improvement. 51 are (accepted in `bench/baseline/accepted-diffs.json`); 8 are not, and they
   are of three kinds. Six come with the IWRAM block `seed.ram-copy` brings into the code: the false
   entries 0x080B197C, 0x080B1AA8, 0x080B1B0C, 0x080B21B0, 0x080B2718 and 0x080B27E4, labels the ELF does
   not type inside or reached from that block; disabling the rule removes them with the 33 IWRAM functions
   it finds. One is an address correction from rule (a), the 2-mod-4 resume: the PoC's false entry
   0x08008B30 (inside `_play_snd`) is found at 0x08008B2E, where `_play_snd` really starts, so for that row
   the fail is a remove/add pair of one entry (`false-entry-removed` 0x08008B30 is accepted,
   `false-entry-added` 0x08008B2E is not), not a new false entry. One is the miss 0x080B20AC, listed in
   both runs, whose reason changed (the PoC: an ARM routine never reached; romlift: inside the code of
   IntrMain, which the block brings in). All 7 false entries are listed in tmc's `untyped` with categories.
   **For a ROM revealed after the PoC was pinned, may `g2.baseline-rows` accept listed rows the PoC's run
   did not have (the narrowing `28b9005` wrote into the roadmap), or must it stay as for the five?**
3. **`g2.confirm-equals-discover` on tmc** (gate-honesty-r0-3). D8 is restored; 6 functions differ on tmc
   (0x08004274 since `d645160`), none elsewhere. Options: (a) ratify the confirm mode of `747293f` (listed
   entries taken after the passes), under which the gate holds by construction on discover's own list, so
   it would need a companion check that seeds confirm with a different list; (b) build D8's `resettle`
   stage, which makes every entry inside another found extent a boundary (the startup piece and the m4a
   mixer's inner entries on every tuning ROM; effect on rows unmeasured); (c) record the 6 differences as a
   tmc limitation of phase 2. **Which?**
4. **The two-families waiver of `g2.held-out`** (gate-honesty-r0-6, gate-honesty-r1-2). "Tune on tmc, no
   new ROM" records that no held-out ROM of a fresh family remains (the fresh-family condition, waived);
   a waiver of "the passing ROMs span two codebase families" was only inferred from "pokefirered and
   pokeruby must keep passing" and "phase 2 then lands". Since fix round 2 the gate does not apply the
   inference: it fails with "the passing ROMs span 1 codebase families, at least two must (not waived: …
   owner question Q4)". **Does the decision waive both conditions?** A "yes" adds the owner's words to the
   waiver's `grounds.twoFamilies` in `test/gates/held-out-verdict.ts`.
5. **The code-end convention of the scorer** (gate-honesty-r1-1, overfitting-r1-7; new in fix round 2 of
   D60). The ELF's code end is the largest addr + size of its functions, the PoC's convention and every
   scorer's since phase 1, under which an unsized function (hand-written asm without `.size`) ends where it
   starts. Fix round 1 changed it, for every ROM, tuning and sealed, to end an unsized function at the first
   data mapping (`$d`) or typed symbol after it; fix round 2 withdrew that, because it is a gate input the
   owner did not authorise and the only reading under which tmc passes. romlift's analysis of tmc is the
   same under every reading (digest `d8aac78c…`, code end 0x080B2A30); only the ruler moves. Facts for the
   answer, per reading (phase-1 / `$d` / pool-inclusive, the next typed symbol ignoring `$d`): tmc +148 /
   0 / −64 (its last FUNC `sub_080B299C` has size 0; `$d` at 0x080B2A30 starts the pool `intr.s`'s
   functions share, the next typed symbol is at 0x080B2A70); klonoa +4 / 0; fe7j +8 / 0; pokeemerald, sa2,
   sa3, pokefirered and pokeruby 0 under each (their last function is sized). The gate limit is 16 bytes.
   With the phase-1 reading `g2.code-end` and `bench regression` fail on tmc (+148). **May the code-end
   convention change for every ROM, tuning and sealed, to the `$d` reading, or must tmc's +148 stand as a
   failure (or a recorded limitation)?**

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
| — | fix round 2 | D59 (j) to (p): the re-review's findings ("Review", "Fix round 2") |
| — | fix round 3 | D59 (m) revised, (q) to (t): the second re-review's findings ("Review", "Fix round 3"); the closing run below |

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

These are the sealed counts up to `d645160`. tmc was revealed by the owner's decision (`306eaf2`, D60) and
is tuning data since; its rows are in "The owner's decision" and the per-ROM table at `808513f`.

Fix round 2 changed only how the glued misses split (architecture-r1-11): a miss counts as inside an
extent only inside the extent of a found function with an ELF entry, as the label classifier reads it,
so one of fix round 1's 3 moved to "outside every extent" (it lies in a false entry's extent). Every
other count is unchanged by fix round 2. Fix round 1 measured the `other` false entries (the counts before it dropped them, correctness-3) and
the split of the glued misses (correctness-4, delivery-4) at `6260b95`; every other count is unchanged
by the round.

The counts were the same at every milestone except that `walk.inline-arm-switch` added one agreeing
extent to pokefirered and pokeruby. `g2.held-out` itself reported `pending` here (it needs `discover`,
which `p2-commands` exports); from the counts it fails as the Verdict above says.

## The owner's decision (D60)

As implemented from `306eaf2` to `808513f`; fix round 1 of D60 ("Review", below) withdrew `747293f`
(confirm mode), the `codeEnd` row of `80762ff`, the PoC scoping of `72e6049`, the roadmap narrowing of
`28b9005` and the raised `phase.json` of `808513f`, and rewrote `seed.ram-copy`'s copy recognition; the
table below is the record of those commits, not the current state.

On 17 October 2026 the owner, Bruno Macabeus, answered architecture §12 item 4: **"Tune on tmc, no new
ROM."** tmc moved from the sealed held-out set into the tuning set through the recorded reveal, its misses
were fixed with general rules (each justified by the instructions that need it, none naming an address, a
symbol or a ROM), its remaining rows were classified like those of the other tuning datasets, and
`g2.held-out` records that no held-out ROM of a family absent from the tuning set remains (D60). The
previous agent's diagnosis (seven causes, measured in a scratch copy with each rule behind a flag) was
the starting point; every rule was re-implemented and re-measured here, and two points of the diagnosis
were found wrong and corrected (below). Each rule commit was measured with `bench run --json` against the commit before it on all six
tuning ROMs and with `npm run bench -- regression --base <previous commit>`: no problem on the five
original ROMs at any step, the only problems being tmc's still unlisted rows until `80762ff`.

| Commit | Change | tmc tp / entries | Effect on fe7j, klonoa, pokeemerald, sa2, sa3 |
| --- | --- | --- | --- |
| `306eaf2` | reveal tmc (`bench run --reveal`); the tuning-set pins follow the reveal | 8,582 / 8,589, 54 misses, 7 false, code end −4,130 | none |
| `abe9b1a` | the gap scan resumes on a non-padding 2-mod-4 halfword (D60 a): `_call_via_r8` … `_call_via_lr`, the second entry 0x08000E92 | 8,590 / 8,597 | identical digests |
| `67af08d` | `gap.end-anchor`: a veneer-array element (D60 b): 0x08000288..0x08000298 | 8,595 / 8,602 | identical digests |
| `8d207c0` | `gap.end-anchor`: `push {.., lr}` on 2 mod 4 (D60 c): 0x08007DCE found, false 0x08007DCC gone | 8,596 / 8,602 | pokeemerald: 2 rejection records, rows identical |
| `212d436` | `claim.dead-code-in-extent`: an unreached copy of the entry stub stays free (D60 d): CreateSwampDrownFx | 8,597 / 8,603 | identical digests |
| `6f9c9c4` | `seed.ram-copy` (D60 e): 33 of the 34 IWRAM functions past the code end; code end −4,130 → +148 | 8,630 / 8,649 | identical digests |
| `b99a10d` | `gap.forward-chain`: a word holding an accepted function + 1 is a pointer (D60 f) | 8,630 / 8,647 | identical digests |
| `72e97d8` | `seed.adr`: labels and data (D60 g) | 8,630 / 8,642 | identical digests |
| `5a715f3` | `accept.prologue-and-calls-accepted` (D60 h): CreateDustFromScript | 8,631 / 8,643 | rows identical; origins move (fe7j 2,122 functions, pokeemerald 1,234, sa3 202, sa2 149, klonoa 13); fe7j's analysis 8.6 s → about 1.2 s |
| `747293f` | confirm mode takes the rest of the list after the passes (D60 k): confirm equals discover on all six | (discover unchanged) | discover unchanged |
| `80762ff` | tmc's 5 `labels`, 12 `untyped` and `codeEnd` rows, each with a `Bench-Exception` trailer; the `codeEnd` row mechanism (D60 j); two new categories, three widened (D60 i) | 8,631 / 8,643, code end 0 | none |
| `d1a7f60` | `g2.held-out` waives its family conditions, printed (the owner's decision) | | |
| `bec649c` | `seed.ram-copy` reads only the instructions it needs (klonoa 308 → 252 ms CPU) | | identical digests |
| `e3e08d8` | tmc's `bench/baseline/speed.json` entry | | |
| `72e6049` | the PoC commands and the PoC-measured `scaffold` family cover the ROMs the PoC ran on (D60 l) | | |
| `28b9005`, `808513f` | D60, architecture §12 item 4 answered; `phase.json` raised to 2 | | |

**tmc, before and after.**

| | Entries | ELF functions | TP | Precision | Recall | Misses | False entries | Extents | Code end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `d645160`, sealed | 8,589 | 8,636 | 8,582 | 99.92% | 99.37% | 54: 51 glued (2 inside an extent, 15 outside every extent, 34 past the code end), 3 label candidates | 8 (1 startup, 7 other) | 8,388 / 8,388 | −4,130 |
| `808513f`, tuning | 8,643 | 8,636 | 8,631 | 99.86% | 99.94% | 5, all in `labels` (3 mixer-internal, 2 split-after-returning-call) | 12, all in `untyped` (5 local-subroutine, 4 second-entry, 1 untyped-leaf, 2 unreached-tail) | 8,388 / 8,388 | 0 (`codeEnd` row; +148 against the unsized last FUNC) |

**Where the prototype was wrong.** (1) Its `seed.ram-copy` proposed every mapped pointer; the 27 low-ROM
veneers point at every entry of fall-through chains, so tails were accepted before their heads, the heads'
ARM readings overflowed into them, and the gap scan read 0x080B19CC..0x080B19D4 as three Thumb stubs: the
bench scores addresses, not modes, so it counted them as true positives. Here only a pointer whose
previous instruction is an unconditional exit is proposed, and the gap scan finds the heads as ARM. (2)
The diagnosis put the confirm-mode difference down to confirm judging listed seeds by validity (25
listed-invalid entries); those are reported only and do not move the parity view. The cause is the order:
discover's readings depend on what was taken before them (traced: discover walks GetNextFrame in epoch 1
with 200 functions taken, while validity judges it as a harvest candidate, and reuses that reading when a
call takes it), while confirm took the whole list in round 0 in address order; `747293f` takes it in
discover's order (D60 k).

**What is not a rule.** The code end needs the dataset's `codeEnd` row, because tmc's last FUNC has ELF
size 0 (a general scorer convention would have moved klonoa's and fe7j's PoC-rescored rows, which
g1.bench-harness requires equal); dataset-check recomputes the row from the ELF. tmc has no PoC run, so
its "true positives at least the PoC's" floor (g2.entries) is vacuous, it has no baseline rows, and
`g2.poc-parity` has no evidence for it until the gate becomes historical with `phase.json` at 2.

## Per tuning ROM, at `808513f`

| ROM | ELF functions | Entries | TP | PoC TP | Raw precision | Raw recall | Misses | False entries | Extents agreeing | Code end | Baseline diffs | Analysis digest | Parity digest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,735 | 7,724 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 (100.000%) | +8 | 0 | `a1e91da5…` | `d2c87e51…` |
| klonoa | 559 | 557 | 556 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 (100.000%) | +4 | 0 | `518d9572…` | `49c42676…` |
| pokeemerald | 15,856 | 15,862 | 15,856 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,850 / 15,853 (99.981%) | +0 | 1 (accepted) | `698343b9…` | `d7348336…` |
| sa2 | 2,892 | 2,898 | 2,892 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,887 / 2,889 (99.931%) | +0 | 1 (accepted) | `bfa0a805…` | `ae83e802…` |
| sa3 | 4,693 | 4,699 | 4,693 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,305 / 4,307 (99.954%) | +0 | 1 (accepted) | `9c0fb964…` | `396939bf…` |
| tmc | 8,636 | 8,643 | 8,631 | (no PoC run) | 99.86% | 99.94% | 5 | 12 | 8,388 / 8,388 (100.000%) | +0 | (no PoC row) | `d8aac78c…` | `929cee1f…` |

The five original rows equal the table at `22cbc77` below in every count; their analysis digests moved
through `accept.prologue-and-calls-accepted` (origins) and, on pokeemerald, `gap.end-anchor` (two
rejections). `results.json` meta: commit `808513f`, dirty false, source digest `c4e2cc97…`, Node 24,
printer member from the closing run's corpus (inputs digest `144770c8…`). Sealed at `808513f`:
pokefirered pass (precision 99.95%, recall 100.00%, glued 0, label candidates 0, extents 12,383 / 12,386,
code end 0), pokeruby pass (99.95%, 100.00%, 0, 0, 11,449 / 11,452, 0).

## Per tuning ROM, at `22cbc77`

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
(compared entry by entry on klonoa and sa2 against `825f662`). Fix round 3 moved no analysis digest
(no tuning run reaches a budget, passes a malformed seed or is truncated). `results.json` meta: commit
`22cbc77`, dirty false, source digest `45377b90…`, Node 24; the printer member is the one kept from the
previous artifact (inputs digest `144770c8…`, still current, D59 t).

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
10. **No rule was written for tmc** (superseded on 17 October 2026: the owner decided to tune on tmc, D60;
    see "The owner's decision"). The only signal is the sealed counts: 51 `glued`, 3 label
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
| correctness-r1-4 | major | Fixed (`d84f4f0`). `LIMITS.candidateBudget` (262,144; tuning maximum 13,612) binds: a grow round judges that many and raises `W_CANDIDATE_BUDGET`. `LIMITS.epochReadingBytes` (256 MiB by `readingBytes`' estimate; tuning maximum about 105 MB): past it the held candidate readings are dropped, verdicts kept, and `W_READING_BUDGET` (new) is raised once. The reviewer's input (klonoa plus a self-referencing Thumb pointer flood): +8 MiB ran out of heap before. Corrected in fix round 3 (correctness-r2-4) with the re-review's measurement at `e151012`, library `analyze()`, default heap: 1,802,581 rejections, 1.12 GB heap live, 1.65 to 1.74 GB peak RSS (the CLI with `--json` peaked at 4.23 GB); the figures first recorded here (2.2 GB, 2.1 M rejections) were not reproducible. A unit test analysed a 32 MiB image whose last 28 MiB are such pointers under a 512 MiB V8 heap in a child process (`pointer-flood-rom.test.ts`, about 15 s; moved to `test:local` in fix round 3); with both budgets lifted it runs out of heap. No tuning ROM reaches either budget (no new diagnostic; functions unchanged). |
| architecture-r1-4 | minor | Fixed in part (`5306f1f`), the rest rejected with its reason. Fixed: the zero-halfword retry (and the claimed-halfword step) moved into `gap.adr-block-absorb`, which now owns every absorb position; gap positions are bus addresses; the forward slot is `{ thumb, arm, after }` with the ranks of the old list (a test resolves an ARM-only slot and finds no Thumb proposer). Rejected: moving the header skip and the claimed-byte step into slots. The first is a fact of the cartridge format, like `contains(rom, …)`, which the driver also applies without a rule; disabling it could only make the scan read the 192 header bytes as code, and phase 3 claims the header (correctness-6), which removes the line. The second moves the cursor past bytes a claim rule already decided (and cited); it decides nothing. Both are documented as traversal and format in architecture §4.2 and D59 (l). |
| architecture-r1-5 | minor | Fixed (`5306f1f`): `AnalysisTuning.worklist` and its writers are gone; architecture §3.3 says the worklist is always ascending. |
| architecture-r1-6 | minor | **Rejected.** `export-poc --mode queries` is one of the commands of this phase's closing list as the orchestrator runs it (it is in the gate list this round was given, and it passed below), so deleting the mode and `poc-log.ts` would make a required command fail. It is not circular in effect: it is the only command that re-runs the pinned PoC's instrumented query path and checks that the PoC still reaches the committed parity digest through it. Its removal belongs with the closing list's next revision (D59 a). |
| architecture-r1-7 | minor | Fixed (`31a86ef`): `isConditional` (the row's `cond` field) and `thumbWordAt` in `foundation/isa/decode.ts` replace the hand decoding in `walk/arm.ts`, `gap.arm-scan`, `walk/thumb.ts` and `accept.tiny-anchored-at-start`. Only `arm.nv` and `arm.undefined` lack a cond field, both `invalid`, so no reading changes. |
| architecture-r1-8 | minor | Fixed (`31a86ef`): `effectOf` throws `RomliftInvariantError` for an operand name the row lacks; a table test checks every `writes`, `list` and `from` name of every Thumb and ARM row against its `toOps` keys. |
| architecture-r1-9 | minor | Fixed (`5306f1f`): a veto calls `reject()` with the veto's id and `reason` (and the proposal's cites); `diagnoseMiss` names the veto of a vetoed miss. Two explain goldens changed (false-stub-2byte, mixer-tiled-hole). |
| architecture-r1-10 | minor | Fixed (`d84f4f0`, `31a86ef`, `5306f1f`): unit tests for the ARM 'table' and 'switch-mode' steps (the latter conditional and not) and a mid-gap absorb resume. Corrected in fix round 3 (architecture-r2-4): the ARM walk-limit test reached only the copy of the limit check on the no-decode path; `75b5481` makes it one check above the split, which the test now covers (walk/arm.ts 100% lines and branches). |
| architecture-r1-11 | minor | Fixed (`1bf529c`): `gluedWhere` in `classify.ts` uses labelClause's function filter (ELF entry, strictly inside); `seal.ts` calls it; three-way unit tests. tmc's split is now 2 / 15 / 34 (one miss lies in a false entry's extent). |

### Fix round 3

The re-review of `e151012` (17 October 2026) raised 13 findings: three blockers (the held-out failure,
raised by both reviewers, and the printer member a clean checkout dropped), one major and nine minors.
Fix round 3 ran on `phase-2` from `e151012` to `22cbc77` (four commits, then this record).

| Finding | Severity | Disposition |
| --- | --- | --- |
| architecture-r2-1 | blocker | **Not fixable; recorded.** `g2.held-out` fails at `22cbc77` exactly as before (the closing run below). D53's routes are unchanged: an owner-supplied sealed reserve pair from a family absent from the tuning set (the reserve candidates, Kirby & the Amazing Mirror and Pokémon Pinball, are not on this machine), or the owner's answer to architecture §12 item 4, whose safe default (D53) is that phase 2 does not land. Not merged, not pushed; `phase.json` stays `{ "landed": 1 }`. |
| correctness-r2-1 | blocker | Same as architecture-r2-1; deviation 10 says why no rule can be validated for tmc on the tuning set. |
| correctness-r2-2 | blocker | Fixed (`4628c1e`). `bench run` records the local corpus summary when current, else the previous artifact's `printer` member while its inputs digest still equals `corpusInputsDigest`, else refuses to write and says to run `npm run corpus` (D59 t; unit test in `printer.test.ts`). The roadmap's phase-2 exit list runs `npm run corpus` before `bench run`. The closing run below is from a fresh worktree of `22cbc77` (`npm ci`, no `bench/.local`), running the orchestrator's list, which has no corpus step: `bench run` kept the member, and the ci tier and `bench provenance` pass. |
| correctness-r2-3 | major | Fixed (`6a421c1`): the text was right that it was false. `LIMITS.candidateBudget` now binds the distinct targets grow judges in a whole run (`DriverState.judged`); a target judged before is judged again, a fresh one past the budget never is; `W_CANDIDATE_BUDGET` is raised once. The tuning ROMs judge at most 13,431 (pokeemerald). Measured with the library `analyze()` on the reviewer's inputs (`test/helpers/pointer-flood-rom.ts`, default heap): fe7j + 16 MiB 261,475 rejections (was 4,204,100), 160 s (was 256 s), 1.98 GB peak RSS (was 3.14 GB), 7,739 functions; sa3 + 16 MiB 260,923 rejections, 23.5 s, 1.84 GB; klonoa + 8 MiB 262,089 rejections, 8.3 s, 1.23 GB, 560 functions. Time still grows with the grow rounds, because each round's harvest enumerates the flood (Known limitations, D59 m). Tests: a multi-round grow test with a budget of 3 (`grow.test.ts`) and `test/local/pointer-flood.test.ts` (klonoa + 8 MiB, several rounds, rejections ≤ budget + klonoa's own). |
| architecture-r2-2 | minor | Fixed (`75b5481`): `ruleFor` loses the veto lookup; `rejectionKey` is exported by `trail.ts` and used by `reject` and `diagnoseMiss`, which takes the reason from the recorded rejection. |
| architecture-r2-3 | minor | Fixed (`6a421c1`): `forget(s, entry, 'carry' \| 'drop')` in epoch.ts is the only way a candidate reading leaves `settled`; settle records the facts before `hold`. Unit test: `hold` past the budget under `'epoch-reuse'` leaves no facts and carries nothing for the evicted entries (it fails on the old code). |
| architecture-r2-4 | minor | Fixed (`75b5481`): one limit check above the decode split; `walk/arm.ts` 100% lines and branches over `test/unit` and `test/golden`. The architecture-r1-10 row above is corrected. |
| architecture-r2-5 | minor | Fixed (`6a421c1`): the flood cases are a stress tier in `test:local`; the budget logic has unit tests with an injectable budget (`grow(s, budget)`, `hold(s, …, budget)`). `npm test` takes about 12 s (was 23 s). `W_CANDIDATE_BUDGET` is once per run; the labelled-break concern is gone with the per-round loop. |
| architecture-r2-6 | minor | Fixed by the second option (`75b5481`): `restsOn` and `recovers` state the retry, zero only, because the assembler aligns such a block with zero fill, not with the `mov r8, r8` the profile's padding idiom also accepts; `isPadding` would change what the rule absorbs. The adr-handler-block explain goldens were regenerated. |
| architecture-r2-7 | minor | Fixed (`75b5481`): comments cite D59 (l), (m), (q) and D42. |
| correctness-r2-4 | minor | Fixed: the correctness-r1-4 row above now gives the re-review's measured figures and names the measurement. |
| correctness-r2-5 | minor | Fixed (`6a421c1`): `driver/seeds.ts` leaves out a seed whose entry is not a non-negative safe integer, whose mode is unknown, or whose size is not a positive integer that fits the ROM, with `W_SEED_MALFORMED` (new, D59 r); the result's options record only the seeds used. `confirm.test.ts` runs NaN, 1.5, sizes -8, 0, 0.5 and 0x4000000: each is reported once, no extent misses its entry, and a fitting size is kept. |
| correctness-r2-6 | minor | Fixed (`6a421c1`): `seed.rom-entry` proposes the startup target only when its first ARM word is wholly in the ROM (D59 s). `romlift analyze` on the first 194 bytes of klonoa now finds one function, `0x08000000 arm 0x08000000..0x08000004`. No diagnostic: a seed rule cannot raise one, and the single function says what was found. Unit test on a header-plus-halfword image. |

The orchestrator also asked to correct docs/benchmark-roms.md where it said tmc has no ELF: it already
records `tmc/tmc.elf` and `tmc/build/USA/tmc.map` (since `f4b5c20`), so no change was needed.

### Fix round 1 of D60

The adversarial review of `74ec273` (17 October 2026) raised 26 findings: three blockers, all gate
changes the owner had not authorised, eleven majors and twelve minors. Fix round 1 of D60 ran on
`phase-2` from `74ec273` to `9c8b282` (twelve commits), then this record. Every rule change was measured
with `bench run --json` against the commit before it on the six tuning ROMs and both sealed ROMs; the
replay of every commit from `d645160` is below ("Per-commit replay").

| Finding | Severity | Disposition |
| --- | --- | --- |
| gate-honesty-r0-1 | blocker | **Fixed by not landing** (`09a712d`): `test/gates/phase.json` is back to `{ "landed": 1 }`, so `g2.poc-parity` judges again and fails on tmc ("no parity evidence or committed digest"). No parity evidence can be made for tmc: the M1 lockstep ran under the deleted `poc-lifo` worklist, and `rowDiffs` compares with the pinned baseline, which has no tmc row. Scoping the gate to the five is an owner question (Q1). |
| gate-honesty-r0-2 | blocker | **Fixed** (`d099a0f`): the `pocUntil` exemption is removed, and the family is measured for tmc by the pinned PoC itself: `export-poc --mode scored` hands the child romlift's dataset for a ROM the PoC checkout has no file of (never writing into the checkout); its scaffold rebuilds tmc's SHA-1 (scaffold OK, 13 s, deterministic). `bench run` records the `scaffold` family for tmc from that dump; the provenance unit test now requires the family of every tuning ROM. |
| gate-honesty-r0-3 | blocker | **Fixed by revert** (`baa6161`): `747293f` is reverted and D8 stands (listed non-label entries are functions from round 0). `g2.confirm-equals-discover` fails on tmc, on 6 functions; fe7j, klonoa, pokeemerald, sa2, sa3 have 0 differences. A fresh reading at take time removes 2 of the 6 and changes the epoch semantics; D8's `resettle` would make the label entries boundaries on all six ROMs. Which remedy: owner question (Q3). |
| gate-honesty-r0-4 | major | **Fixed** (`d099a0f`): no dataset row decides a code end. `bench/src/truth.ts` `elfCodeEnd` ends an unsized function at the first `$d` or typed symbol after it, for every ROM, in the tuning and the sealed scorer; klonoa +4 → 0, fe7j +8 → 0, tmc 0. The PoC-dump rescoring of `g1.bench-harness` keeps the PoC's convention (`pocCodeEnd`), the recorded decision (D60 j). |
| gate-honesty-r0-5 | major | **Fixed** (`d099a0f`, `36aa61c`): tmc's PoC reference is the pinned PoC's own run of it (`poc.source` `dump`): floor tp 8,582, `lost` measured (0), row diffs measured; a ROM with no reference (`poc.source` `none`) fails `g2.entries`, `g2.extents` and `g2.baseline-rows` instead of passing on a vacuous 0, and the gates print the source. The roadmap's narrowing of the PoC thresholds is reverted (all six). The closing list adds `bench regression --base 74ec273`, romlift's own tmc row (tp 8,631, 8,388 agreeing extents) as a floor. Measured, `g2.baseline-rows` fails on tmc on 8 rows that are not improvements (Q2). |
| gate-honesty-r0-6 | major | **Fixed** (`7dd367d`): the waiver is bound to pokefirered and pokeruby (name, ROM SHA-1, ELF SHA-256) and to the tuning families of D60; any change ends it and the gate names the mismatch. D60 records that the owner's words cover the fresh-family condition and that the two-families waiver is inferred; confirmation is Q4. |
| gate-honesty-r0-7 | minor | **Fixed** (`7dd367d`): the gate calls `heldOutVerdict` (now `test/gates/held-out-verdict.ts`, since gates may import only entry points, `node:*` and `test/gates/**`) and prints its `waived` strings; the unit tests cover that function, and the unused copy in `bench/src/seal.ts` is deleted. |
| gate-honesty-r0-8 | minor | **Fixed** (`9c8b282`): `bench/tools/replay-regression.sh` replays any range; the replay of `d645160..36aa61c` is below. |
| code-quality-r0-1 | major | **Fixed** (`7dd367d`), with gate-honesty-r0-7. (The finding's premise that gates may import `bench/src` is wrong: the edge table allows only entry points, `node:*` and `test/gates/**`; the shared function lives in `test/gates/`.) |
| code-quality-r0-2 | major | **Fixed by revert** (`baa6161`): with D8 restored, `types.ts`, `state.ts` and the SeedRule doc describe the code again. |
| code-quality-r0-3 | major | **Fixed by removal** (`d099a0f`): the `codeEnd` row, its category and its trailer check are gone. |
| overfitting-r0-1 | major | **Fixed** (`f39242a`): the copy is recognised by what the callee does (BIOS CpuSet/CpuFastSet by its control word; a copy loop by the argument it loads through and the one it stores through, by forward data flow), never by a fixed r0/r1/r2 order. Fixtures `ram-copy-memcpy` (agbcc C `CopyBytes(dest, src, n)`) and `ram-copy-bios` both fail with the previous rule. The condition now holds on all six ROMs: 12 copies on the five (the m4a SoundMainRAM CpuSet on each), naming no entry there. |
| overfitting-r0-2 | major | **Fixed** (`412a920`, `d9f9623`): every rule of D60 names its fixture and its counter-check (D60 a to h); (b), (c), (d) and (f) are marked single-instance, and D60 says tmc's after-numbers are no evidence of generality until a sealed ROM of a fresh family passes. |
| overfitting-r0-3 | major | **Fixed** (`0c467b3`, `d9f9623`): the `second-entry` widening is reverted; the three rows it covered are `pointer-entry` (reached by a jump through their address), defined by the code, not by the rule. D60 (e) counts the rule's own false entries (2 of its 11 proposals; 6 false entries with the block) and states that (e), (f), (g) are one chain. Requiring more than "the previous instruction is a `b`" was implemented two ways and measured: the gap scan then takes both entries in Thumb mode, same counts, so it is rejected (D60 Rejected). |
| overfitting-r0-4 | major | **Fixed** (`412a920`, `e764d41`, `f39242a`): one fixture per branch (`gap-resume-2mod4`, `veneer-array`, `push-lr-2mod4`, `entry-stub-table`, `pointer-word-in-gap`, `adr-label-and-data`), each failing with its branch reverted. |
| overfitting-r0-5 | major | **Fixed** (`d099a0f`): one convention for every ROM, in the scorer (gate-honesty-r0-4). The `$d` convention was chosen over the pool-inclusive one: for a symbol with no size, the assembler's first data mapping symbol is where its instructions stop, and tmc's trailing pool is shared by the file's functions; the asymmetry with a sized `.size` is recorded (D60 j). |
| overfitting-r0-6 | minor | **Kept, measured** (`d9f9623`): the rule holds for 967 candidates on the six ROMs, 346 with one call, and every one is an ELF function (0 false acceptances); D60 (h) explains the earlier acceptance on fe7j and the others. |
| overfitting-r0-7 | minor | **Fixed** (`e764d41`): both candidates go through one ranking; fixture `push-lr-2mod4` has both readings valid. |
| overfitting-r0-8 | minor | **Fixed** (`f39242a`): the bound is IWRAM's 32 KiB from the memory map; `argInsns` 8 from an instruction-level argument and the measured maximum (7). |
| code-quality-r0-4 | minor | **Fixed** (`0d60765`). |
| code-quality-r0-5 | minor | **Fixed** (`0d60765`): §4.2 says the gate fails on tmc and why, and that the remedy is the owner's. |
| code-quality-r0-6 | minor | **Fixed** (`d099a0f`): the sealed scorer uses `elfCodeEnd`; the dead condition is gone with `unsizedCodeEnd`; `Truth.ends` is required. |
| code-quality-r0-7 | minor | **Fixed** (`f39242a`): named masks, `thumbPoolBase`/`pcOf`, one decoder helper, the docs describe the call as a copy in either order. |
| code-quality-r0-8 | minor | **Fixed** (`f39242a`): the roles come from the callee; the BIOS ABI is `foundation/rom/bios.ts`; `maxBytes` is gone. |
| code-quality-r0-9 | minor | **Fixed** (`d099a0f`): `pocRomNames(baseline)`; `pocUntil` is gone. |
| code-quality-r0-10 | minor | **Fixed** (`0d60765`): the dataset test covers all six; the later gates say "every tuning ROM". |

#### Per-commit replay

`bench/tools/replay-regression.sh d645160 36aa61c` as it was at `9c8b282`: per commit, `bench run` in a fresh worktree, and `bench regression --base <the previous commit's artifact file>` run with HEAD's code and HEAD's datasets. What that replay did not check (review of `f802822`, gate-honesty-r1-6, code-quality-r1-3): a file base skips the `Bench-Exception` trailer check and the base datasets, every commit was judged with HEAD's code rather than its own, `d645160` was not benched (so `306eaf2` had no base), and a failed `bench run` would have left the commit's committed `results.json` to be copied as fresh. The corrected replay of fix round 2 ("Fix round 2 of D60", below) supersedes this table. On fe7j, klonoa, pokeemerald, sa2 and sa3 no commit has a regression problem, and their tp, entries, false entries and agreeing extents never change (their code end moves only at `d099a0f`, +8 and +4 to 0, the uniform convention). tmc's problems until `80762ff` are its rows not yet listed, as recorded in those commits.

| Commit | bench | regression | Problems on the five | tmc problems | tmc tp / entries / false / agreeing extents / code end |
| --- | --- | --- | --- | --- | --- |
| `306eaf2` | 0 | (first) | 0 | 0 | 8582 / 8589 / 7 / 8388 / -4130 |
| `abe9b1a` | 0 | 1 | 0 | 1 code-end, 7 unlisted-false-entry, 46 unlisted-miss | 8590 / 8597 / 7 / 8388 / -4130 |
| `67af08d` | 0 | 1 | 0 | 1 code-end, 7 unlisted-false-entry, 41 unlisted-miss | 8595 / 8602 / 7 / 8388 / -4130 |
| `8d207c0` | 0 | 1 | 0 | 1 code-end, 6 unlisted-false-entry, 40 unlisted-miss | 8596 / 8602 / 6 / 8388 / -4130 |
| `212d436` | 0 | 1 | 0 | 1 code-end, 6 unlisted-false-entry, 39 unlisted-miss | 8597 / 8603 / 6 / 8388 / -4130 |
| `6f9c9c4` | 0 | 1 | 0 | 1 code-end, 19 unlisted-false-entry, 6 unlisted-miss | 8630 / 8649 / 19 / 8388 / 148 |
| `b99a10d` | 0 | 1 | 0 | 1 code-end, 17 unlisted-false-entry, 6 unlisted-miss | 8630 / 8647 / 17 / 8388 / 148 |
| `72e97d8` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 6 unlisted-miss | 8630 / 8642 / 12 / 8388 / 148 |
| `5a715f3` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 5 unlisted-miss | 8631 / 8643 / 12 / 8388 / 148 |
| `747293f` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 5 unlisted-miss | 8631 / 8643 / 12 / 8388 / 148 |
| `80762ff` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `d1a7f60` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `bec649c` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `e3e08d8` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `72e6049` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `28b9005` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `808513f` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `74ec273` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `baa6161` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `09a712d` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `7dd367d` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `d099a0f` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `f39242a` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `e764d41` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `412a920` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `0c467b3` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `36aa61c` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |

### Fix round 2 of D60

The adversarial review of `f802822` (17 October 2026) raised 25 findings: one blocker, nine majors and
fifteen minors. Fix round 2 ran on `phase-2` from `f802822` to `8cd8857` (twelve commits), then this record.
Every analysis change was measured with `bench run --json` on the six tuning ROMs and both sealed ROMs
against the commit before it; the corrected replay of every commit is below.

| Finding | Severity | Disposition |
| --- | --- | --- |
| gate-honesty-r1-1 | blocker | **Fixed** (`907f9e3`): the `$d` code-end convention of D60 (j) is withdrawn; `elfCodeEnd` is the largest addr + size again, for every scorer. romlift's analysis is the same under every reading; under this one `g2.code-end` and `bench regression` fail on tmc (+148) and klonoa and fe7j are +4 and +8 again. Whether the convention may change for every ROM is owner question Q5, with the measurements of all three readings. |
| gate-honesty-r1-2 | major | **Fixed** (`603863c`): the waiver covers only the fresh-family condition (the owner's words); the two-families condition fails with "not waived: … owner question Q4". |
| gate-honesty-r1-3 | major | **Fixed** (`c083537`): a historical gate may declare `historicalCheck`, which still runs; g2.poc-parity's checks that the committed evidence covers every tuning dataset. Measured with `phase.json` at 2: the gate fails on tmc instead of turning `historical`. Q1 says so. |
| gate-honesty-r1-4 | minor | **Fixed** (this record): Q2 now says that 6 rows come with the `seed.ram-copy` block, 0x08008B2E is the PoC's 0x08008B30 moved two bytes by rule (a) (a remove/add pair of one entry) and 0x080B20AC is a listed miss whose reason changed. |
| gate-honesty-r1-5 | minor | **Fixed** (`1dc360f`): `bench/baseline/poc-dump-rows.json` pins tmc's PoC row (dataset digest, row digest, tp 8,582); `bench run` and `bench poc-check` refuse a dump that differs, and poc-check prints tmc's PoC row as equal to the pinned one. |
| gate-honesty-r1-6 | minor | **Fixed** (`d4a956e`): the replay judges each commit in its own worktree with its own code, against a git-ref base carrying the previous commit's fresh artifact (trailers and base datasets checked), benches `<from>` first, and flags a failed run. Re-run on the whole range (below); the old table's description is corrected above. |
| gate-honesty-r1-7 | minor | **Fixed** (`2eb6b56`): the dead `DatasetProblemId` 'code-end' is gone and `pocDatasets`' doc is right. The trailers of `80762ff` name `second-entry` for 0x080B1AA8, 0x080B1B0C and 0x080B21B0, now `pointer-entry`: commit messages are not rewritten; the dataset rows are authoritative. |
| gate-honesty-r1-8 | minor | **Fixed** (`2eb6b56`): the `untyped-leaf` widening is reverted and tmc's 0x080B197C is `pointer-entry`; the `split-after-returning-call` widening is kept, with the reason in D60 (i) (the same split by another call instruction, covering two misses the PoC's own run has too). |
| overfitting-r1-1 | major | **Fixed** (`50bfd05`): D60 reports each rule's decisive condition per ROM, marks (a), (e), (g) and (h) single-instance, and states that the measured effect of the whole rule set is on tmc only. |
| overfitting-r1-2 | major | **Fixed** (`95b257b`): both windows are set from the tuning set's distribution with a stated margin (copy setups 3, 4, 6, 7 instructions → `argInsns` 12; jumps 1, 2, 3, 5 → its own `jumpInsns` 8); fixture `ram-copy-setup-bound` has a setup of exactly 12, so 11 fails it. |
| overfitting-r1-3 | major | **Fixed** (`95b257b`): the copy loop recognises the end-pointer form (`cmp` of a copy pointer with the third argument, L = end − that pointer); re-measured, mapping a pointer equal to D adds the false entry 0x0800012C to `code-copied-to-ram` and moves no row on the six ROMs, and the Rejected entry of D60 says that. |
| overfitting-r1-4 | major | **Fixed** (`7d7f298`): negative fixture `data-frame-not-function`; the call clause, the every-call clause and the return clause each fail it when reverted. D60 (h) restates the 967-candidate rate as that of data-pointer origin plus a word-aligned prologue. |
| overfitting-r1-5 | minor | **Fixed** (`95b257b`): fixture `ram-copy-entry-boundaries` (a declined fall-through entry, an accepted entry after a pool); a word-aligned entry after a claimed pool word, or after a pool of the reading of another named entry, opens a function. On tmc this moves origins and two unsized extents, no row (D60 e). |
| overfitting-r1-6 | minor | **Fixed** (`1550acf`): the own-extent clause is removed; D60 (g) gives the per-sub-condition counts (the decode test declines tmc's 3 decisive targets). |
| overfitting-r1-7 | minor | **Routed to the owner** (`907f9e3`, Q5), with gate-honesty-r1-1. |
| overfitting-r1-8 | minor | **Fixed as reporting** (`2eb6b56`): D60 (i) says `unreached-tail` and `pointer-entry` are carried by tmc's rows only and reports the cost of (e) to (g): tmc's false entries 8 → 12, precision 99.92% → 99.86%. The rows stay listed with their categories, so the bench row still says `false 12 (0 unlisted)`. |
| overfitting-r1-9 | minor | **Fixed** (`95b257b`): CpuFastSet's count rounds up to a multiple of 8 words; `ram-copy-bios`'s block B is 10 words (moved as 16), and the unit tests pin the rounding. |
| code-quality-r1-1 | major | **Fixed** (`95b257b`): fixture `ram-copy-call-via` and a unit case for the `bl _call_via_rN` jump (each fails with `stubRegister` removed; tmc loses 9 true positives without it at HEAD); a unit case for the clause that declines an entry inside a lower proposed entry's code. |
| code-quality-r1-2 | major | **Fixed** (`603863c`), with gate-honesty-r1-2; architecture §8.4 and §12 item 4 separate the owner's words from the inference. |
| code-quality-r1-3 | major | **Fixed** (`d4a956e`), with gate-honesty-r1-6. |
| code-quality-r1-4 | minor | **Fixed** (`1dc360f`): the dump records the digest of the dataset handed to the PoC; `bench run` and `bench poc-check` refuse a dump made on another dataset. |
| code-quality-r1-5 | minor | **Fixed** (`95b257b`: `test/unit/rom/bios.test.ts`; `e6b0831`: an end-anchor case that fails on the pre-`e764d41` code, which chose the same entry but skipped the word below the halfword unjudged). |
| code-quality-r1-6 | minor | **Fixed** (`2eb6b56`). |
| code-quality-r1-7 | minor | **Fixed** (`95b257b`, `2eb6b56`): the ramCopy comment names no symbols; `limits.ts` and `walk/arm.ts` say their bounds were measured on the five original tuning ROMs. |
| code-quality-r1-8 | minor | **Fixed** (`1dc360f`). |
| code-quality-r1-9 | minor | **Fixed** (`95b257b`: `isBiosCopy`; `1dc360f`: `baselineRowOf`, `noPocReference`). |

#### Per-commit replay (corrected)

`bench/tools/replay-regression.sh d645160 f802822` and `… f802822 8cd8857` at `d4a956e`'s script: for
`<from>` and each commit, in its own worktree with its own code and datasets, a fresh `bench run` (its
committed `results.json` deleted first) and `bench regression --base <the previous commit plus its fresh
artifact>`, so the trailers and the base datasets are checked. Shared with the checkout: `node_modules`
and `bench/.local` (the PoC dumps of `1dc360f`'s export, the corpus). Every `bench run` exited 0. The
"problems on the five" column counts regression problems on fe7j, klonoa, pokeemerald, sa2 and sa3; tmc's
row is tp / entries / false entries / agreeing extents / code end.

| Commit | bench | regression | Problems on the five | tmc problems | tmc row |
| --- | --- | --- | --- | --- | --- |
| `d645160` | 0 | (base) | 0 | (sealed) | (sealed: counts only) |
| `306eaf2` | 0 | 1 | 0 | 1 code-end, 7 unlisted-false-entry, 54 unlisted-miss | 8582 / 8589 / 7 / 8388 / -4130 |
| `abe9b1a` | 0 | 1 | 0 | 1 code-end, 7 unlisted-false-entry, 46 unlisted-miss | 8590 / 8597 / 7 / 8388 / -4130 |
| `67af08d` | 0 | 1 | 0 | 1 code-end, 7 unlisted-false-entry, 41 unlisted-miss | 8595 / 8602 / 7 / 8388 / -4130 |
| `8d207c0` | 0 | 1 | 0 | 1 code-end, 6 unlisted-false-entry, 40 unlisted-miss | 8596 / 8602 / 6 / 8388 / -4130 |
| `212d436` | 0 | 1 | 0 | 1 code-end, 6 unlisted-false-entry, 39 unlisted-miss | 8597 / 8603 / 6 / 8388 / -4130 |
| `6f9c9c4` | 0 | 1 | 0 | 1 code-end, 19 unlisted-false-entry, 6 unlisted-miss | 8630 / 8649 / 19 / 8388 / 148 |
| `b99a10d` | 0 | 1 | 0 | 1 code-end, 17 unlisted-false-entry, 6 unlisted-miss | 8630 / 8647 / 17 / 8388 / 148 |
| `72e97d8` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 6 unlisted-miss | 8630 / 8642 / 12 / 8388 / 148 |
| `5a715f3` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 5 unlisted-miss | 8631 / 8643 / 12 / 8388 / 148 |
| `747293f` | 0 | 1 | 0 | 1 code-end, 12 unlisted-false-entry, 5 unlisted-miss | 8631 / 8643 / 12 / 8388 / 148 |
| `80762ff` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `d1a7f60` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `bec649c` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `e3e08d8` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `72e6049` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `28b9005` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `808513f` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `74ec273` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `baa6161` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `09a712d` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `7dd367d` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `d099a0f` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `f39242a` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `e764d41` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `412a920` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `0c467b3` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `36aa61c` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `0d60765` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `d9f9623` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `9c8b282` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `f802822` | 0 | 0 | 0 | 0 | 8631 / 8643 / 12 / 8388 / 0 |
| `907f9e3` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `603863c` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `c083537` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `d4a956e` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `95b257b` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `7d7f298` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `1550acf` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `e6b0831` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `2eb6b56` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `1dc360f` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `50bfd05` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |
| `8cd8857` | 0 | 1 | 0 | 1 code-end | 8631 / 8643 / 12 / 8388 / 148 |

The five original tuning ROMs have no regression problem at any commit, and their tp, entries, false
entries and agreeing extents never change; their code end moves only at `d099a0f` (+8 and +4 → 0, the
withdrawn `$d` convention) and back at `907f9e3`. No commit has an `untrailered-row` problem: `80762ff`'s
trailers cover tmc's 17 rows. tmc's problems before `80762ff` are its rows not yet listed; from `907f9e3`
on, its one problem is the code end (+148) under the restored convention (Q5).

## The closing gate

The run at `9c8b282`, after fix round 1 of D60: a fresh worktree (`git worktree add --detach`, so no
`node_modules`, no `bench/.local`), working tree clean but for the `bench/results.json` the run rewrites,
every command from the worktree root with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`, the roadmap's exit list with the
orchestrator's additions and one of this round (`bench regression --base 74ec273`, romlift's own tmc row
as a floor), the real tier before the ci tier. `test/gates/phase.json` is `{ "landed": 1 }`.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 21 tests, 21 pass |
| `npm test` | 0 | 939 tests, 939 pass |
| `npm run fixtures -- check` | 0 | 41 of 41 fixtures agree (agbcc commit not named, the bytes decide) |
| `npm run bench -- doctor-real` | 0 | every ROM, ELF, PoC file and toolchain matches its digest |
| `npm run export-poc -- --mode scored` | 0 | six ROMs (tmc from romlift's dataset: 8,591 functions, 54 misses, scaffold OK), deterministic (257 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical (79 s) |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs re-read, parity matches the committed digest (51 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 19 tests, 19 pass |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | binutils, corpus and JUMP11 ok |
| `npm run corpus` | 0 | 100% round-trip, inputs digest `144770c8…` |
| `npm run bench -- run` | 0 | six rows (the table below); sealed: pokefirered pass, pokeruby pass; `results.json` written at `9c8b282` |
| `npm run bench -- speed` | 0 | ratio 0.961; fe7j 1,128 ms (limit 12,698), klonoa 236 (307), pokeemerald 2,122 (4,221), sa2 694 (783), sa3 1,057 (1,493), tmc 1,141 (1,785) |
| `npm run bench -- regression` | 0 | no regression against `92bf7ce` (the PoC-sourced main) |
| `npm run bench -- regression --base 74ec273` | 0 | no regression against `74ec273` (tmc's row of the previous round: tp 8,631, 8,388 agreeing extents) |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | five ROMs: rows equal, PoC row equal, scaffold OK, deterministic, pinned; tmc: rows equal the PoC's own row, PoC row n/a (no pinned baseline row), scaffold OK, deterministic, pinned |
| `npm run bench -- gates --require 2 --tier real` | **1** | pass: g1.bench-harness, g1.dataset-elf, g2.code-end (all six 0), g2.determinism, g2.entries (tmc tp 8,631, PoC 8,582 from its own run), g2.extents, g2.held-out (both sealed pass; both family conditions printed as WAIVED with their grounds), g2.no-unreviewed (8 datasets, 61 rows), g2.speed (ratio 0.983; klonoa 243 of 314 ms); **fail: g2.baseline-rows** (tmc: 8 rows without an accepted diff: false-entry-added 0x08008B2E, 0x080B197C, 0x080B1AA8, 0x080B1B0C, 0x080B21B0, 0x080B2718, 0x080B27E4; miss-changed 0x080B20AC), **g2.confirm-equals-discover** (tmc: first difference 0x08004274, extent end 0x08004356 in discover, 0x080042AC in confirm), **g2.poc-parity** (tmc: no parity evidence or committed digest); g3 to g6 pending (150 s) |
| `npm run bench -- gates --require 2 --tier ci` | 0 | every g1 gate passes (g1.provenance: source digest `17d95b9e…`, 2 real-tier gates of phase ≤ 1 pass); g2.checks-fail (4 files, 19 tests), g2.determinism, g2.regression, g2.rule-coverage (51 of 59 rules on 41 fixtures, 8 kept by D57), g2.rule-registry (59 rules), g2.second-profile (41 fixtures, 267 functions), g2.synthetic-analysis (41 fixtures), g2.vocabulary-emitted (10 miss reasons, 14 origins) pass; g3 to g6 pending (67 s) |
| `npm run bench -- provenance` | 0 | source digest current; gate record ok at phase ≤ 1; families live (scaffold, printer); 6 rows; no row of the 2 sealed datasets |
| `npm run bench -- stale-check` | 0 | the artifact is current |

Not done, as the orchestrator asked: pushing `phase-2`, the pull request to `main` and its CI workflows,
the merge and the tag. The runs at `808513f`, `22cbc77` and before are in the Git history of this file.

## Per tuning ROM, at `9c8b282`

| ROM | ELF functions | Entries | TP | PoC TP | Raw precision | Raw recall | Misses | False entries | Extents agreeing | Code end | Row diffs (unaccepted) | Analysis digest | Parity digest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,735 | 7,724 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 | +0 | 0 | `a1e91da5…` | `d2c87e51…` |
| klonoa | 559 | 557 | 556 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 | +0 | 0 | `518d9572…` | `49c42676…` |
| pokeemerald | 15,856 | 15,862 | 15,856 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,850 / 15,853 | +0 | 1 (0) | `698343b9…` | `d7348336…` |
| sa2 | 2,892 | 2,898 | 2,892 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,887 / 2,889 | +0 | 1 (0) | `bfa0a805…` | `ae83e802…` |
| sa3 | 4,693 | 4,699 | 4,693 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,305 / 4,307 | +0 | 1 (0) | `9c0fb964…` | `396939bf…` |
| tmc | 8,636 | 8,643 | 8,631 | 8,582 (its own run) | 99.86% | 99.94% | 5 | 12 | 8,388 / 8,388 | +0 | 59 (8) | `d8aac78c…` | `929cee1f…` |

The analysis digests equal those of `808513f` on all six ROMs: no analysis output changed in this round.
Sealed at `9c8b282`: pokefirered pass (precision 99.95%, recall 100.00%, glued 0, label candidates 0,
extents 12,383 / 12,386, code end 0), pokeruby pass (99.95%, 100.00%, 0, 0, 11,449 / 11,452, 0).

## Known limitations

- **Four gates fail on tmc, and `g2.held-out` on its two-families condition,** pending the owner (Q1 to
  Q5): `g2.poc-parity`, `g2.baseline-rows`, `g2.confirm-equals-discover`, `g2.code-end` (+148), and
  `g2.held-out` (pokefirered and pokeruby pass, both `pret-gen3`).
- **No held-out ROM of a family absent from the tuning set** (D60). `g2.held-out` waives the fresh-family
  condition by the owner's decision, bound to the sealed pair and the tuning families, and fails on the
  two-families condition until Q4 is answered; release 1 still needs a sealed pair of a fresh family (the
  reserve pool of benchmark-roms.md: Kirby & the Amazing Mirror, Pokémon Pinball; neither is on this
  machine).
- **tmc has no row in the pinned PoC baseline**; its PoC reference is the pinned PoC's own run of it
  (`export-poc --mode scored`), pinned by content in `bench/baseline/poc-dump-rows.json`, and it has no M1
  parity evidence.
- **A two-instruction ARM leaf after ARM code is read as Thumb**: tmc's `arm_sub_080B1FE4` (`ldrb r6, [r4,
  #21]; bx lr`) is found at the right address in the wrong mode, because the ARM gap scan needs three
  instructions; the bench scores addresses, not modes. The scaffold of phase 3 decides whether that
  matters (its bytes print either way).
- **The code end of an unsized last function** ends where it starts (the largest addr + size, every ROM):
  tmc's code end is +148 and fails `g2.code-end` until the owner answers Q5 (D60 j).
- **Single-instance rules**: every D60 rule, (a) to (h), decides rows on tmc only (their preconditions hold
  on other ROMs for (a), (e), (g) and (h), but disabling any of them moves no row there); their fixtures
  are self-authored. Generality needs a sealed ROM of a fresh family (D53).
- **The pool boundary of `seed.ram-copy` moved two unsized extents on tmc** (`sub_080B255C` now ends at
  0x080B299C, over three other functions' entries; `sub_080B2874` at 0x080B289C): no bench row moves (both
  are FUNCs of size 0), and the class (hand-written ARM with several entries whose extents depend on the
  order functions are taken) is the one of Q3.
- **3 s CPU.** Every tuning ROM's analysis is now under phase 3's budget under `epoch` (fe7j about 1.2 s since
  `accept.prologue-and-calls-accepted`, pokeemerald 2.0 s, tmc 1.1 s).
- **The speed ratchet on klonoa is tight in absolute terms:** its analysis takes about 0.22 to 0.25 s since
  `seed.ram-copy` (0.19 s before), against a limit of about 0.31 s.
- **The cartridge entry's extent covers the header** (correctness-6): discover reads `b` at 0x08000000
  before the startup code at 0x080000C0 is a function, so its extent is 0x08000000..0x080000FC and
  `explain` reports header bytes as owned by it; confirm mode agrees (M6). Bounding it changes an extent
  on every ROM and belongs with the header's emission in phase 3 (a claimed header region no extent may
  cover).
- **Past the analysis budgets the result is partial, by design** (D59 m): grow judges at most 262,144
  distinct candidates in a run, and fresh candidates past that are never judged; past 256 MiB of held
  readings a dropped reading is walked again, possibly against later facts. Each raises a warning once;
  no tuning ROM comes within an order of magnitude of either (13,431 distinct candidates at most). A
  flood's rejections and memory are bounded by the budgets, but its time is not: every grow round's
  harvest still enumerates the flood (fe7j plus a 16 MiB flood: 160 s, 1.98 GB peak RSS).
- Extent mismatches left: MultiSioIntr on sa2 and sa3, ld_r3_tp_adr_i on sa2, sa3 and pokeemerald,
  GameCubeMultiBoot_Main and GameCubeMultiBoot_Quit on pokeemerald.
