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
to 1 and re-ran the whole closing list at `9c8b282` in a fresh worktree. The adversarial review of `f802822` was
answered by fix round 2 of D60 (`907f9e3` to `2475b34`; "Review", below), which withdrew two more readings
the owner had not authorised and re-ran the whole closing list at `2475b34` in a fresh worktree ("The
closing gate", below). The owner's answers of 18 October 2026 to Q1 to Q5 (D61) and the review of `8fba183` were
implemented by fix round 3 of D60 (`3f7898f` to `b6b79e1`; "Review", below); the whole closing list ran at
`e1c3f64` with `phase.json` raised to 2 and, after it was lowered back, at `8c60bf5`, each in a fresh
worktree ("The closing gate", below).

**Verdict (after fix round 1 of D61).** Phase 2 does **not** land, on the same one gate and for the same
reason: `g2.confirm-equals-discover` fails on tmc's 0x080B255C and 0x080B2874 (owner question Q6). The
round answered the review of `5e18731`: the Q3 limitation is pinned by content and judged on every ROM;
the three tmc scopings are bound to tmc's ROM and ELF digests; the waiver dates are per condition;
`historicalCheck` is gone; `seed.ram-copy`'s far-`bl` target join, found never to fire, works, with a unit
case per stop of its argument scan; a fixture exercises the `$d` code end. One finding is partly asked
(the PoC-dump rescoring's code end, owner question Q7). Every command of the closing list exits 0 at
`2c96faa` but `bench gates --require 2 --tier real` (that gate alone). Rows, counts and analysis digests
equal `8c60bf5`'s on the six tuning ROMs and the sealed pair. `phase.json` stays `{ "landed": 1 }`;
nothing is merged or pushed.

**Verdict (after the owner's answers and fix round 3 of D60; superseded).** Phase 2 does **not** land, on one gate
outside the owner's answers. The answers (D61) are applied exactly as given and nothing else is waived:
Q1 and Q2 ("Keep tmc as 99.94%. It's a benchmark row that we can improve later": `g2.poc-parity` judges the
five M1 ROMs and prints tmc as not applicable; tmc a benchmark row in `g2.baseline-rows`, its 8 rows listed
with a category accepted, tp 8,631 a floor), Q3 ("Build resettle, else accept": `resettle` built at
`f287b0d`, measured to change rows on every other tuning ROM and the sealed pair, reverted at `af0f75c`;
tmc's six differences of Q3 a printed known limitation), Q4 ("Waive both") and Q5 ("Use $d for every ROM":
code end tmc +148 → 0, klonoa +4 → 0, fe7j +8 → 0). With `test/gates/phase.json` raised to `{ "landed": 2 }`
(`e1c3f64`) every command of the closing list exits 0 but `bench gates --require 2 --tier real`, `--tier
ci` and `bench provenance`, all from one gate: `g2.confirm-equals-discover` fails on tmc because, compared
in full, eight functions differ, not the six Q3 named: 0x080B255C and 0x080B2874 were moved by `95b257b`
after Q3's count was taken (owner question Q6). `g2.poc-parity` was `historical` with its own check
passing, and every other g1 and g2 gate passed. By the landing procedure `phase.json` is back at
`{ "landed": 1 }` (`8c60bf5`), where the closing list exits 0 everywhere but the real tier (the same gate).
The six tuning rows are unchanged from `8fba183` but the code end (all six now 0); pokefirered and pokeruby
pass sealed with unchanged counts. Nothing is merged or pushed.

**Verdict (after fix round 2 of D60; superseded).** Phase 2 does **not** land. Every command of the closing list
exits 0 at `2475b34` except the three `bench regression` runs and both `bench gates --require 2` tiers,
and every failure is on tmc or on `g2.held-out`'s two-families condition, each an owner question (Q1 to
Q5): real tier `g2.poc-parity` (tmc: no M1 evidence; Q1), `g2.baseline-rows` (tmc: 8 unaccepted rows;
Q2), `g2.confirm-equals-discover` (tmc, first difference 0x08004274; Q3), `g2.held-out` (both sealed ROMs
pass, both `pret-gen3`; the two-families condition is no longer waived on an inference; Q4) and
`g2.code-end` (tmc +148 under the restored phase-1 convention; Q5); ci tier `g2.regression` and the three
`bench regression` runs, on tmc's code end alone (Q5). No gate fails on fe7j, klonoa, pokeemerald, sa2 or
sa3, whose rows equal those of `9c8b282` but the code end of klonoa (+4) and fe7j (+8), back under the
phase-1 convention. tmc: tp 8,631, 5 listed misses, 12 listed false entries, 8,388/8,388 extents; its
analysis digest moved (`d8aac78c…` → `5c747e55…`, origins and two unsized extents) with no row change.
pokefirered and pokeruby pass sealed with unchanged counts. `test/gates/phase.json` stays
`{ "landed": 1 }`; nothing is merged or pushed.

**Verdict (after fix round 1 of D60; superseded by fix round 2).** Phase 2 does **not** land. The review found that the landing at
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

### The answers of 18 October 2026

Fix rounds 1 and 2 of D60 withdrew every gate change the owner had not authorised and asked five questions
(below, as they were asked). On 18 October 2026 the owner, Bruno Macabeus, answered them; his words,
verbatim, are in D61 with the meaning applied, and each is in the code that applies it:

| Question | The owner's words | Applied in |
| --- | --- | --- |
| Q1 `g2.poc-parity` on tmc | "Keep tmc as 99.94%. It's a benchmark row that we can improve later" | `test/gates/poc-parity-check.ts` `SCOPED_OUT` (D61 c): the gate judges the five ROMs of the M1 evidence exactly as before and prints "tmc: not applicable, no M1 lockstep run" |
| Q2 `g2.baseline-rows` on tmc | (the same words) | `test/gates/baseline-rows-verdict.ts` `BENCHMARK_ROWS` (D61 d): tmc's rows that the dataset lists with a category are accepted and printed; tp 8,631 of 8,636 (recall 99.94%) is a floor; the five as strict as before |
| Q3 `g2.confirm-equals-discover` on tmc | "Build resettle, else accept" | `f287b0d` built D8's `resettle`; it changes rows on the other ROMs and the sealed pair, so `af0f75c` reverted it; `test/gates/confirm-differences.ts` `KNOWN_DIFFERENCES` (D61 e) accepts tmc's six differences of Q3, pinned by content (each function's discover and confirm record and the one claim run, as measured at `9c8b282`), printed, and nothing else |
| Q4 the two-families waiver of `g2.held-out` | "Waive both" | `test/gates/held-out-verdict.ts` `FAMILY_WAIVER.grounds.twoFamilies` (D61 b): both family conditions waived and printed, bound to the sealed pair and the tuning families of D60 |
| Q5 the code-end convention | "Use $d for every ROM" | `bench/src/truth.ts` `elfCodeEnd` (D61 a): an unsized function ends at the `$d` or typed symbol that closes its last code run, every ROM, tuning and sealed, in every scorer (since fix round 2 of D61 the rescoring of the PoC's own dumps too; Q7 withdrawn); tmc +148 → 0, klonoa +4 → 0, fe7j +8 → 0, the others 0 |

These are the only gate changes made. No other gate, threshold or check was weakened, skipped or removed.
Since fix round 1 of D61 each tmc scoping (Q1, Q2, Q3) is bound to tmc's ROM SHA-1 and ELF SHA-256 as well
as its name (D61 f), and each waived family condition prints its own date and decision.

### Q6, open

6. **`g2.confirm-equals-discover` on two more tmc functions.** Q3 said "6 functions differ on tmc", a count
   taken at `9c8b282` (fix round 1 of D60). The closing runs since compared the views only up to their first
   difference, so nobody counted again; compared in full (`confirm-differences.ts`), tmc has eight differing
   functions at HEAD: the six of Q3 and two that `95b257b` (fix round 2 of D60, the pool boundary of
   `seed.ram-copy`, overfitting-r1-5) moved, 0x080B255C (discover's extent ends at 0x080B299C, confirm's at
   0x080B280C) and 0x080B2874 (0x080B289C against 0x080B299C), with three claim runs between 0x080B2874 and
   0x080B299C. They are the class of Q3 (two ARM entries proposed by one worklist and taken in ascending
   order, the lower one's reading running over the higher; both are unsized FUNCs, so no bench row moves).
   The answer names six, so the gate does not accept these two and fails on them, printing why. **May the
   known limitation cover these two functions as well (they would be printed with the six), or must they
   be fixed before phase 2 lands?** A fix would be a rule or driver change justified by its `restsOn`; the
   one remedy designed for the class, `resettle`, was measured and reverted under Q3. (Since fix round 1 of
   D61 the six are pinned by their records as measured at `9c8b282`, so a "yes" would add the two functions'
   discover and confirm records and the three claim runs, 0x080B2874..0x080B289C, 0x080B2874..0x080B299C and
   0x080B289C..0x080B299C, to `KNOWN_DIFFERENCES.tmc`, as measured.)

### Q7, withdrawn (fix round 2 of D61)

7. **The scorer the `$d` code end left out** (asked in fix round 1 of D61; withdrawn in fix round 2,
   gate-honesty-r1-1, overfitting-correctness-r1-4, code-quality-r1-2). Fix round 1 kept the rescoring of
   the PoC's own dumps (`bench poc-check`, `g1.bench-harness`) on the PoC's convention (`pocCodeEnd`) and
   asked whether it might stay so. The question was not needed: the meaning given with Q5 reads "for every
   ROM, tuning and sealed, in every scorer", which covers that scorer. Its text was also wrong in saying
   that no gate depended on the answer: the exception was what kept `g1.bench-harness` passing without a
   re-pin (scored under `$d` and compared field for field with the PoC's rows, the check would have failed
   on klonoa by 4 bytes, fe7j by 8 and tmc by 148). Since `921a421` the rescoring uses `elfCodeEnd`; the
   PoC's rows, the PoC's own output pinned by content (D50), are not rewritten: `poc-check` compares the
   rescored row with them as the scorer measures them and checks separately that they carry the PoC's
   convention (D61 a, fix round 2).

### The questions as asked (fix round 2 of D60)

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
| — | fix round 3 of D60 | D61: the owner's answers to Q1 to Q5, the review of `8fba183` ("Review", "Fix round 3 of D60"); the closing run below |

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

### Fix round 3 of D60 and the owner's answers

The owner's answers of 18 October 2026 (D61; "Owner questions", above) and the review of `8fba183` (fix
round 2 of D60) were implemented on `phase-2` from `3f7898f` to the record below, one concern per commit.
Every analysis change was measured with `bench run` on the six tuning ROMs and both sealed ROMs and `bench
regression` against the commit before it (and `--base 8fba183`); the replay of every commit is below.

| Finding or answer | Severity | Disposition |
| --- | --- | --- |
| Q5, the code end | owner | **Applied** (`3f7898f`, D61 a): `elfCodeEnd` ends an unsized function at the next `$d` or typed symbol, for every ROM, tuning and sealed, in the tuning and the sealed scorer; the PoC-dump rescoring keeps the PoC's convention (it reproduces the pinned rows, `g1.bench-harness`). tmc +148 → 0, klonoa +4 → 0, fe7j +8 → 0, pokeemerald, sa2, sa3, pokefirered, pokeruby 0 → 0; no other count or digest moves. |
| Q4, the family conditions | owner | **Applied** (`5228afd`, D61 b): both conditions waived with the owner's words, printed; the binding, the count of passing sealed ROMs and every per-ROM threshold unchanged. |
| Q1, `g2.poc-parity` | owner | **Applied** (`43a95be`, D61 c), with gate-honesty-r2-1. |
| gate-honesty-r2-1 | major | **Fixed** (`43a95be`): the gate's `historicalCheck` is its own check (`parityCheck`, the same function as `run`), so `historical` is recorded only when the check passes on its scope; `test/gates-index.test.ts` holds every historical gate to `historicalCheck === run`. |
| code-quality-r2-6 | minor | **Fixed** (`43a95be`): `gateStep` (the harness's branch) is unit-tested, and an end-to-end test runs a copy of the harness at `landed` 2 on a gate whose check throws (records `fail`) and one whose check returns (records `historical`). |
| Q2, `g2.baseline-rows` | owner | **Applied** (`8295282`, D61 d): tmc is a benchmark row; its 8 rows the PoC's run lacks are accepted as listed with a category, printed; tp 8,631 of 8,636 is a floor; an extent change, an unlisted or uncategorised row or a stale diff still fails; the five unchanged. |
| overfitting-r2-1 | major | **Fixed** (`f421a74`): `straightLineBefore` stops before a join point (branch, jump-table or far-`bl` target) and at an instruction that does not fall into the next (an unconditional exit, a `bl` walked as a jump or that never returns); negative fixture `ram-copy-args-straight-line` (the old scan proposes the false ARM entry 0x08000138). No row or digest moves on the eight ROMs. **Corrected in fix round 1 of D61** (overfitting-correctness-r0-1): the record said "unit cases for each stop"; only the branch-target join had one (the case labelled 'exit' is a branch-target case), and the far-`bl` target join never fired (it looked far sites up among `blSites`, which holds only calls). `90c4e88` fixes the join and adds a case per stop. |
| code-quality-r2-1 | major | **Fixed** (`1bbfa43`): a unit case pins `jumpInsns` (a jump 8 instructions after its load is found with 8, missed with 7); `argInsns` stays pinned by `ram-copy-setup-bound`. |
| overfitting-r2-2, gate-honesty-r2-5, code-quality-r2-3 | major/minor | **Fixed** (`1bbfa43`): re-measured, one count per site: copy calls 15 (3 (6), 4 (2), 6 (6), 7 (1)); jump load sites 46 (fe7j 1, klonoa 1, pokeemerald 1, sa2 2, sa3 2, tmc 39; 1 (40), 2 (2), 3 (3), 5 (1)). The old "39 jumps … 1 (33), 2 (2), 3 (2), 5 (1)" summed to 38 and was tmc's sites alone. Window sweeps: `jumpInsns` 1 to 16 give the same functions on the six (only jumps at 1 decide); `argInsns` 6 loses tmc's block. Profile comment and D60 (e) corrected. |
| Q3, `g2.confirm-equals-discover` | owner | **Applied** (`f287b0d` built `resettle`, `af0f75c` reverted it, `66159e9` recorded the limitation, D61 e). Measured with `resettle`: the startup region shrinks to one 4-byte piece on every ROM, startup pieces become unlisted false entries (fe7j 0x080000C0, 0x080001F8; pokeemerald 0x08000204, 0x08000248, 0x08000374; sa2, sa3, tmc 0x080000C0), the m4a mixer's extents change on pokeemerald, sa2 and sa3, the sealed counts move (entries 12,395 → 12,398, 11,461 → 11,464), the gate fails on klonoa, pokeemerald, sa2 and sa3; `bench regression`: 8 failures. The gate now compares the views in full and accepts tmc only with exactly the six functions of Q3; **it fails on two more** (Q6). |
| gate-honesty-r2-2, gate-honesty-r2-3 | major | **Fixed** (this record, D61, architecture §4.2, §4.5, §8.4, §12 item 4 and §13, roadmap phase 2, README): each states what is waived (the five answers, nothing else), the real gate status (one gate fails, Q6) and the numbers below. |
| architecture.md ramCopy shape | minor | **Fixed** (`1bbfa43`): `{ argInsns, jumpInsns }`, 12 and 8. |
| poc-check leftovers | minor | **Fixed** (`fbd28b7`): the revealed reference is computed only for a revealed ROM without a baseline row; no default "no pinned PoC row"; the text output says "missing" instead of "n/a" for a failing ROM. |
| loopCall duplication, opensFunction pool alignment, isPoolOf repeated work | minor | **Fixed** (`f438e9d`): one size path; `alignment.pool` from the profile; every accepted jump read at most once per queue call. No row or digest moves. |
| 'not re-measured' comments | minor | **Fixed** (`f32afd4`): measured on the six, tmc included: candidates judged at most 13,423 (pokeemerald; tmc 9,673); largest reading 11,570 instructions (klonoa; tmc 1,129); no all-zero instruction in an accepted reading; held candidate readings at most 208,344,064 bytes (pokeemerald, 78% of 256 MiB; tmc 112.8 MB). The "about 105 MB" recorded before was wrong (206 MB at `22cbc77`). One ARM instruction on tmc is classed otherwise than by the PoC (an `add pc, pc, #imm` ending a listed false entry's reading). |
| export-poc pin write order | minor | **Fixed** (`61c38f8`): every child first; dumps written after the rows are checked or pinned; `--pin` refuses a non-deterministic dump. |
| replay-regression parent | minor | **Fixed** (`c69268e`): each commit is judged against its own first parent's fresh artifact. |
| stale test comments | minor | **Fixed** (`307c28c`). |

#### Per-commit replay (fix round 3 of D60)

`bench/tools/replay-regression.sh 8fba183 307c28c` at `c69268e`'s script (each commit judged against its own
first parent's fresh artifact). Every `bench run` exited 0. Rows are tp / entries / false entries / agreeing
extents / code end.

| Commit | bench | regression | fe7j | klonoa | pokeemerald | sa2 | sa3 | tmc |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `8fba183` | 0 | (base) | 7724/7735/11/1471/8 | 556/557/1/485/4 | 15856/15862/6/15850/0 | 2892/2898/6/2887/0 | 4693/4699/6/4305/0 | 8631/8643/12/8388/148 |
| `3f7898f` | 0 | 0 | 7724/7735/11/1471/0 | 556/557/1/485/0 | 15856/15862/6/15850/0 | 2892/2898/6/2887/0 | 4693/4699/6/4305/0 | 8631/8643/12/8388/0 |
| `5228afd` … `1bbfa43` (4 commits) | 0 | 0 | the same | the same | the same | the same | the same | the same |
| `f287b0d` (resettle) | 0 | **1** | 7725/7738/13/1471/0 | 558/559/1/485/0 | 15856/15865/9/15850/0 | 2893/2900/7/2887/0 | 4694/4701/7/4305/0 | 8631/8644/13/8388/0 |
| `af0f75c` (its revert) | 0 | 1 | 7724/7735/11/1471/0 | 556/557/1/485/0 | 15856/15862/6/15850/0 | 2892/2898/6/2887/0 | 4693/4699/6/4305/0 | 8631/8643/12/8388/0 |
| `66159e9` … `307c28c` (7 commits) | 0 | 0 | the same | the same | the same | the same | the same | the same |

`f287b0d`'s regression: 8 unlisted false entries (the startup pieces: fe7j 0x080000C0, 0x080001F8;
pokeemerald 0x08000204, 0x08000248, 0x08000374; sa2, sa3, tmc 0x080000C0). `af0f75c`'s, judged against
`f287b0d`'s rows: true positives "fall" by the startup functions the resettle had counted (fe7j, klonoa, sa2,
sa3); it restores `1bbfa43`'s rows exactly. The analysis digests of every other commit equal `8fba183`'s.
The docs-only commits `b6b79e1`, `e1c3f64` and `8c60bf5` are covered by the closing runs below.

### Fix round 1 of D61

The review of `5e18731` (gate-honesty, overfitting-correctness and code-quality, round r0) was answered on
`phase-2` from `95852f3` to the record below, one concern per commit. The only analysis change
(`90c4e88`, `seed.ram-copy`'s far-`bl` target join) was measured with `bench run` on the six tuning ROMs and
the sealed pair: every analysis digest and count equals `8c60bf5`'s. No gate, threshold or check was
weakened; four were tightened (the Q3 limitation, the three tmc scopings).

| Finding | Severity | Disposition |
| --- | --- | --- |
| gate-honesty-r0-1 | major | **Fixed** (`3e2480f`): `KNOWN_DIFFERENCES.tmc` pins each of the six functions' discover and confirm records (mode, extent, far verdicts) and the one differing claim run (0x080087D2..0x08008886: discover owner 0x08008790, confirm none), measured at `9c8b282` and identical at `95b257b^` and `5e18731` (a probe of both views at each). tmc passes only when its differences equal those records exactly: a known function cut elsewhere, switched mode, given far verdicts or gone from confirm fails as "the known difference changed"; any other claim run fails wherever it lies, inside a known extent included. Unit cases for each. |
| gate-honesty-r0-2, overfitting-correctness-r0-2, code-quality-r0-1 | minor, minor, major | **Fixed** (`3e2480f`): the gate judges every ROM, equal digests or not, so all six gone is a stale record and fails; a record whose ROM is not a tuning dataset fails as stale (`staleRecords`); a digest difference with no differing function or claim run fails too. Unit cases for all six gone and for an absent ROM. |
| overfitting-correctness-r0-3, code-quality-r0-2 | minor | **Fixed** (`3e2480f`): the Q6 text is `notCovered` keyed by 0x080B255C and 0x080B2874; any other extra function prints "not covered by D61 e". |
| code-quality-r0-3 | minor | **Fixed** (`3e2480f`): every failure message gives the counts of differing functions and claim runs and the first four of each; the per-ROM note adds both counts. |
| code-quality-r0-4 | minor | **Fixed** (`3e2480f`): the per-ROM notes are written before the throw, so the failure detail keeps them (D59 q). |
| gate-honesty-r0-4, code-quality-r0-8 | minor | **Fixed** (`95852f3`): each waived condition carries its own text, date and decision; the gate prints the two-families waiver as 2026-10-18 (D61 b) and the fresh-family one as 2026-10-17 (D60). The `pending` field, set by no production waiver, is removed. |
| overfitting-correctness-r0-4 | minor | **Fixed** (`3e2480f`, `151e000`, `525b324`; D61 f): `KNOWN_DIFFERENCES.tmc`, `BENCHMARK_ROWS.tmc` and `SCOPED_OUT.tmc` hold tmc's ROM SHA-1 and ELF SHA-256 (`test/gates/dataset-binding.ts`, pinned to `bench/dataset/real/tmc.json` by a unit case); another build of that name ends the scoping, which fails as stale, and tmc is judged as without it. |
| code-quality-r0-5 | minor | **Fixed** (`525b324`): `Object.keys(scopedOut).sort(byCodeUnit)`. |
| code-quality-r0-6 | minor | **Fixed** (`525b324`): `GateSpec.historicalCheck` is removed; a frozen gate runs `run` and records `historical` when it returns, `fail` when it throws. The dead record branch and the duplicated key are gone; `test/gates-index.test.ts` holds a historical gate to `needs: []` and no inputs, since it runs before exports load or inputs are checked. architecture §0, §4.5 and the `GateSpec` sketch updated. |
| code-quality-r0-7 | minor | **Fixed** (`525b324`): the `gateStep` and harness end-to-end tests are in `test/unit/gates/gate.test.ts`. |
| overfitting-correctness-r0-1 | major | **Fixed** (`90c4e88`), and it found a defect: the far-`bl` target join never fired, because it looked the far sites up among `blSites`, which holds only the `bl` walked as calls; it now reads each far and noret site's target from the instruction. One unit case per stop, each failing when its own clause is removed and passing otherwise (mutation-checked: drop the exit stop, the far/noret stop, the far-`bl` join, the table join, the branch join): a jump-table case label falling into the copy call; a far-`bl` target falling into it; an exit, and a noret or far `bl` (with r4..r6 carried into r0..r2), laid out right before the entry, which the reading reaches by a backward branch. The exit and far/noret stops are reached without a join only there, at the entry, which is not a join point. phase-2.md's overfitting-r2-1 row corrected. No digest moves. **Corrected in fix round 2 of D61** (code-quality-r1-3, overfitting-correctness-r1-1): the noret-target join had no case, and the entry and returning-`bl` targets were not joins; the `bl` target join now covers every `bl` with one clause and a case, the entry is a join, and the exit and far/noret stops decide no case alone (`c2822a8`). |
| code-quality-r0-9 | minor | **Fixed** (`90c4e88`, reworded): the fixture index says `ram-copy-args-straight-line` covers the two stops together and the unit cases each; the fixture is not split (the unit cases make each stop load-bearing). |
| gate-honesty-r0-3, overfitting-correctness-r0-5 | minor | **Partly fixed, partly asked.** D61 quotes the Q5 meaning as given ("in every scorer") and names the PoC-dump rescoring's `pocCodeEnd` as an interpretation the owner may overrule (new owner question Q7). Fixed (`2d758ab`): `committed.test.ts` holds every fixture codeEnd to `elfCodeEnd` and needs a fixture where the conventions differ, the new negative fixture `code-end-unsized-last` (an unsized last function, then an OBJECT opening with `$d`: ELF and analysis code end 0x08000108, addr + size 0x08000100); `elfCodeEnd` unit cases for `$d.N` and SECTION. |
| code-quality-r0-10 | minor | **Fixed** (`3e2480f`, `2d758ab`): the dead ternary went with the rewritten test; `score.test.ts` asserts the exact `{found 0x08000710, elf 0x08000600, delta 0x110}`. |

Observed, not changed (changed in fix round 2 of D61, `c2822a8`): the reading's entry is not a join point of `seed.ram-copy`'s argument scan, so if code
laid out before an entry falls into it (an entry that is also a loop head reached by a backward branch), the
scan would read across the entry with the loop's register values. No reviewer finding names it, and changing
it is an analysis change of its own to measure; it is listed under "Known limitations".

### Fix round 2 of D61

The review of `9262e2a` (gate-honesty, overfitting-correctness and code-quality, round r1) was answered on
`phase-2` from `490df96` to the record below. The two analysis-side changes (`490df96`, the ELF code end;
`c2822a8`, `seed.ram-copy`'s join points) were measured with `bench run` on the six tuning ROMs and the
sealed pair: every row, count, code end and analysis digest equals `2c96faa`'s. No gate, threshold or check
was weakened: the PoC-dump rescoring now applies `$d` as the meaning given with Q5 says, with the PoC's
numbers still reproduced under the PoC's ruler, and one check was tightened (stale benchmark rows).

| Finding | Severity | Disposition |
| --- | --- | --- |
| code-quality-r1-1 | major | **Fixed** (`a2a5e8d`): architecture §4.2 states the pinned-by-content rule of D61 e (exact records, any other claim run fails wherever it lies, every ROM judged, the digests only a cross-check, counts and the first four in every message) and the D61 f binding; §4.5 states the binding of the three tmc scopings next to `BENCHMARK_ROWS` and `SCOPED_OUT`, with the staleness rules; §2's test tree lists the gate helpers; the `g2.confirm-equals-discover` header says the verdict comes from `viewDifferences`/`judgeDifferences`. |
| code-quality-r1-2 | major | **Fixed** (`921a421`, `a2a5e8d`): Q7 is withdrawn, with the correction that the exception did keep `g1.bench-harness` passing without a re-pin; D61 (a) and the Known limitations say the same. |
| gate-honesty-r1-1, overfitting-correctness-r1-4 | minor | **Fixed** (`921a421`): `scoreRun` uses `elfCodeEnd`, so every scorer measures the code end with `$d`. The pinned PoC rows are not rewritten (they are the PoC's output, pinned by content, D50, and the PoC's fresh run reproduces them; re-pinning them would make the PoC-row check fail on fe7j and klonoa): `bench poc-check` compares the rescored row with each reference as the scorer measures it (`asScored`: `codeEnd.elf` the `$d` end, the delta from the reference's own found end) and checks separately that the reference carries the PoC's convention on that ELF, the "separate check that the PoC's own convention reproduces the PoC's numbers" the finding allows. Measured: `bench poc-check` exit 0; rescored PoC rows fe7j +8 → 0, klonoa +4 → 0, tmc's PoC row −4,130 → −4,278; romlift's rows unchanged. |
| gate-honesty-r1-2 | minor | **Fixed** (`490df96`): the case restored (big at 0x08000101 size 0x400, then unsized `only` at 0x08000400: 0x08000500), with the variant that has a `$d` at 0x08000420 after `only`. |
| overfitting-correctness-r1-2 | minor | **Fixed** (`490df96`): an unsized function ends at the first `$d` or typed symbol after its last code mapping symbol before the next typed symbol; unit cases `$t, $d, $t, $d` and a code mapping symbol past the next typed symbol; docstring corrected. Every code end unchanged on the eight ROMs (fe7j 0x080C0C50, klonoa 0x08051BD4, pokeemerald 0x082E952E, sa2 0x080979F6, sa3 0x080CE438, tmc 0x080B2A30, sealed 0). |
| overfitting-correctness-r1-3 | minor | **Fixed** (`c97ee32`): `code-end-unsized-last` has an untyped pool (`$d`, no `.type`) between `Last` and the OBJECT: `$d` 0x08000108 (the expectation), next typed symbol 0x08000110, addr + size 0x08000100. Mutation-checked: ending code at typed symbols alone fails `committed.test.ts`. |
| overfitting-correctness-r1-1 | minor | **Fixed** (`c2822a8`): the reading's entry and the target of every `bl` in blSites are joins. The two cases that asserted the gap now expect nothing (the far-`bl` case walked as a returning call; the entry case with a returning `bl`), and a new assertion reads the same code from +0, where BLOCK + 8 is proposed. The "not a join point" known limitation is removed. The docstring says the exit and far/noret stops lie only right before a join and decide nothing alone. Measured: digests unchanged on the eight ROMs (as the reviewer measured). |
| code-quality-r1-3 | minor | **Fixed** (`c2822a8`): the noret target is a join through the blSites clause (a noreturn `bl` is recorded there), so the separate noret loop is gone; a unit case has the copy call as the target of a noreturn `bl` that the reading also reaches by fall-through (nothing proposed), and its control (the `bl` aimed past the call: proposed). Mutation-checked: dropping the entry join fails 1 case, the blSites join 2, the far join 1, both stops 0. Header and docstring name every join; fix round 1's disposition corrected above. |
| code-quality-r1-4 | minor | **Fixed** (`5413db8`): `staleBenchmarkRows` fails a `BENCHMARK_ROWS` record whose ROM is not a tuning dataset or whose PoC reference is not `dump`; unit cases for each. |
| code-quality-r1-5 | minor | **Fixed** (`5413db8`): uncovered and changed functions and changed claim runs are reported with their count and the first four (the `notCovered` reason kept on the ones shown); a unit case with six uncovered functions. |
| code-quality-r1-6 | minor | **Fixed** (`5413db8`): one `DatasetIdentity` type from `dataset-binding.ts` in `bindingMismatch`, `judgeDifferences`, `baselineRowsVerdict` and `parityCheck`; `byCodeUnit` in `test/gates/order.ts`, re-exported by `gate.ts`, its twelve private copies in `test/gates` and `dataset-binding.ts`'s export gone. Not done, the optional part: one field set for the four scoping records; their fields print the owner's words and decisions as recorded, and renaming them changes no verdict. |
| code-quality-r1-7 | minor | **Fixed** (`5413db8`): `test/unit/gates/dataset-binding.test.ts` pins `TMC_AT_D61` to `bench/dataset/real/tmc.json` (static import) and tests `bindingMismatch` directly (equal, other ROM, other ELF, no ELF digest); the pin left `baseline-rows-verdict.test.ts`. |

## The closing gate

The whole list in a fresh worktree (`git worktree add --detach`: no `node_modules`, no `bench/.local`) at
`2c96faa` (fix round 1 of D61), every command from the worktree root with
`ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`, the real tier before the ci tier, the
working tree clean afterwards but for the `bench/results.json` the run rewrites (`poc-digests.json` and
`poc-dump-rows.json` byte-identical after the export); that `results.json` is the committed artifact.
`test/gates/phase.json` stays `{ "landed": 1 }`: the one failing gate is outside the owner's answers
(Q6), so a landing attempt at `landed` 2 would fail on it as at `e1c3f64`, and it was not repeated. The
list is the previous round's with `bench regression --base 5e18731` added (that round's rows as a floor).

| Command | Exit at `2c96faa` | Output |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npm run typecheck` | 0 | |
| `npm run lint` | 0 | 21 tests, 21 pass |
| `npm test` | 0 | 983 tests, 983 pass |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (agbcc commit not named, the bytes decide) |
| `npm run bench -- doctor-real` | 0 | every ROM, ELF, PoC file and toolchain matches its digest |
| `npm run export-poc -- --mode scored` | 0 | six ROMs, scaffold OK, deterministic (240 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical (75 s) |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs re-read (49 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 19 tests, 19 pass |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | binutils, corpus and JUMP11 ok |
| `npm run corpus` | 0 | 100% round-trip, inputs digest `144770c8…` |
| `npm run bench -- run` | 0 | six rows equal to `8c60bf5`'s (below); sealed: pokefirered pass, pokeruby pass, counts unchanged |
| `npm run bench -- speed` | 0 | ratio 0.960; fe7j 1,074 ms (limit 12,692), klonoa 259 (306), pokeemerald 2,084 (4,219), sa2 630 (783), sa3 981 (1,492), tmc 1,299 (1,784) |
| `npm run bench -- regression` | 0 | no regression against `92bf7ce` (the PoC-sourced main) |
| `npm run bench -- regression --base 74ec273` | 0 | no regression |
| `npm run bench -- regression --base f802822` | 0 | no regression |
| `npm run bench -- regression --base 8fba183` | 0 | no regression |
| `npm run bench -- regression --base 5e18731` | 0 | no regression |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | five ROMs: rows equal, PoC row equal, scaffold OK, deterministic, pinned; tmc: rows equal the PoC's own row, PoC row equal to the pinned one |
| `npm run bench -- gates --require 2 --tier real` | **1** | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end (every delta 0), g2.determinism, g2.entries, g2.extents, g2.held-out (both sealed ROMs pass; WAIVED two families on 2026-10-18, D61 b; WAIVED fresh family on 2026-10-17, D60), g2.no-unreviewed (8 datasets, 61 rows), g2.poc-parity (tmc not applicable), g2.speed (ratio 0.951); **fail: g2.confirm-equals-discover**: tmc 0x080B255C and 0x080B2874 "not covered by D61 e" (Q6) and the 3 claim runs between 0x080B2874 and 0x080B299C; KNOWN LIMITATION printed: 6 of 6 known functions and 1 of 1 known claim runs differ as recorded; fe7j, klonoa, pokeemerald, sa2, sa3 0 differences; g3 to g6 pending |
| `npm run bench -- gates --require 2 --tier ci` | 0 | every g1 and g2 ci gate passes (g2.rule-coverage 51 of 59 rules on 47 fixtures, 8 kept by D57; g2.second-profile 47 fixtures, 310 functions; g2.synthetic-analysis 47 fixtures; g2.regression); g3 to g6 pending |
| `npm run bench -- provenance` | 0 | source digest `f7986efb…` current, gate record ok at phase ≤ 1, families live, 6 rows, no row of the 2 sealed datasets |
| `npm run bench -- stale-check` | 0 | the artifact is current |

Not done: pushing `phase-2`, the pull request to `main` and its CI workflows, the merge and the tag. The
runs at `e1c3f64`, `8c60bf5`, `2475b34`, `9c8b282`, `808513f`, `22cbc77` and before are in the Git history of
this file.

## Per tuning ROM, at `2c96faa` (equal to `8c60bf5`)

| ROM | ELF functions | Entries | TP | PoC TP | Raw precision | Raw recall | Misses | False entries | Extents agreeing | Code end | Row diffs (unaccepted) | Analysis digest | Parity digest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,735 | 7,724 | 7,724 | 99.86% | 99.86% | 11 | 11 | 1,471 / 1,471 | +0 (+8 before Q5) | 0 | `a1e91da5…` | `d2c87e51…` |
| klonoa | 559 | 557 | 556 | 556 | 99.82% | 99.46% | 3 | 1 | 485 / 485 | +0 (+4 before Q5) | 0 | `518d9572…` | `49c42676…` |
| pokeemerald | 15,856 | 15,862 | 15,856 | 15,856 | 99.96% | 100.00% | 0 | 6 | 15,850 / 15,853 | +0 | 1 (0) | `698343b9…` | `d7348336…` |
| sa2 | 2,892 | 2,898 | 2,892 | 2,892 | 99.79% | 100.00% | 0 | 6 | 2,887 / 2,889 | +0 | 1 (0) | `bfa0a805…` | `ae83e802…` |
| sa3 | 4,693 | 4,699 | 4,693 | 4,693 | 99.87% | 100.00% | 0 | 6 | 4,305 / 4,307 | +0 | 1 (0) | `9c0fb964…` | `396939bf…` |
| tmc | 8,636 | 8,643 | 8,631 | 8,582 (its own run, pinned) | 99.86% | 99.94% | 5 | 12 | 8,388 / 8,388 | +0 (+148 before Q5) | 59 (8, accepted as listed with a category by Q2) | `5c747e55…` | `ea700ad0…` |

Sealed at `8c60bf5` (counts only): pokefirered pass (12,395 entries for 12,389 ELF functions, tp 12,389,
precision 99.95%, recall 100.00%, glued 0, label candidates 0, extents 12,383 / 12,386, code end 0, false
entries startup 4, inside an ELF function 6), pokeruby pass (11,461 for 11,455, tp 11,455, 99.95%, 100.00%,
0, 0, 11,449 / 11,452, 0, startup 4, inside 6). The analysis digests of all six equal those of `8fba183`;
only the code end moved (Q5). At `2c96faa` every row, count and analysis digest is the same as at
`8c60bf5`. `results.json` meta: commit `2c96faa`, dirty false, source digest `f7986efb…`, Node 24.

## Known limitations

- **`g2.confirm-equals-discover` fails on tmc (Q6)**: eight functions differ between confirm and discover,
  the six of Q3, which the owner's answer accepts as a known limitation and the gate prints (pinned by
  their records since fix round 1 of D61), and 0x080B255C and 0x080B2874, moved by `95b257b` after Q3's
  count, with three claim runs; phase 2 does not land until the owner answers Q6.
- **D8's `resettle` stage is not built**: measured at `f287b0d` and reverted, because re-reading every
  function under the final set cuts the cartridge entry at the startup piece and the m4a mixer at its inner
  entries on every ROM (D61 e).
- **tmc is a benchmark row**, not held to the PoC-comparison gates (D61 c, d): its 8 rows the PoC's own
  run lacks are accepted because the dataset lists them with categories, and its tp 8,631 is a floor.
- **No held-out ROM of a family absent from the tuning set** (D60). `g2.held-out` waives both family
  conditions by the owner's decision and answer (D60, D61 b), bound to the sealed pair and the tuning
  families; release 1 still needs a sealed pair of a fresh family (the
  reserve pool of benchmark-roms.md: Kirby & the Amazing Mirror, Pokémon Pinball; neither is on this
  machine).
- **tmc has no row in the pinned PoC baseline**; its PoC reference is the pinned PoC's own run of it
  (`export-poc --mode scored`), pinned by content in `bench/baseline/poc-dump-rows.json`, and it has no M1
  parity evidence.
- **A two-instruction ARM leaf after ARM code is read as Thumb**: tmc's `arm_sub_080B1FE4` (`ldrb r6, [r4,
  #21]; bx lr`) is found at the right address in the wrong mode, because the ARM gap scan needs three
  instructions; the bench scores addresses, not modes. The scaffold of phase 3 decides whether that
  matters (its bytes print either way).
- **The PoC's pinned rows carry the PoC's code-end convention** (addr + size): every scorer, the PoC-dump
  rescoring included, measures the code end with `$d` (D61 a), and the PoC's rows, its own output pinned by
  content, are not rewritten, so `bench poc-check` compares with them as the scorer measures them and
  checks separately that they carry the PoC's convention; in the files, the PoC's `codeEnd.elf` of klonoa,
  fe7j and tmc is 4, 8 and 148 bytes below romlift's.
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
  readings a dropped reading is walked again, possibly against later facts. Each raises a warning once.
  No tuning ROM reaches either, but the reading budget is close on pokeemerald: 208,344,064 bytes held in
  one epoch, 78% of it (measured on 18 October 2026; the "order of magnitude" recorded before was wrong;
  candidates judged at most 13,423). A
  flood's rejections and memory are bounded by the budgets, but its time is not: every grow round's
  harvest still enumerates the flood (fe7j plus a 16 MiB flood: 160 s, 1.98 GB peak RSS).
- Extent mismatches left: MultiSioIntr on sa2 and sa3, ld_r3_tp_adr_i on sa2, sa3 and pokeemerald,
  GameCubeMultiBoot_Main and GameCubeMultiBoot_Quit on pokeemerald.
