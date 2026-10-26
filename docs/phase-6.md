# Phase 6: Evidence

The record of phase 6 (roadmap "Phase 6", architecture §2.1, §6.6 to §6.8, §7, §8.4, §13, D9, D21, D24, D31, D32, D34,
D35, D40, D46, D68 a, D76 g, D91 to D93). It is kept by the phase lead: the components as they merge, every deviation
from the roadmap, the owner questions, the known limitations, the measured numbers and the closing gate. Every number
is measured on the owner's machine with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. The tuning set is six ROMs (fe7j, klonoa, pokeemerald,
sa2, sa3, tmc; D60), and every phase-6 threshold applies to all six; the held-out ROMs (pokefirered, pokeruby) run sealed
and report counts only (D25).

Phase 6 starts from `main` at `89deb54` (phase 4 merged by pull request #4, tag `phase-4`, `test/gates/phase.json` `{
"landed": 4 }`). Phase 5 was skipped by the owner and never lands (D92), so this phase raises `phase.json` from 4 to 6.

**Verdict after fix round 5 (D104, run 6): PHASE 6 PASSES ITS CLOSING GATE.** The review of fix round 4 raised one
major (`g4.toml-mutations`' add-override edit did not change the model) and fifteen minors; all are fixed or recorded,
none needed an owner question ("Review", fix round 5). The whole closing list ran again in a fresh worktree at `d66d802`
(`landed` 6), and every one of its 20 commands exits 0 (run 6): `gates --require 6 --tier real` 29 pass and 1
historical, `--tier ci` 46 of 46, `bench provenance` ok. `bench/results.json` is committed as run 6's artifact.

**Verdict of the closing run after fix round 4 (run 5): PHASE 6 PASSES ITS CLOSING GATE.** With every owner question
answered (D98, D100 to D103) and applied, the whole closing list ran in a fresh worktree at `fa5d7ab`
(`romlift-wt/phase-6-closing-5`, `landed` 6, only `bench/.local/poc` and `bench/.local/agbcc` copied in), the real tier
before the ci tier, and every one of its 20 commands exits 0 (run 5, "The closing gate"): `gates --require 6 --tier
real` 29 pass and 1 historical (`g2.poc-parity`), `--tier ci` 46 of 46 pass, `bench provenance` ok on every check.
The owner's answers changed no command of the list. `bench/results.json` is committed as run 5's artifact. What is
left is the merge: the phase pull request with its CI workflows, or, if GitHub refuses to start the jobs, the checks
those jobs run, run locally (the owner's landing answer, D103); the merge carries `{ "landed": 6 }`.

**Fix round 4, step 1 (D98, D99): not landed yet.** The owner answered every open question on 25 October 2026. This
step applied his gate edits and records (Q1 to Q3, Q5, Q8, Q9, Q11, Q13, Q14): `g6.reconciler`, `g6.rename` and
`g6.evidence-conflict` now pass on the ci tier, `g6.signatures-judged` holds tmc to the floor he set, and
`g4.toml-mutations` makes an add-override edit that changes the model and refuses an odd `[functions]` key, on both
tiers; it fixed seven of fix round 3's nine carried minors ("Review", fix round 4, step 1). The round's later steps
apply Q10, Q12, Q6 with Q15, and Q16, then run the closing list.

**Fix round 4, step 2 (D100): not landed yet.** Q10 applied as the owner chose (option (c)): the confirm run validates
a listed extent per inner label's mode and takes a fall-through into the next listed function as an exit; no
`W_LISTED_INVALID` on the six tuning ROMs after `init` with signatures (17 before), pinned by
`test/local/listed-invalid-signatures`; `decompiled-c` runs `init` with signatures again ("Review", fix round 4,
step 2).

**Fix round 4, step 3 (D101): not landed yet.** Q12 and Q16 applied as the owner chose (options (b) and (a)): each
objdiff target is its unit's assembly as it is, at `build/expected/<module>.o`, so objdiff scores every function of an
untouched sa1 (2,013) and klonoa (422) project at 100% (33 and 51 below before); `g6.expected-bytes` links every target
at its module's address and judges its bytes and symbols there, `runs_at` modules included (the RAM-copy fixture with
its override joins its targets); `make expected` writes nothing under `expected/` (correctness-r2-2) ("Review", fix
round 4, step 3).

**Fix round 4, step 4 (D102): not landed yet.** Q6 and Q15 applied as the owner chose ("Printer spells sym+addend,
then ceiling"): the printer spells a word inside a named, sized entry `sym + addend` by one rule the label scopes read
(`resolver.ts wordNameOf`), the bench's `objectWords` rewrite and `--own-spelling` are gone, D34 reports the same-word
differences and the uncompared functions (`missing-symbol`, `tool`), and `g6.objdiff` passes on the real tier with each
tuning ROM's gated count at its ceiling in `bench/baseline/objdiff-ceiling.json`: fe7j 7, klonoa 1, pokeemerald 12,
sa2 1, sa3 4, tmc 25 (Q6, "Review", fix round 4, step 4). The round's last step runs the closing list.

**Verdict after fix round 3 (D97): still NOT LANDED.** The review of fix round 2 (`b64f0b7`) raised 11 findings: one
major (correctness-r2-1, a `runs_at` module named `text` or `c_data_<m>` broke the link), fixed in this round, and ten
minors, nine carried and one an owner question (Q16) ("Review", fix round 3). The orchestrator asked to land the phase; it cannot: the fourteen owner
questions below (Q1 to Q3, Q5, Q6, Q8 to Q16) are unanswered, and the gates that wait on them fail as run 4 measured
(`g6.objdiff` on the real tier; `g6.reconciler`, `g6.rename`, `g6.evidence-conflict` and `g1.provenance` on the ci
tier; `bench provenance`). No gate file is changed, no pull request is opened, nothing is merged or tagged, and the
branch is not pushed. The full closing list was not run again: the fix changes only the model's refusals (the emitted
ldscript is unchanged, no golden moved), and the commands it touches were run (below, fix round 3).

**Verdict after fix round 2 (D96): still NOT LANDED.** The review of fix round 1 raised 16 findings; 14 are fixed, one
is owner question Q15 (the bench's `objectWords` rewrite inside `g6.objdiff`) and one is rejected with a measurement
("Review", fix round 2). The closing list ran a fourth time in a fresh worktree at `41b9eae` (run 4 below): every
command exits 0 but the two gate runs and `bench provenance`. The real tier fails `g6.objdiff` (unchanged: fe7j 19,
klonoa 131, pokeemerald 157, sa2 4, sa3 55, tmc 17) and, this run, `g3.speed-budget`, because `bench speed` measured
sa2's analysis at 791.3 ms against a 787.2 ms limit (100.5%); the same commit measured 764.5 and 765.3 ms (limits 787.6,
808.3) in two later `bench speed --only sa2` runs, the code before fix round 2's `le32` change 766.5 and 769.9 ms, and
the gate alone passed on a rerun (sa2 783 ms): the phase-4 spread of sa2 against its limit, not a regression. The ci
tier fails `g6.reconciler`, `g6.rename`, `g6.evidence-conflict` (gate files that cannot pass as written, Q2, Q3, Q5)
and `g1.provenance`, and `bench provenance` fails on the artifact's gate records (`g3.speed-budget`, `g6.objdiff`). The
tightened `g6.expected-bytes` passes on both tiers (448 modules on 60 ROMs). The phase waits for the owner's answers to
Q1 to Q3, Q5, Q6 and Q8 to Q15; nothing is merged, pushed or opened as a pull request.

**Verdict after fix round 1 (D95): still NOT LANDED.** The review's 38 findings are fixed or recorded ("Review"); the
closing list ran a third time in a fresh worktree at `e8043cc` (run 3 below) with the same four failing commands and
the same failing gates: `g6.objdiff` on the real tier (gated differences unchanged, fe7j 19, klonoa 131, pokeemerald
157, sa2 4, sa3 55, tmc 17), `g6.reconciler`, `g6.rename`, `g6.evidence-conflict` and `g1.provenance` on the ci tier,
and `bench provenance` on the `g6.objdiff` record. Every other gate passes, `test:local` included (121 of 121). The
phase waits for the owner's answers to Q1 to Q3, Q5, Q6 and Q8 to Q14; nothing is merged, pushed or opened as a pull
request.

**Verdict of the closing record. NOT LANDED.** Waves 1 to 3 are merged on `phase-6`, the closing round fixed what failed in the code (the
signature matcher, the leave-one-out count, the objdiff family's map, one local test), `test/gates/phase.json` is at `{
"landed": 6 }` on the branch only, and the closing list ran twice in fresh worktrees ("The closing gate"). It does not
pass: `npm run bench -- gates --require 6 --tier real` fails `g6.objdiff` (Q6: D34 as written, the gated differences
fe7j 19, klonoa 131, pokeemerald 157, sa2 4, sa3 55, tmc 17), `--tier ci` fails `g6.reconciler` (Q2), `g6.rename` (Q3),
`g6.evidence-conflict` (Q5) and `g1.provenance` (the committed artifact records `g6.objdiff` failing), and `bench
provenance` fails on that gate record. Each of those is a gate the owner has not changed in his own words, so the phase
waits for his answers to Q1 to Q3, Q5, Q6 and Q8 to Q11 below. Nothing is merged to `main`, no pull request is opened
and nothing is pushed: the phase lands only when every command of "The closing gate" exits 0 at `landed` 6 in a fresh
worktree, every owner question is answered, and the phase pull request's CI ran (a job GitHub refuses to start is not
a pass).

## What the phase delivered

- **Library signatures** (roadmap 6.A, 6.B; architecture §7). Specs in `signatures/specs/` for six libraries (m4a with
  versions 2001 and 2004, libagbsyscall, libgcc, agb_flash, siirtc, librfu; every reference a tuning dataset, D32);
  `romlift signatures build <spec> [--out <dir>] [--json]` builds the gitignored `signatures/<library>.json` (schema 3,
  members keyed `name@object.o`, D31, D40) from each reference's ROM, ELF, map and discover analysis; `romlift
  signatures <rom> [--json]` prints the settled placements with their `sig.*` rule ids (`sig.unique-fit`,
  `sig.link-order-run`, `sig.neighbour-spacing`, `sig.pinned-both-sides`, `sig.short-member-window`) and the library
  regions; `npm run bench -- signatures [--only <rom>] [--loo] [--json]` (`romlift/bench-signatures@1`,
  `romlift/bench-signatures-loo@1`) and the `signatures` family of `bench run`.
- **Proposals** (6.D). `init` (unless `--no-signatures`) and `analyze --update` fold signature proposals into the config:
  names, sizes, `from = "sig:<library>@<version>"`, inner entries as `label = true`, tables as `[symbols]`, library
  `[[modules]]` cut at legal borders and around `runs_at` ranges; `checkProposals` screens a proposal that contradicts
  the analysis or the config (`W_EVIDENCE_CONFLICT`, the proposal dropped, nothing else changed); `explain` reports the
  signature part (`test/golden/explain/sig/**`).
- **Code run from RAM** (6.C, without the trace, D91). A hand-written `[[overrides]]` entry with `runs_at` gives the
  non-identity address map, run-space walk targets and the ldscript's `AT(<load>)` with `__load_<module>`; Klonoa's
  `0x0804F318 -> 0x03000388` (`bench/overrides/klonoa.json`) and the RAM-copy fixture link to their SHA-1s.
- **Reconciler and `rename`** (6.E, phase 5's 5.A). `romlift rename <old> <new> [--json]`: a one-line TOML patch (its
  `from` dropped) and identifier tokens only in `src/` and `include/`, refusing an existing `<new>` or an unknown
  `<old>`; the `INCLUDE_ASM` planner's add, remove and move cases (`test/golden/reconcile/**`); the matchings split.
- **objdiff targets and C data** (6.F, phase 5's 5.C). `expected/<module>.s` (since fix round 1 the module as its unit
  assembles it, D95 a; since fix round 4, step 3 assembled as it is into `build/expected/<module>.o`, with no ROM bytes
  written over it, D101), `objdiff.json` (one unit per `c` module), and the `[[modules]]` key `data_start`, whose range
  is the C object's `.rodata` in place of phase 4's C-data assertion.
- **The carried minors** of phase 4 (roadmap "Carried from phase 4"), each with its component in the table below; the
  include resolution behind a symbolic link is cpp-exact.
- **Commands** added: `signatures build <spec>`, `signatures <rom>`, `rename <old> <new>`, `init --no-signatures`, `bench
  signatures [--loo]`. **Formats** added: signature file schema 3, signature spec, `expected/<module>.s`, `objdiff.json`,
  `data_start`, the two bench signature schemas.

## Components

Thirteen components in three waves on the branch `phase-6` (twelve planned; `p6-objdiff` merged in wave 3 as the
thirteenth, D93's amendment), each on its flat branch under `romlift-wt/` (roadmap.md, "Phase 6", "As executed (D93)"). Git cannot hold the branch `phase-6` beside `phase-6/<component>`, so the component
branches are spelled `phase-6-<component>` (AGENTS.md's spelling). Planned merge order: wave 1 lead, analysis-layout,
hygiene, reconcile-carried; wave 2 signatures-build, c-data-expected, ram-code, rename, include-links; wave 3
signatures-match, proposals and the twelfth. As executed: wave 2 merged signatures-build, signatures-match (moved up from
wave 3), ram-code, rename and c-data-expected, in that order; include-links did not merge in wave 2 and moves to wave 3.
Wave 3 merged signatures-apply (the twelfth), proposals, objdiff (the thirteenth, unplanned) and include-links, in that
order.

| Component | Wave | Branch | Status | Delivers |
| --- | --- | --- | --- | --- |
| `p6-lead` | 1 | `phase-6-p6-lead` | merged `b541eb6` | D91 to D93; the frozen contracts (signature schema and spec with their validators, proposal sources, `data_start`, the workflow and explain types, `CheckProposals`); the empty barrels, rule registry, codes and command lists; the gates (four g5 deleted, five renamed to g6, `g6.ram-code-mapped` and `g6.evidence-conflict` restated, the `klonoa` gate input dropped); the documents; then the integration after each wave |
| `p6-analysis-layout` | 1 | `phase-6-analysis-layout` | merged `b2beef8` | `seed.evidence-hint` and the `evidence` origin deleted (D91 e); architecture-b2-8; architecture-r1-3 with a0-4 and a1-5; correctness-b0-5; `g4.toml-mutations` |
| `p6-hygiene` | 1 | `phase-6-p6-hygiene` | merged `379d0f7` | architecture-r1-2, r1-4, r1-6 with a2-8, r1-8's remainder, a2-6 |
| `p6-reconcile-carried` | 1 | `phase-6-p6-reconcile-carried` | merged `14c62f7` | architecture-b2-9 (`core/reconcile/c-scan.ts`), b2-11, r1-7's remainder, gate-honesty-e1-2 |
| `p6-signatures-build` | 2 | `phase-6-p6-signatures-build` | merged `a03d417` | roadmap 6.A |
| `p6-c-data-expected` | 2 | `phase-6-p6-c-data-expected` | merged `fc559ac` | roadmap 6.F (architecture-r2-2 and r2-3 not done; `p6-objdiff` did them in wave 3) |
| `p6-ram-code` | 2 | `phase-6-p6-ram-code` | merged `52ccc66` | roadmap 6.C |
| `p6-rename` | 2 | `phase-6-p6-rename` | merged `9c3e864` | roadmap 6.E (correctness-r0-5's remainder, planned here, was done by `p6-objdiff`) |
| `p6-include-links` | 3 (planned 2) | `phase-6-p6-include-links` | merged `d0b7395` | the cpp-exact include resolution behind a symbolic link (D89 a, D90 a), gate-honesty-e1-1 |
| `p6-signatures-match` | 2 (planned 3) | `phase-6-p6-signatures-match` | merged `b635800` | roadmap 6.B: the matcher, the five rules, resolution and proposals; `romlift signatures <rom>` and `bench signatures` not yet |
| `p6-proposals` | 3 | `phase-6-p6-proposals` | merged `145a291` | roadmap 6.D: the library regions at legal borders and cut around `runs_at` ranges, `checkProposals`, the signature proposals in `init` and `analyze --update`, explain's signature part and the `sig.*` goldens |
| `p6-signatures-apply` (the twelfth) | 3 | `phase-6-p6-signatures-apply` | merged `379c599` | roadmap 6.B's remainder: `romlift signatures <rom>`, `bench signatures [--loo]`, the signatures family of `bench run` (`src/cli/commands/signatures.ts`, `bench/src/signatures.ts`) |
| `p6-objdiff` (the thirteenth, unplanned) | 3 | `phase-6-p6-objdiff` | merged `11ec05d` | `g6.objdiff` (D34, D92): the readable printer's words inside named, sized entries and `.inst.n` (`src/core/emit/print/pool.ts`, `print/data.ts`, `src/core/model/resolver.ts`, outside 6.F's Owns), the objdiff family's base per reference object, one REL/RELA decoder (architecture-r2-2, r2-3, taken from `p6-c-data-expected`), and correctness-r0-5's remainder (`574849b`, pool.ts's WordScope, taken from `p6-rename`) |

The branch of `p6-analysis-layout` is spelled `phase-6-analysis-layout`, as it was created.

### p6-lead (wave 1)

- Decisions: D91 (the gba-kit trace dropped, the owner's words quoted), D92 (phase 5 skipped, "Keep rename and objdiff"),
  D93 (the components and the frozen contracts). D46 amended, D51 and D52 superseded.
- Frozen contracts (D93 b to g): `src/core/signatures/{schema,spec}.ts` (`MemberId`, `SignatureRuleId` and
  `SIGNATURE_RULE_IDS`, `SignatureReference`, `LinkOrderMember`, `SignatureFunction`, `SignatureTable`, `LibraryVersion`,
  `SignatureFile`, `SignaturePlacement`, `SignatureSpec`; `parseSignatureFile`, `parseSignatureSpec`, `isMemberId`,
  hand-written, never throwing); `src/core/signatures/codes.ts` (empty, in the codes union) and `rules/index.ts`
  (`SIGNATURE_RULES = {}`); `src/core/proposals/types.ts` (`signature | analysis | layout`); the `[[modules]]` key
  `data_start`; `src/core/workflow/types.ts` (`InitOptions.signatures`, `InitInputs.signatureFiles`,
  `AnalyzeUpdateInputs.signatureFiles`, `ProjectInputs.headerRealPaths`, `CheckProposalsContext`, `ProposalCheck`,
  `CheckProposals`); `ExplainSignature` and `ExplainReport.signature`.
- Barrels: `src/api/signatures-types.ts` (`romlift`), `src/api/internal-signatures.ts` (`romlift/internal`), and empty
  `src/api/{signatures-build,signatures-match,rename,proposals}.ts` (`romlift`), `src/api/{signatures-files,rename-files}.ts`
  (`romlift/node`); empty `cli/commands/lists/{signatures,rename}.ts` concatenated in `cli/commands/index.ts`.
- Gates: `g5.evidence-merge`, `g5.import-legacy`, `g5.klonoa-rehearsal` and `g5.klonoa-switch` deleted;
  `g5.reconciler`, `g5.rename`, `g5.expected-bytes`, `g5.objdiff`, `g5.c-data-ranges` moved with `git mv` to `g6.*`,
  `phase: 6`, their headers citing D92 (`g6.c-data-ranges` reads `build/src/<module>.o`, D74 f; `g6.objdiff`'s body
  unchanged, its baseline phase-3.md Q1's table); `g6.ram-code-mapped` and `g6.evidence-conflict` restated (D91 c, d);
  `g6.signatures-judged`'s floors for the five PoC ROMs and its symbol comparison; `g6.explain-coverage` also requires
  `SIGNATURE_RULES` to hold exactly the five rule ids; the `klonoa` gate input and `GateIo.realpath`, which only it read,
  removed from `test/gates/gate.ts`; `g4.cli-contract`'s `signatures`, `rename` and `init --no-signatures` recipes, each
  run once its command or option is registered; `test/gates-index.test.ts` accepts a §1 row without gate ids only for a
  skipped phase.
- Tests and goldens the frozen sources changed: `test/unit/proposals/types.test.ts`, `test/unit/signatures/schema.test.ts`,
  `test/unit/api/phase6-exports.test.ts`, the config parse and serialize tests and canonical goldens (a `data_start`
  case; §6.5's example has one, and its override no `from`), the patch goldens, `test/unit/config/patch.test.ts`,
  `test/unit/config/schema.test.ts` (its refused unknown module key is now `dataEnd`), `test/unit/workflow/types.test.ts`
  and `test/mutation/phase4/patch-planner.test.ts` (each used a dropped source; now a signature source,
  `from = "sig:gate@0"`).

## The closing round

Run 1 of the closing list (fresh worktree `romlift-wt/phase-6-closing` at `87bfced`, `landed` 6) and the measurements
before it found, and the round fixed:

- **The signature matcher** (`5ad8605`, D94; Q7). `bench signatures` failed names and tables, `--loo` two runs. Causes
  measured: on pokeemerald eight 20-byte librfu wrappers differing only in a masked pool word all placed at
  `0x082E4A00` by `sig.link-order-run`, each "run" reaching `rfu_CB_pollConnectParent` by skipping the links between them
  inside `librfu_rfu.o`; on sa2 `Mod.o` (6 bytes) ends off a word and the next object starts on the next word, so sa2's
  own chain broke and Fire Emblem 7's 8-byte `DivRem` took the address; `sSetupInfos` (agb_flash, every byte masked)
  placed by spacing alone inside another object on sa2 and sa3. The rules now never place a member over a placed member
  of the version, place a fully masked member only where a pointer names a placed function, weigh every chain's runs
  together, skip a link only of an object other than the ones on both sides of the gap, and let a new object start at
  the next word. Five new rule tests fail on the old matcher. Leave-one-out now reads a member renamed by leaving its
  first reference out as its counterpart (Q8). Result: every judged check passes with every PoC floor held; leave-one-out
  0, 0, 0 on all seven runs.
- **The objdiff family's map** (`af483f9`). `bench run --scaffold`, whose numbers `g6.objdiff` reads, never passed the
  dataset's map to the family (`p6-objdiff` passed it only from `bench/tools/objdiff-classes.ts`), so run 1 counted every
  libgcc and libagbsyscall archive member as `missing-symbol` (fe7j 26, klonoa 21, pokeemerald 455, sa2 127, sa3 237,
  tmc 1). With the map the family counts what the classes tool counts.
- **`test/local/decompiled-c.test.ts`** (`8487bde`; Q10). Run 1's `test:local` failed there (113 of 114): `init` on
  klonoa lists three m4a functions with `from = "sig:m4a@2001"` that warn `W_LISTED_INVALID` in every confirm run, which
  reached the reconciler test's exact `codes` assertions. The test now runs `init --no-signatures`; the warnings are
  Q10 (answered; fix round 4, step 2 restored `init` with signatures there, D100).

## Deviations from the roadmap

- **The gba-kit trace is dropped (D91).** No `romlift trace`, no `@gba-kit/gba-node` peer dependency, no
  `src/shell/trace/gba-kit.ts`, `foundation/formats/trace-json.ts` or `shell/evidence/read-trace.ts`, no trace fact kinds,
  no change in the gba-kit repository. Roadmap 6.C is "Code run from RAM" without a trace; `g6.ram-code-mapped` maps
  Klonoa's range from `bench/overrides/klonoa.json` and the RAM-copy fixture from its `ramCopy`; `g6.evidence-conflict`
  screens signature proposals, the only external source left.
- **Phase 5 is skipped (D92).** No `docs/phase-5.md`, no `phase-5` tag; `phase.json` goes 4 to 6. Legacy import, the
  Klonoa migration tooling and the switch-over are dropped, and the Klonoa repository is not touched. The reconciler and
  `rename`, the `expected/` and `objdiff.json` writers, the C data ranges with `data_start`, and `g6.objdiff` (as D34
  writes it, baseline phase-3.md Q1) are phase 6's (roadmap 6.E, 6.F).
- **The exit loop builds signatures from source.** The roadmap's `npx romlift signatures build` would query the npm
  registry for an unpublished package (D76 d), so the closing list runs `node --conditions=source src/cli/main.ts
  signatures build "$s"` (D93 i).
- **Component branches are flat** (`phase-6-<component>`): Git refuses `phase-6/<component>` beside the branch
  `phase-6`.
- **Architecture §7.1's reference and link-order shapes changed** (D93 b): a reference names its bench dataset (`{dataset,
  commit, romSha1}`, not `project`), and a link-order member carries its address in that reference (`{id, addr}`).
- **The closing list is the orchestrator's** (roadmap "Phase 6 exit" updated to it): phase 4's list (with `npm run
  lint`, the four `export-poc` modes, `npm run corpus` and `bench provenance`) plus the signature build loop and a check
  that `npm pack --dry-run --json` lists no built signature file.
- **Matcher refinements beyond the PoC's step 2** (D94): the PoC's libraries never showed the cases; the new libraries
  (librfu, agb_flash) and the stricter judged gate (names on a reference, tables) did.
- **Leave-one-out counted by counterpart** (D94 d, Q8): the bench's counting changed, not the gate file.
- **`decompiled-c` ran `init --no-signatures`** (Q10) from fix round 1 to fix round 4's second step, which restored
  `init` with signatures there once Q10's rule left no `W_LISTED_INVALID` (D100).
- **A thirteenth component, `p6-objdiff`** (wave 3, D93's amendment): unplanned in the roadmap's table; it took
  architecture-r2-2 and r2-3 from `p6-c-data-expected` and correctness-r0-5's remainder from `p6-rename`, and changed
  readable-printer files outside 6.F's Owns list (`src/core/emit/print/pool.ts`, `print/data.ts`,
  `src/core/model/resolver.ts`). Recorded at fix round 1 (delivery-5, delivery-6); the closing record had said twelve.
- **`docs/benchmark-roms.md` unchanged.** The orchestrator asked to correct it where it still says tmc has no ELF.
  Checked on 24 October 2026: its tuning table gives tmc's ELF (`tmc/tmc.elf`) and map (`tmc/build/USA/tmc.map`), its
  held-out section says all three held-out builds (`pokefirered`, `pokeruby`, `tmc`) reproduce their SHA-1 files, both
  files exist at those paths, and no Markdown file of the repository (`docs/*.md`, `README.md`, `AGENTS.md`, the
  `index.md` files) says tmc has no ELF outside the records of phases 2 to 4 that quote the request.

## Owner questions

Raised at the wave-2 integration (the phase does not land until each is answered):

- **Q1. `g6.ram-code-mapped` was edited by `p6-ram-code`.** The gate as the lead wrote it compared `model --json`'s
  module spans as numbers, but `romlift/model-json@1` spells addresses as `"0x…"` strings, so no module could ever match
  ("no module starts at 0x0800012C" while the model has that module). The component's commit `f534ddd` reads them with
  the gate's own `num()`; nothing is loosened, and with it the gate passes on the ci tier (56 s at the integration).
  Options: (a) accept the parse fix as is; (b) revert it and keep the gate failing until another fix is chosen.
  **Answered on 25 October 2026 (D98 a), with Q2, Q3 and Q5, "Apply all four"**: "Q1 (a) keep f534ddd's parse fix of
  g6.ram-code-mapped". Nothing to change: `f534ddd` stays; the gate passes on both tiers (fix round 4 below).
- **Q2. `g6.reconciler` cannot pass any add, remove or move case.** It requires the comment, string and char tokens of
  `expected.c` to equal those of `input.c`, but every `INCLUDE_ASM` statement holds the string `"asm/nonmatchings/<m>"`,
  so adding or removing a stub always changes them. Measured on all nine goldens of `test/golden/reconcile/` ("comments
  or strings differ between input.c (4) and expected.c (5)", and so on); the golden runner, which skips that string,
  passes. Options: (a) the gate skips the string directly after `INCLUDE_ASM (`, as the golden runner does; (b) another
  rule the owner names. The gate file is not edited.
  **Answered on 25 October 2026 (D98 a), "Apply all four"**: "Q2 (a) g6.reconciler skips the string directly after
  `INCLUDE_ASM (`, as the golden runner does". Applied (`fb16a0f`): the gate passes (9 cases, 11 golden tests, 16
  comment and string tokens untouched).
- **Q3. `g6.rename` picks a function no C file names.** Its regex `/= "(sub_[0-9A-F]{8})"/g` also matches `name =
  "sub_…"` inside inline tables, so on the composite fixture it picks `sub_08000000` (the asm module `rom_header`):
  "no src/*.c names sub_08000000". With `/^0x[0-9A-F]{8} = "(sub_[0-9A-F]{8})"$/gm` in a scratch copy, `p6-rename`
  measured the gate passing (2.3 s). Options: (a) that regex; (b) another selection the owner names. The gate file is
  not edited.
  **Answered on 25 October 2026 (D98 a), "Apply all four"**: "Q3 (a) g6.rename selects with
  /^0x[0-9A-F]{8} = "(sub_[0-9A-F]{8})"$/gm". Applied (`fb16a0f`): the gate renames `sub_080000F4` on the composite
  fixture and passes (3 s).
- **Q4. `g4.cli-contract` fails until `signatures <rom>` lands.** `p6-signatures-build` registers `signatures`, so the
  frozen recipe `signatures <rom>` (exit 0 expected) now runs and exits 2 ("signatures <rom> needs the matcher");
  measured at the integration: "CLI contract: signatures <rom>: exit 2, expected 0". The matcher merged in wave 2, but
  the `<rom>` form of the command did not; it is wave-3 work, and the gate passes again once it lands. No gate change is
  proposed; this is recorded so the failing phase-4 gate on `phase-6` is not mistaken for a regression. Measured at the
  wave-3 integration, with `signatures <rom>` landed: `g4.cli-contract` passes (16 s), so Q4 needs no answer.

Raised at the wave-3 integration:

- **Q5. `g6.evidence-conflict` scenario (c) cannot pass on any fixture.** Scenario (c) is the phase's own: the phase-6
  lead wrote it at `3becd96` under D91 d (the data-override restatement; `git show 89deb54:test/gates/g6.evidence-conflict.test.ts`
  has only the trace and ELF merge scenarios) and froze it without running it against the fixtures, the second restated
  gate frozen untried after Q1's `g6.ram-code-mapped` (fix round 1, delivery-2; 6.I now requires a lead's gate to be
  run against the fixtures before it is frozen). Option (a) corrects the lead's own restatement. The gate takes the first two found functions
  F and G and puts a data override over F's extent; on every committed fixture F is the cartridge entry at
  `0x08000000`, whose extent covers G's entry (far-jump: F `[0x08000000, 0x080000F4)`, G the ARM function at
  `0x080000C0`). The override then covers G too, so `checkProposals` rightly drops U ("a data override of romlift.toml
  covers [0x08000000, 0x080000F4)") and the gate reports "U alone, which agrees with the analysis, is not kept" for
  scenario (c) of all 54 fixtures; scenarios (a) and (b) raise no problem. Measured on `phase-6-p6-proposals` alone and
  on the integration, identical. Options: (a) the gate picks a G whose entry lies outside F's extent (or covers only
  `[F.entry, F.entry + 4)`); (b) another rule the owner names. The gate file is not edited.
  **Answered on 25 October 2026 (D98 a), "Apply all four"**: "Q5 (a) g6.evidence-conflict scenario (c) picks a G whose
  entry lies outside F's extent (or covers only [F.entry, F.entry + 4)). The owner authorises these edits of the gate
  files." Applied (`fb16a0f`) in the first form: G is the first found function whose entry lies outside F's extent;
  162 contradictions on 54 fixtures pass.
- **Q6. `g6.objdiff`'s remainder** (the candidate below, now measured by `p6-objdiff`): gated differences (every class
  but `unnamed-target`) on fe7j, klonoa, pokeemerald, sa2, sa3 and tmc are 19, 131, 157, 4, 55 and 17 (from 458, 353,
  14,137, 1,637, 1,220 and 3,019 on `phase-6` before wave 3), so the gate still fails on the real tier; the component
  reports that most of the rest needs the reference's C source. Its method spells each pool word as the reference
  object spells it (`objectWords`), which the lead reviews as a method question. Options: (a) keep D34 as written, and
  the phase does not land; (b) amend D34 as phase-3.md Q1 option b; (c) count a function objdiff-cli cannot read as
  uncompared rather than as a difference (the `tool` class below, objdiff-cli's own refusal of the reference object),
  which takes klonoa from 131 gated differences to 1 and leaves the other five ROMs' counts as they are (fe7j 19,
  pokeemerald 157, sa2 4, sa3 55, tmc 17), so the gate still fails without (b) (fix round 1, delivery-13).
  Measured again at the closing round (`bench/tools/objdiff-classes.ts`, all six, the map given; run 2's `bench run
  --scaffold` with the map gives the same family): gated 19, 131, 157, 4, 55, 17; under option (b) 3, 1, 6, 1, 54, 5.
  What remains, by class: `value-named` (the reference holds a plain constant where romlift names the address, `.word
  0x30000c8 | .word sTalkText`: fe7j 9, pokeemerald 7, sa2 2), `alias` (pokeemerald 133, tmc 9), `symbol-addend` (fe7j
  4), `value-for-symbol` (the reference relocates `gOamMallocBuffer - 8` where romlift writes the value: fe7j 3,
  pokeemerald 9, sa2 1, sa3 1, tmc 3), `relocation-other` (fe7j 3, klonoa 1, pokeemerald 2, sa3 2, tmc 5),
  `instruction-other` (pokeemerald 4, sa2 1, sa3 52: the base's `.hword 0x0` of `MP2K_event_rept` and sa3's pool words
  inside sized entries, `.word 0x30008c7 | .word gStageData+0x27`), `missing-symbol` (pokeemerald 2) and `tool` (klonoa
  130: objdiff-cli 3.7.2 refuses kleod's reference object `src/code_0804B254.o`, "Invalid instruction size 1", so every
  function of it is uncompared). Which spelling the reference's source chose (a constant or a symbol) is not in the ROM;
  the `tool` class is objdiff-cli's.
  **Answered on 25 October 2026 (D102), with Q15, "Printer spells sym+addend, then ceiling"**: "(1) Q15 option (c):
  move the `sym + addend` spelling into romlift's printer, as phase-3.md Q1 option (a) says (an emission rule; sizes in
  [symbols] where needed), and remove the bench's objectWords rewrite, so g6.objdiff scores romlift's own spelling. (2)
  Amend D34 by phase-3.md Q1 option (b) (report, not gate, the differences whose two sides are checked to link to the
  same word) and by Q6 option (c) (a function objdiff-cli refuses to read, the `tool` class, is counted uncompared and
  reported, not gated). (3) g6.objdiff then gates on a ceiling: the gated count per tuning ROM measured after (1) and
  (2) on the final product, committed as a baseline file the gate reads; any count above its ceiling fails; the ceiling
  may be lowered, never raised, without the owner. Record every count, before and after, in phase-6.md." Applied (fix
  round 4, step 4): the printer's one word rule, `resolver.ts wordNameOf`, which the label scopes read too (a word
  inside a named, sized entry prints `name + offset` from any module, the entry's label global; never an even word
  inside a Thumb function, which `.4byte F + n` cannot link to; no `gUnk_` label for such a word); `objectWords` and
  `--own-spelling` removed; `objdiff-classes.ts isGated` (D34 as amended) and `value-named` reading the base's
  `name+0x<addend>`; `bench/baseline/objdiff-ceiling.json`, which `g6.objdiff` reads. Every count, measured with
  `bench/tools/objdiff-classes.ts` on all six tuning ROMs with the map, each cell "with `objectWords` (Q15's first row,
  before) / romlift's own spelling (Q15's second row, before) / after" (the two before columns classed by the
  classifier of that time, measured again at the start of this step on `77ae472`: the same totals as fix round 2's):

  | Class | fe7j | klonoa | pokeemerald | sa2 | sa3 | tmc |
  | --- | --- | --- | --- | --- | --- | --- |
  | `resolved-call` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `static-callee` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `value-named` | 9 / 9 / 9 | 0 / 0 / 0 | 7 / 2 / 41 | 2 / 11 / 2,658 | 0 / 16 / 1,650 | 0 / 0 / 11 |
  | `alias` | 0 / 0 / 0 | 0 / 0 / 0 | 133 / 133 / 133 | 0 / 0 / 0 | 0 / 0 / 0 | 9 / 9 / 9 |
  | `symbol-addend` | 4 / 5 / 5 | 0 / 0 / 0 | 0 / 10 / 0 | 0 / 1 / 0 | 0 / 2 / 0 | 0 / 0 / 0 |
  | `value-for-symbol` | 3 / 0 / 0 | 0 / 4 / 4 | 9 / 10 / 8 | 1 / 5 / 5 | 1 / 4 / 4 | 3 / 5 / 5 |
  | `unverified` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `trailing-pad` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `relocation-other` | 3 / 7 / 7 | 1 / 1 / 1 | 2 / 11 / 11 | 0 / 0 / 0 | 2 / 4 / 3 | 5 / 26 / 25 |
  | `instruction-other` | 0 / 0 / 0 | 0 / 0 / 0 | 4 / 33 / 1 | 1 / 2,648 / 1 | 52 / 1,638 / 1 | 0 / 11 / 0 |
  | `assemble` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `score` | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `missing-symbol` | 0 / 0 / 0 | 0 / 0 / 0 | 2 / 2 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `tool` | 0 / 0 / 0 | 130 / 130 / 130 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
  | `unnamed-target` | 77 / 77 / 55 | 65 / 65 / 0 | 3,182 / 3,287 / 2,608 | 158 / 158 / 127 | 138 / 138 / 81 | 448 / 448 / 315 |
  | gated as D34 was first written (every class but `unnamed-target`) | 19 / 21 / 21 | 131 / 135 / 135 | 157 / 201 / 196 | 4 / 2,665 / 2,664 | 55 / 1,664 / 1,658 | 17 / 51 / 50 |
  | gated as D34 is amended (D102; "under option (b)" before) | 3 / 7 / **7** | 1 / 1 / **1** | 6 / 44 / **12** | 1 / 2,648 / **1** | 54 / 1,642 / **4** | 5 / 37 / **25** |
  | uncompared (`missing-symbol`, `tool`), reported | 0 / 0 / 0 | 130 / 130 / 130 | 2 / 2 / 2 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

  What moved: `value-named` takes romlift's `name + offset` against the reference's constant (sa2 2,647 and sa3 1,637
  of the own spelling's `instruction-other`, `.word 0x3000004 | .word SoundMainRAM_Buffer+0x4`, checked to be one
  word; before, the classifier read no addend there); the printer rule takes the words inside a sized entry of another
  module (pokeemerald's `symbol-addend` 10 to 0: `gBattleAnimPaletteTable + 2152` where it printed `gUnk_08525CB4`) and
  no longer spells an even word from a Thumb function (sa3's `instruction-other` 7 to 1 between the two halves of the
  step, `.word 0x8000200 | .word sub_80001EC+0x13`, which links to `0x080001FF`; and `unnamed-target` klonoa 65 to 0,
  pokeemerald 3,287 to 2,608, sa2 158 to 127, sa3 138 to 81, tmc 448 to 315, fe7j 77 to 55: words into a function's
  jump table that `574849b` spelled `F + odd`, one below the ROM's word, in the bench's model with the ELF's sizes, and
  that now name the table's label, which `as` relocates against the section as the reference does). Romlift's own
  spelling under the new classifier and the old printer gave gated 7, 1, 12, 1, 8, 26. The ceilings are the after
  column's gated row: fe7j 7, klonoa 1, pokeemerald 12, sa2 1, sa3 4, tmc 25; since fix round 5 `g6.objdiff` pins
  them as the most a committed ceiling may be, so only a lowered file passes, and a tuning ROM that does not link fails
  (D102 d, D104 b). What stays gated depends on the
  reference's source, not on the ROM: relocations with a negative addend or past the symbol's ELF size (fe7j
  `gClassData - 84` where romlift names `gCharacterData + 13072`, tmc `gHUD + 52` against `gUnk_0200AF34`, pokeemerald
  `gPlayerParty - 100` against `gBattleScripting + 20`, klonoa `gUnk_080520E4 - 252` against `gVisionBgNbrTiles + 234`)
  and the `.hword 0x0` the base keeps after `MP2K_event_rept` (sa2, sa3) and `ply_rept` (pokeemerald).
- **Q7. `g6.signatures-judged` and `g6.signatures-loo` fail on the real tier** (reported by `p6-signatures-apply`, not
  re-measured at the integration): judged fails on names and tables, LOO on two runs; `g6.signatures-heldout` passes.
  The component places the fixes in the matcher, the builder or the specs; no gate change is proposed yet. Fixed at the
  closing round in the matcher (D94 a to c; "The closing round"): both gates pass on the real tier, so Q7 needs no
  answer; the leave-one-out count it also needed is Q8.

Raised at the closing round:

- **Q8. `bench signatures --loo` counts a renamed member as its counterpart.** The gate file is unchanged; the bench's
  count of what it reads changed (D94 d). Before: a member keyed by id, so leaving a reference R out, which renames a
  member R shared (Emerald's `BgAffineSet@BgAffineSet.o` becomes Fire Emblem 7's `BgAffineSet@gba-syscall.o`, the first
  remaining reference's id), counted one added and one missing member at the same address: without pokeemerald 4 added
  and 4 missing, without fe7j 2 and 1, without sa2 1 and 0 (measured after the matcher fix). After: each rebuilt member
  maps to the full build's member a remaining reference links at the same address; `moved` is a member at another
  address, `added` a placement where the full build placed no member of the version, `missingShared` a shared member
  whose counterpart is not placed. Measured: 0, 0, 0 on all seven runs; `looCounts`' unit test moved its added member to
  an unplaced address, and two cases cover counterparts. Options: (a) accept the count; (b) count by id and the phase
  does not land on this gate; (c) another count the owner names.
  **Answered on 25 October 2026 (D98 b), with Q13 and Q14, "Accept all three"**: "option (a) each (the leave-one-out
  counterpart count; `unjudged` sizes accepted and reported; member symbols compared on a reference ROM, the reviewed
  display name reported). Write each as the owner's rule." The counterpart count is the owner's rule (architecture
  §8.4, roadmap thresholds); nothing else changes.
- **Q9. `g6.signatures-judged` judges tmc with no floor.** The pinned PoC baseline has no signatures row for tmc
  (revealed after it was pinned, D60), so the gate as phase 1 wrote it had no floor for it; D93 h, not the owner's words,
  judges tmc by the ELF checks alone. Measured at the closing round: tmc libagbsyscall 13 functions, m4a 55 functions and
  10 tables; 68 placements (67 at an ELF `FUNC`, 1 at a listed untyped address, 0 wrong), 10 tables all `OBJECT`s of
  their size, 5 proposed sizes. Options: (a) accept no floor for tmc; (b) take these counts as tmc's floor; (c) another
  rule the owner names.
  **Answered on 25 October 2026 (D98 c), "Measured counts as floor"**: "option (b): tmc's floor in
  g6.signatures-judged is libagbsyscall 13 functions, m4a 55 functions and 10 tables, 68 placements with 0 wrong; tmc
  may not drop below." Applied (`fb16a0f`, `OWNER_FLOORS`); measured on the real tier: tmc libagbsyscall 13, m4a 55
  and 10, 68 placements, 0 wrong, at its floor.
- **Q10. `W_LISTED_INVALID` on klonoa after `init`.** With the signature layer `init` lists on klonoa `umul3232H32`
  (`0x0804F284`) and `SoundMainRAM` (`0x0804F318`), Thumb entries that switch to ARM, their ARM part folded in as an
  inner `label = true` of mode `arm`, and `ldrb_r3_r2` (`0x0804F73C`), two bytes that fall through into `chk_adr_r2`;
  each is an ELF `FUNC` of that size, and each carries `from = "sig:m4a@2001"`, so every confirm run validates it (D76 a)
  and warns: "fails valid.dense: not dense: holes inside its extent (12 bytes in 16)", "(578 bytes in 932)", "fails
  valid.returns-or-prologue: no return and no push {.., lr}". Present since the wave-3 merge of `p6-proposals` (the same
  three on `61dd414`); measured at fix round 1 on every tuning ROM (`test/local/listed-invalid-signatures.test.ts`, which
  pins the set): the same m4a entries warn on fe7j (`0x080BE394`, `0x080BE428`, `0x080BE84C`), pokeemerald
  (`0x082DF04C`, `0x082DF0E0`, `0x082DF864`), sa2 (`0x080945E8`, `0x0809467C`, `0x08094AA0`), sa3 (`0x080B9838`,
  `0x080B98CC`, `0x080B9CF0`) and tmc (`0x080AF310`, `0x080AF75C`), 17 in all; not a gate (`g4.e2e-real` builds klonoa to its SHA-1, the warnings are warnings), but phase 4's
  `test/local/listed-invalid` premise (no `W_LISTED_INVALID` after `init`) holds only without signatures, and
  `decompiled-c` now runs `init --no-signatures`. Options: (a) a recorded limitation (the warnings are D76 a's design);
  (b) `checkProposals` drops a signature function the valid.* rules refuse (`W_EVIDENCE_CONFLICT`), losing three true
  names; (c) the confirm run validates a listed extent per inner label's mode and accepts a fall-through into the next
  listed function.
  **Answered on 25 October 2026 (D100), "Validate per mode"**: "option (c): the confirm run validates a listed extent
  per inner label's mode (an ARM part folded in as an inner `label = true` of mode arm is checked as ARM) and accepts a
  fall-through into the next listed function, so the 17 m4a entries no longer warn W_LISTED_INVALID after init;
  test/local/listed-invalid-signatures.test.ts pins the empty set; restore phase 4's listed-invalid premise for init
  with signatures if it now holds." Applied (fix round 4, step 2, `src/core/analysis/driver/listed-extent.ts`): the
  entry is judged by its Thumb reading with the bytes its extent's ARM labels read counted as covered, each such
  label not yet a function by the valid.* rules over its own ARM reading, and a last instruction that ends exactly at
  the next listed function and flows on into it is the reading's exit; anything else still warns. Measured: no
  `W_LISTED_INVALID` on the six tuning ROMs (17 before); the premise holds, so `test/local/decompiled-c` runs `init`
  with signatures again and passes.
- **Q11. `g4.toml-mutations`' edits** (correctness-b0-5, b0-4, carried). `p6-analysis-layout` built the product side
  (a `data` override claims its span, a `code` override seeds `seed.override`), but the gate's add-override edit still
  covers a found function exactly, a no-op that warns `W_OVERRIDE_IGNORED` (run 1: 273 legal edits, add-override 60 such
  no-ops; 179 illegal edits), and no odd `[functions]` key is among its illegal edits. Each change is a gate change the
  owner has not authorised (D81 c). Options: (a) make the add-override edit one that changes the model and add the odd
  key; (b) keep the gate as it is.
  **Answered on 25 October 2026 (D98 d), "Tighten"**: "option (a): g4.toml-mutations' add-override edit must be one that
  changes the model, and an odd [functions] key joins its illegal edits. The owner authorises editing that frozen
  phase-4 gate file." Applied (`fb16a0f`): the edit took a found function no found function calls out of
  `[functions]` and covered its extent with a code override; the gate counted F as accepted through the override's
  seed when F was only reported as unlisted, which claims nothing, so the edit did not change the model (the review
  of fix round 4, correctness-o0-1; measured: the tree equals the delete-function edit's). The first Thumb key plus
  one is an illegal edit (`E_FUNCTION_MISALIGNED`); that half stands. Applied again at fix round 5 (D104 a): no `code`
  override without `runs_at` changes a confirm model (a confirm run takes only `[functions]`), so the edit is a
  `data` override over a listed function's trailing pool words, F still listed: the confirm run ends F's extent at
  the override; the gate keeps the edit only when the model `buildModel` builds differs from the original config's in
  its functions' extents or its chunks, `generate` must warn no `W_OVERRIDE_IGNORED`, the link must reproduce the
  SHA-1, `make` must exit 0, and at least one target must take it. Measured: fix round 4 (the code override) ci tier
  212 legal edits (add-override 23 on 54 fixtures, 31 with no place) and 215 illegal, real tier 242 legal
  (add-override 29) and 239 illegal, 60 ROMs; fix round 5 (the data override) ci tier 243 legal edits (add-override
  54, every fixture) and 215 illegal; real tier 273 legal edits (add-override 60, all 60 ROMs) and 239 illegal (run 6,
  "The closing gate").

Raised at fix round 1 (the review of the closing record, D95):

- **Q12. `g6.expected-bytes` and objdiff on an untouched project cannot both hold.** The review (correctness-2) measured
  objdiff-cli 3.7.2 with objdiff.json's `functionRelocDiffs = none` on an untouched project built to its SHA-1: functions
  below 100% (sa1 34 of 2,013, klonoa 51 of 422) before the user changes anything. Fix round 1 made each target the
  build unit's own assembly with the ROM's bytes written over its `.text` (D95 a), so target and base now share symbols,
  mapping symbols and relocations: sa1 33 of 2,013 (the orphan-chunk mapping case is gone), klonoa still 51 of 422.
  Every differing row left is one class (`test/local/objdiff-json` checks it on klonoa: 3,276 `.word` rows, 4 `bl`
  rows): objdiff reads a relocated field as its implicit addend (ARM REL), so a base jump-table word or a `bl` to the
  function right after resolves inside the function, while the target's field, which holds the ROM's bytes because
  `g6.expected-bytes` reads the unlinked `.text`, resolves outside it, and objdiff compares a branch target with a
  relocation as different. No object can hold both the ROM's bytes and the base's addends in those fields. Options: (a)
  keep `g6.expected-bytes` as written and accept the class as a limitation (the targets as fix round 1 builds them);
  (b) `expected/<module>.o` without the ROM's bytes (the unit's assembly as it is: objdiff 100% on every untouched
  function, measured on sa1 with the symbolic objects alone, 0 of 2,013 below), and `g6.expected-bytes` judges the
  target after relocation (linked at its module's address) instead of the unlinked `.text`: a gate change; (c) another
  rule the owner names. Fix round 2 (correctness-r1-1, D96 a): because the ROM is written over the target's `.text`,
  the gate's own comparison could no longer see the target's content (two includes of `expected/main.s` swapped passed
  on sa1); the gate now also judges the unit's object as assembled, `build/expected/<module>.o`, outside its relocated
  fields and by its symbols' offsets, a tightening that leaves option (a)'s targets and this question as they were.
  **Answered on 25 October 2026 (D101), "Symbolic targets"**: "option (b): expected/<module>.o is the unit's assembly
  as it is, without the ROM's bytes written over .text, so objdiff shows 100% on every untouched function;
  g6.expected-bytes judges the target after relocation, linked at its module's address, against the ROM range, and
  keeps the symbol-offset check. Measure objdiff on an untouched project (sa1 and klonoa at least) and record the counts
  below 100% (expected 0)." Applied (fix round 4, step 3): `make expected` assembles `expected/<module>.s` as it is into
  `build/expected/<module>.o` (no `expected/rom/`); the gate links every target at its module's address and compares
  its bytes with the ROM range and its symbols with the model's places. Measured with objdiff-cli 3.7.2 on untouched
  projects (`test/local/objdiff-json`): sa1 0 of 2,013 functions below 100% (33 before), klonoa 0 of 422 (51 before).
- **Q13. `g6.signatures-judged` leaves `unjudged` sizes out of its comparison.** The bench counts a proposed size as
  `unjudged` when the ELF has no size for the symbol, its size is 0, or the FUNC spans another FUNC (bench/src/signatures.ts),
  and the gate tested only `differ`; architecture §8.4 said every proposed size equals the ELF size. Measured in the
  committed artifact of run 2: tmc 5 proposed, 0 equal, 5 unjudged (none of tmc's sizes is compared, which with Q9's
  missing floor leaves tmc judged by placements and tables alone); fe7j 20 and 5; klonoa 17 and 2. Fix round 1 made the
  gate require equal + differ + unjudged = proposed and report the unjudged count (correctness-4, a tightening), and
  wrote the exemption into §8.4; the exemption itself is not the owner's words. Options: (a) accept `unjudged`; (b) the
  gate fails on an unjudged size (tmc, fe7j and klonoa fail until the bench can judge them); (c) another rule.
  **Answered on 25 October 2026 (D98 b), with Q8 and Q14, "Accept all three"**: "option (a) each (the leave-one-out
  counterpart count; `unjudged` sizes accepted and reported; member symbols compared on a reference ROM, the reviewed
  display name reported). Write each as the owner's rule." §8.4 and the roadmap now state it as the owner's rule; the
  gate is unchanged (fe7j 20 = 15 equal + 5 unjudged, klonoa 17 = 15 + 2, pokeemerald 17 = 15 + 2, sa2 17 = 15 + 2,
  sa3 19 = 17 + 2, tmc 5 = 0 + 5).
- **Q14. `g6.signatures-judged` compares member symbols, not display names, on a reference ROM.** Phase 4's gate text
  required "on a reference ROM, every name equal to that reference's symbol"; D93 h (the lead's, not the owner's words)
  compares the MemberId's symbol and only reports a reviewed display name. Measured case (correctness-3): on pokeemerald,
  a libgcc reference, `romlift signatures pokeemerald.gba` gives `0x082E8B70 function thumb _fpadd_parts_f
  (_fpadd_parts@fp-bit.o, libgcc@agbcc)`, while the ELF symbol there is `_fpadd_parts`; run 2's note gives
  `pokeemerald: … 1 reviewed names (reported)`. Under phase 4's text that name fails the gate. Until the owner answers,
  the gate stands changed without his authorisation. Options: (a) accept the member-symbol rule (a reviewed name may
  differ on its own reference); (b) restore the old rule, and the gate fails on pokeemerald until the spec's reviewed
  name goes (the PoC's ad hoc `_dp`/`_f` disambiguation, D31); (c) another rule.
  **Answered on 25 October 2026 (D98 b), with Q8 and Q13, "Accept all three"**: "option (a) each (the leave-one-out
  counterpart count; `unjudged` sizes accepted and reported; member symbols compared on a reference ROM, the reviewed
  display name reported). Write each as the owner's rule." The gate stands as D93 h wrote it, now the owner's rule
  (pokeemerald 397 reference symbols, 1 reviewed name reported).

Raised at fix round 2 (the review of fix round 1, D96):

- **Q15. `g6.objdiff` scores the bench's spelling of romlift's pool words, not romlift's own** (delivery-r1-1). The
  bench's `objectWords` (`bench/src/objdiff.ts`, `p6-objdiff`, `1347bfb`) rewrites each pool word of a base before it is
  assembled: a plain `.4byte 0x0300xxxx` that romlift emits, or a name at an address the reference object names nothing
  at, becomes the reference object's data name at or below the word, `name + offset`. D34 allows only "the emitted
  function .s, assembled, with labels renamed to the reference ELF's names by address"; phase-3.md Q1 option (a), which
  the commit cites, puts `sym + addend` in the printer ("an emission rule, with sizes in [symbols]"), not in the bench;
  and Q6 gave the owner counts measured with the rewrite. Measured at fix round 2 (`bench/tools/objdiff-classes.ts`, all
  six, with the map; `--own-spelling` scores romlift's own spelling), gated (D34) fe7j, klonoa, pokeemerald, sa2, sa3,
  tmc: with `objectWords` 19, 131, 157, 4, 55, 17 (under Q6 option b 3, 1, 6, 1, 54, 5); without it 21, 135, 201,
  2,665, 1,664, 51 (under Q6 option b 7, 1, 44, 2,648, 1,642, 37). Without the rewrite sa2 and sa3 differ mostly in
  `instruction-other` (2,648 and 1,638: pool words inside sized entries the reference relocates, `.word 0x30008c7 |
  .word gStageData+0x27`), pokeemerald in `instruction-other` 33, `relocation-other` 11 and `symbol-addend` 10.
  Options: (a) revert `objectWords` and gate romlift's own spelling (the second row); (b) accept the bench rewrite as an
  amendment to D34 (the first row; the gate still fails without Q6's answer); (c) move the `sym + addend` spelling into
  the printer, as phase-3.md Q1 option (a) says, and measure again (not measured: a printer rule with sizes in
  `[symbols]`). Until he answers, nothing is reverted and the committed counts are the first row's.
  **Answered on 25 October 2026 (D102), with Q6, "Printer spells sym+addend, then ceiling"**: "(1) Q15 option (c):
  move the `sym + addend` spelling into romlift's printer, as phase-3.md Q1 option (a) says (an emission rule; sizes in
  [symbols] where needed), and remove the bench's objectWords rewrite, so g6.objdiff scores romlift's own spelling."
  The rest of the answer, what was applied and every count before and after are under Q6. `objectWords` and
  `--own-spelling` are gone; the base is romlift's own spelling (the second row), scored against the ceilings.

Raised at fix round 3 (the review of fix round 2, D97):

- **Q16. `g6.expected-bytes` judges no `runs_at` module** (architecture-r2-1). The gate's only `runs_at` branch returns
  before its symbol check (`if (placed.runsAt) return problems;`), and every target is a bare `init baserom.gba`, which
  writes no `runs_at` override (D91), so no `runs_at` module's `expected/` object is judged on any fixture or tuning ROM
  (448 modules on 60 ROMs in run 4, none `runs_at`). D96 a and architecture §13 say "every symbol where the model
  places it", with no exception. Options: (a) a tightening: compare each symbol at the model address minus the chunk's
  `runAt` and add the RAM-copy fixture with its hand-written override to the gate's targets, as `g6.ram-code-mapped`
  does (a change to a frozen gate file); (b) accept the exemption and write it into §13 and D96 a.
  **Answered on 25 October 2026 (D101), "Tighten"**: "option (a): g6.expected-bytes judges runs_at modules (each symbol
  at the model address minus the chunk's runAt, or the equivalent under Q12's linked judgment) and its targets include
  the RAM-copy fixture with its hand-written runs_at override, as g6.ram-code-mapped does." Applied (fix round 4, step
  3), under Q12's linked judgment: a `runs_at` target links at its run address, loaded at its load address with its
  `__load_<module>`, and each symbol must link at the model's run address; code-copied-to-ram runs a second time with
  its `ramCopy` as an `[[overrides]]` entry (`analyze --update --write`, `generate`). Measured: ci 229 modules on 55
  targets, 1 `runs_at`; a scratch copy judging that module at its load address fails.

The owner answered every open question on 25 October 2026. Applied by fix round 4's first step (D98): Q1, Q2, Q3, Q5,
Q8, Q9, Q11, Q13, Q14; by its second step (D100): Q10; by its third step (D101): Q12, Q16; by its fourth step (D102):
Q6 and Q15. Q4 and Q7 need no answer.

## Known limitations

- **Code run from RAM needs a hand-written override** (D91): nothing proposes `runs_at`; a user writes the
  `[[overrides]]` entry, and the analysis, the model and the ldscript honour it.
- **No import path for an existing decomp's function list** (D92): `import-legacy` is not built; a project starts from
  `init`.
- **A load address of a `runs_at` module now prints as `__load_<module> + n`** (fix round 1, correctness-5; klonoa's
  m4aSoundInit pool word `__load_ram_03000388 + 1`), so this limitation of the closing record is gone. What stays: a
  call from the ROM into a `runs_at` module at its load address prints raw (`.inst.w 0xF000F9F1 @ bl 0x0804F6B6
  (no-roundtrip)`, twice in klonoa's SoundMain), since no label links to a load address of a relocated module and a
  `bl` takes no `__load_` expression; klonoa's range keeps that ROM-called tail because the RAM code loads a pool word
  there (D63; bench/overrides/klonoa.json's `source`, correctness-9).
- **The signature layer warns about libraries a game does not link**: every klonoa `init` reports `W_SIGNATURE_AMBIGUOUS`
  for librfu@2004 (`Callback_Dummy_ID` fits at 3 places, `rfu_setMSCCallback` at 2) and `W_SIGNATURE_DROPPED` for
  m4a@2004 (96 of its 96 placements overlap the version that placed more). They are warnings of the matcher's resolution
  and change nothing in the config (delivery-12); suppressing them for a version with no settled placement is left to a
  later phase.
- **`verify --link` does not judge a C data range's C**: it links the range's ROM bytes as a stand-in `.rodata`, so a C
  file that leaves part of its range undefined passes it while `make` fails; a range whose `data_start` lies at or past
  its module's end takes the `data` modules after it (architecture §6.6, correctness-11).
- **objdiff-cli 3.7.2 cannot read one klonoa reference object** (`src/code_0804B254.o`, "Invalid instruction size 1"):
  its 130 functions are uncompared (`tool`), counted and reported, not gated (Q6 option (c), D102).
- **`g6.objdiff` holds a remainder at its ceiling** (D102): fe7j 7, klonoa 1, pokeemerald 12, sa2 1, sa3 4, tmc 25 gated
  differences that depend on the reference's source (a relocation with a negative addend or past its symbol's ELF size,
  where romlift names the symbol that holds the word) or on a pad the base keeps (`MP2K_event_rept`'s `.hword 0x0`);
  the same-word differences (sa2 2,663, sa3 1,654, ...) are reported. A ceiling may be lowered, never raised without
  the owner.
- **correctness-b2-3's remainder stays carried**: `modules.mk` records only `romlift.toml`'s SHA-1, not the romlift
  version, until romlift is published (D76 d).
- **`g6.expected-bytes` has one `runs_at` target on the ci tier, and it places every symbol at offset 0 of its module**
  (fix round 5, correctness-o0-3): the RAM-copy fixture with its override has `gUnk_0800012C` and `sub_0800012C` both
  at the start of its one `runs_at` module, so a run-offset error for a symbol inside a `runs_at` module is caught on
  the ci tier only at offset 0. The check works at other offsets: on Klonoa with `bench/overrides/klonoa.json`
  (measured, not a gate target), moving `sub_0804F4B0` one instruction down fails both the byte and the symbol
  comparison. A synthetic fixture with labels deeper in a copied range is left to a later phase.
- **A sized entry drops the default-named data labels inside it** (fix round 5, correctness-o0-5): a `[symbols]` entry
  with `size` makes every pool word it holds print `name + offset` (D102 a), so `generate` makes no `gUnk_<ADDR>`
  label inside it. C that already names such a label (`extern … gUnk_080D8E14`) stops linking at `make`, loudly;
  `generate` does not warn. The fix is to name the entry plus its offset in the C, or to drop the entry's `size`.
- **The frozen `g4.c-data-fails-loud` header quotes the C-data assertion's old text** (carried from fix round 3,
  architecture-r2-7, D99 e; recorded at fix round 5, architecture-o0-8): the owner authorised no edit of that gate
  file, and its pattern matches the current text (`src/<m>.c defines data; see AGENTS.md (…)`), so the gate passes;
  only its comment is stale. Carried past phase 6.
- The release-1 limitations of phases 1 to 4 stand (phase-4.md, "Known limitations").

## Measured numbers

### Wave 1 (`p6-lead`)

At the lead's commit, alone on `phase-6` (before the other wave-1 components merge):

- `npm run typecheck`: exit 0; `npm run lint`: exit 0; `npm test`: 2,471 tests, 2,471 pass, exit 0.
- `npm run bench -- gates --require 4 --tier ci` (31 min, the other wave-1 worktrees running beside it): every gate of
  phases 1 to 4 on the ci tier passes (g1 9, g2 8, g3 8, g4 11) but `g1.provenance`, which fails on its source-digest
  check alone: `bench/results.json` records the sources of `89deb54`, and every source change of the phase makes it
  stale ("re-run the real tier") until the integration's real-tier run regenerates the artifact, which no component
  commits (its gate-record, families, dataset-rows and heldout-rows checks pass). So the command exits 1 on every
  component branch of this phase until then.
- The same run lists the nine ci-tier g6 gates and no g5 gate: `g6.evidence-conflict`, `g6.no-heldout-references`,
  `g6.rename` and `g6.signatures-rebuild` pending (their exports are not public yet); `g6.c-data-ranges` (no
  `expect-ranges.json`), `g6.expected-bytes` (no `expected/`), `g6.explain-coverage` (`SIGNATURE_RULES` empty),
  `g6.ram-code-mapped` (no fixture's `ramCopy`) and `g6.reconciler` (no reconcile goldens) fail until their components
  land. The other four g6 gates (`g6.signatures-judged`, `-heldout`, `-loo`, `g6.objdiff`) are real-tier only.

### Wave 2 integration

Merges on `phase-6`: `a03d417` (signatures-build), `b635800` (signatures-match; conflicts in
`src/core/signatures/codes.ts` and `test/unit/api/phase6-exports.test.ts`, resolved by keeping both components' codes),
`52ccc66` (ram-code), `9c3e864` (rename), `fc559ac` (c-data-expected), then `ff70b0b` (the writer goldens of the three
libfix fixtures regenerated for the `expected` and `objdiff` writers and `EXPECTED_OBJS`, additive) and the record and
documents commit (D23 revision for `planPatch`'s module insertion; architecture §3.4's `'runs-at'` layout reason, §6.5
and §6.8).

- `npm run typecheck`: exit 0; `npm run lint`: 21 of 21 pass; `npm test`: 2,713 tests, 2,712 pass, 1 todo (the pool
  printer naming a load address of a `runs_at` module through `__load_<module>`, `test/unit/model/resolver.test.ts`,
  which `p6-ram-code` left for `core/emit/print/pool.ts`), exit 0.
- Gates on the ci tier, each run alone with `node --conditions=source --test test/gates/<id>.test.ts`: pass
  `g3.golden-writers`, `g4.e2e-fixtures` (162 s), `g6.c-data-ranges`, `g6.expected-bytes` (225 expected modules on 54
  ROMs equal their ROM ranges), `g6.ram-code-mapped`; fail `g4.cli-contract` (Q4), `g6.reconciler` (Q2), `g6.rename`
  (Q3) and `g6.explain-coverage` (no `test/golden/explain/sig/` golden and seven analysis rules in no explain golden;
  wave 3's `p6-proposals`).

### Wave 3 integration

Merges on `phase-6`, all without a textual conflict: `379c599` (signatures-apply), `145a291` (proposals), `11ec05d`
(objdiff), `d0b7395` (include-links), then the integration commit. Fixed at the integration:

- `W_SIGNATURES_ABSENT` was defined twice (`src/shell/codes.ts` by signatures-apply, `src/core/workflow/codes.ts` by
  proposals), which `test/unit/diagnostics/codes.test.ts` refuses. The shell's code stays (architecture §7.3 and §9.1
  already name it the shell's): `init`'s plan no longer raises it, and `src/cli/commands/init.ts` reports
  `signaturesAbsent(located)` once the plan is made, so a refused init still leads with its own error.
- `test/unit/cli/signatures.test.ts` expected libfix's second region at `[0x0800026C, 0x0800027C)`; proposals rebuilt
  library-game (GameTail loads a Thumb pointer, 8 bytes more), which moves `gFixTable` to `0x08000274`, so the region is
  `[0x08000274, 0x08000284)`.

- `npm run typecheck`: exit 0; `npm run lint`: exit 0; `npm test`: 2,818 tests, 2,817 pass, 1 todo (the same
  `__load_<module>` pool-printer case as wave 2), exit 0.
- Gates on the ci tier, each run alone with `node --conditions=source --test test/gates/<id>.test.ts`: pass
  `g4.cli-contract` (16 s), `g6.explain-coverage`, `g6.no-heldout-references`, `g6.c-data-ranges` (58 s),
  `g6.ram-code-mapped` (58 s); fail `g6.reconciler` (Q2), `g6.rename` (Q3) and `g6.evidence-conflict` (Q5).

## The closing gate

The list, run in this order in a fresh worktree at `landed` 6, the real tier before the ci tier (D54 i):

```
npm ci
npm run typecheck
npm run lint
npm test
npm run fixtures -- check
for s in signatures/specs/*.json; do node --conditions=source src/cli/main.ts signatures build "$s" || exit 1; done
npm run build && npm pack --pack-destination "$(mktemp -d)"
npm pack --dry-run --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const bad=JSON.parse(s)[0].files.map(f=>f.path).filter(p=>p.startsWith("signatures/")&&!p.startsWith("signatures/specs/")&&p.endsWith(".json"));if(bad.length){console.error("built signature files are packed: "+bad.join(", "));process.exit(1)}})'
npm run export-poc -- --mode raw
npm run export-poc -- --mode scored
npm run export-poc -- --mode parity
npm run export-poc -- --mode queries
ROMLIFT_REQUIRE_LOCAL=1 npm run test:local
npm run bench -- doctor-real
npm run corpus
npm run bench -- run --scaffold
npm run bench -- regression
npm run bench -- gates --require 6 --tier real
npm run bench -- gates --require 6 --tier ci
npm run bench -- provenance
```

Then the phase pull request: `ci.yml`, `printer.yml`, `provenance.yml`, `fixtures.yml` and `packed.yml` must run, or,
if GitHub refuses to start them, the checks they run are run locally (the owner's landing answer, D103). Runs 1 to 4
did not pass the list, so no pull request was opened; runs 5 and 6 pass it. This is the orchestrator's list (roadmap "Phase
6 exit" now reads the same); the owner's answers of 25 October 2026 changed none of its commands. Every run used `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler`,
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc` and a fresh worktree with `bench/.local/poc` and
`bench/.local/agbcc` copied in.

### Run 1 (`87bfced`, worktree `romlift-wt/phase-6-closing`)

Every command exited 0 but four: `test:local` 1 (113 of 114; `decompiled-c`, fixed by `8487bde`), `gates --tier real` 1
(27 pass, 1 historical, 1 fail: `g6.objdiff`, its counts inflated by the missing map, fixed by `af483f9`), `gates --tier
ci` 1 (40 pass, 4 fail: `g1.provenance`, `g6.evidence-conflict`, `g6.reconciler`, `g6.rename`) and `bench provenance` 1
(gate record: `g6.objdiff` is fail). Run 2 measures the sources after those fixes.

### Run 2 (`8487bde`, worktree `romlift-wt/phase-6-closing-2`)

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,825 tests, 2,824 pass, 0 fail, 1 todo (the `__load_<module>` pool-printer case, a known limitation) (40 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree (binutils 2.45.1) |
| signature build loop | 0 | six files: agb_flash 22 functions and 5 tables, libagbsyscall 22, libgcc 69, librfu 148 and 5, m4a 203 and 20 (2 versions), siirtc 16 and 1; 0 diagnostics (19 s) |
| `npm run build && npm pack --pack-destination …` | 0 | `romlift-0.0.0.tgz`, 750 files, 597.5 kB |
| packed-signature check | 0 | no built signature file in `npm pack --dry-run --json` |
| `npm run export-poc -- --mode raw` | 0 | 54 fixtures dumped (15 s) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (248 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` unchanged (79 s) |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, parity equal to the committed digests (52 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 114 tests, 114 pass, 0 skipped (723 s) |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | ok (4 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build (init, setup.sh, make) to the SHA-1 on all six; both sealed ROMs pass (init build SHA-1); objdiff gated differences (every class but `unnamed-target`) fe7j 19, klonoa 131, pokeemerald 157, sa2 4, sa3 55, tmc 17; memory family peak RSS `init` 1,022.7 MiB, `generate` 974.1 MiB, measured against the gate's 1,536 MiB limit with V8's old space capped at 1,024 MiB (RSS is not capped; the review's run of the same commit measured `init` at 1,054.2 MiB, and `g3.large-rom` 994.9 MiB: run-to-run spread) (272 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` |
| `npm run bench -- gates --require 6 --tier real` | **1** | 28 pass, 1 historical (`g2.poc-parity`), **1 fail: `g6.objdiff`** (Q6) (30 real-tier records in the committed artifact; the closing record first said 27 pass, corrected at fix round 1, correctness-6). Among the passes: `g6.signatures-judged` (every PoC floor held: fe7j libagbsyscall 18, libgcc 22, m4a 94 and 10; klonoa 6, 20, 94 and 10; pokeemerald 15, 67, 109 and 10, with agb_flash 22 and 4, librfu 148 and 5, siirtc 16 and 1; sa2 12, 24, 94 and 10, agb_flash 17 and 1; sa3 13, 65, 94 and 10, agb_flash 17 and 1; tmc libagbsyscall 13, m4a 55 and 10, no floor, Q9), `g6.signatures-loo` (7 runs, 0 added, moved or lost), `g6.signatures-heldout` (pokefirered 353 placements and 18 tables, pokeruby 226 and 15, none wrong), `g6.signatures-rebuild` (libagbsyscall, libgcc, m4a equal the PoC's converted files), `g6.expected-bytes` (448 modules on 60 ROMs), `g6.ram-code-mapped` (the RAM-copy fixture and Klonoa), `g2.speed` (ratio 0.960; sa2 765 of 783 ms, 97.7%; klonoa 259 of 306, tmc 1,505 of 1,784, sa3 1,173 of 1,492, pokeemerald 2,381 of 4,219, fe7j 1,186 of 12,692), `g3.speed-budget` (pokeemerald `generate` 8,946 of 9,611 ms, `init` 11,370 of 14,417 ms), `g4.e2e-real` (six tuning ROMs from the source tree and the tarball, sealed 2 of 2), `g4.toml-mutations` (273 legal edits, add-override 60 no-ops warning `W_OVERRIDE_IGNORED`, 179 illegal) (3,414 s) |
| `npm run bench -- gates --require 6 --tier ci` | **1** | 46 gates: 42 pass, **4 fail: `g1.provenance`** (the closing record first said 40 pass, corrected at fix round 1, correctness-6) (the artifact records `g6.objdiff` failing), **`g6.evidence-conflict`** (Q5: scenario (c) on all 54 fixtures), **`g6.reconciler`** (Q2: all nine cases), **`g6.rename`** (Q3: "no src/*.c names sub_08000000"). Among the passes: `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (750 files, no built signature file), `g3.large-rom` (`init` 1,019.8 MiB, `generate` 1,021.5 MiB), `g6.c-data-ranges`, `g6.explain-coverage` (58 analysis and 5 sig rule ids in 213 goldens), `g6.no-heldout-references` (6 specs, 12 references) (1,938 s) |
| `npm run bench -- provenance` | **1** | source digest `393eefba…` ok (Node 24); **gate record: `g6.objdiff` is fail**; families live; 6 rows, no sealed row |

Four commands exit 1, so **phase 6 does not pass its closing gate**. Every failing gate is one whose file cannot pass as
written (Q2, Q3, Q5) or one D34 gates as written (Q6, and with it `g1.provenance` and `bench provenance`); none is
changed here. sa2's `g2.speed` at 97.7% of its limit is at the top of the spread phase 4 recorded (85.6% to 97.7%); the
analysis did not change in this phase's closing round. `bench/results.json` is committed as run 2's artifact.

### Run 3 (`e8043cc`, fix round 1, worktree `romlift-wt/phase-6-fix1`)

After the review's fixes (D95). The first attempt at `080f589` stopped at `npm test` (2 of 2,836 failed: the explain CLI
tests read the checkout's `signatures/`, empty in a fresh worktree before the build loop); fixed by `e8043cc` and the
list run again from the start.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (0 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | pass |
| `npm test` | 0 | 2,836 tests, 2,836 pass, 0 fail, 0 todo (41 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree (binutils 2.45.1) |
| signature build loop | 0 | six files, 0 diagnostics (20 s) |
| `npm run build && npm pack --pack-destination …` | 0 | `romlift-0.0.0.tgz`, 760 files, 608.4 kB |
| packed-signature check (the full one-liner above) | 0 | no built signature file packed |
| `npm run export-poc -- --mode raw` | 0 | (15 s) |
| `npm run export-poc -- --mode scored` | 0 | (253 s) |
| `npm run export-poc -- --mode parity` | 0 | (79 s) |
| `npm run export-poc -- --mode queries` | 0 | (52 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 121 tests, 121 pass, 0 skipped (729 s); `listed-invalid-signatures` 17 warnings as pinned; `objdiff-json` klonoa 51 of 422 functions below 100%, all in Q12's class (3,276 words, 4 calls) |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | ok (4.1 s) |
| `npm run bench -- run --scaffold` | 0 | six rows link (raw and readable) and build from `init` to the SHA-1, both sealed ROMs pass; objdiff gated differences fe7j 19, klonoa 131, pokeemerald 157, sa2 4, sa3 55, tmc 17 (unchanged); memory family peak RSS `init` 931.2 MiB, `generate` 984.3 MiB against the 1,536 MiB limit, heap cap 1,024 MiB (278 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` |
| `npm run bench -- gates --require 6 --tier real` | **1** | 30 records: 28 pass, 1 historical (`g2.poc-parity`), **1 fail: `g6.objdiff`** (Q6). Among the passes: `g6.expected-bytes` (448 modules on 60 ROMs, the new targets), `g6.signatures-judged` (sizes now accounted: fe7j 20 = 15 equal + 5 unjudged, klonoa 17 = 15 + 2, tmc 5 = 0 + 5), `g6.ram-code-mapped`, `g6.signatures-loo`, `-heldout`, `-rebuild`, `g2.speed` (ratio 0.970; sa2 734 of 791 ms, klonoa 260 of 310), `g3.speed-budget` (pokeemerald `generate` 8,035 of 9,625 ms, `init` 10,598 of 14,438 ms), `g4.e2e-real` (3,375 s) |
| `npm run bench -- gates --require 6 --tier ci` | **1** | 46 gates: 42 pass, **4 fail: `g1.provenance`** (the artifact's `g6.objdiff` record), **`g6.evidence-conflict`** (Q5), **`g6.reconciler`** (Q2), **`g6.rename`** (Q3). Among the passes: `g4.cli-contract` (10 commands, 17 `--json` runs, no recipe option missing), `g4.packed-e2e` (760 files), `g3.large-rom` (`init` 997.5 MiB), `g6.c-data-ranges`, `g6.explain-coverage`, `g6.no-heldout-references` (1,987 s) |
| `npm run bench -- provenance` | **1** | source digest `8e3c9981…` ok (Node 24); **gate record: `g6.objdiff` is fail**; families live; 6 rows, no sealed row |

`bench/results.json` is committed as run 3's artifact.

### Run 4 (`41b9eae`, fix round 2, worktree `romlift-wt/phase-6-fix2`)

After the second review's fixes (D96), `bench/.local/poc` and `bench/.local/agbcc` copied in.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,848 tests, 2,848 pass, 0 fail, 0 todo (41 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree (binutils 2.45.1) |
| signature build loop | 0 | six files (20 s) |
| `npm run build && npm pack --pack-destination …` | 0 | `romlift-0.0.0.tgz`, 764 files, 610.6 kB |
| packed-signature check | 0 | no built signature file packed |
| `npm run export-poc -- --mode raw` | 0 | (15 s) |
| `npm run export-poc -- --mode scored` | 0 | (250 s) |
| `npm run export-poc -- --mode parity` | 0 | (79 s) |
| `npm run export-poc -- --mode queries` | 0 | (52 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 121 tests, 121 pass, 0 skipped (731 s) |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok |
| `npm run corpus` | 0 | ok (5 s) |
| `npm run bench -- run --scaffold` | 0 | six rows link (raw and readable) and build from `init` to the SHA-1, both sealed ROMs pass; objdiff fe7j 9 instruction, 3 missing-relocation, 7 relocation; klonoa 1 relocation, 130 tool; pokeemerald 11, 9, 2 missing-symbol, 135; sa2 3, 1; sa3 52, 1, 2; tmc 3 missing-relocation, 14 relocation (gated 19, 131, 157, 4, 55, 17, unchanged); memory family `init` 956.9 MiB, `generate` 965.3 MiB peak RSS against 1,536 MiB, heap cap 1,024 MiB (269 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` |
| `npm run bench -- gates --require 6 --tier real` | **1** | 30 records: 27 pass, 1 historical (`g2.poc-parity`), **2 fail: `g6.objdiff`** (Q6, Q15) **and `g3.speed-budget`** (`bench speed --json` exited 1: sa2 analysis 791.3 ms, limit 787.2 ms; `g2.speed` of the same run passed with sa2 733 of 781 ms; see the verdict). Among the passes: `g6.expected-bytes` (448 modules on 60 ROMs, the unit objects judged too), `g6.ram-code-mapped`, `g6.signatures-judged`, `-loo`, `-heldout`, `-rebuild`, `g2.speed` (ratio 0.958), `g4.e2e-real` (3,373 s) |
| `npm run bench -- gates --require 6 --tier ci` | **1** | 46 gates: 42 pass, **4 fail: `g1.provenance`** (the artifact's `g3.speed-budget` and `g6.objdiff` records), **`g6.evidence-conflict`** (Q5), **`g6.reconciler`** (Q2), **`g6.rename`** (Q3). Among the passes: `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (764 files), `g3.large-rom` (`init` 965.9 MiB), `g6.c-data-ranges`, `g6.explain-coverage` (58 analysis and 5 sig rule ids in 213 goldens) (1,983 s) |
| `npm run bench -- provenance` | **1** | source digest `6ba924e6…` ok (Node 24); **gate record: `g3.speed-budget` and `g6.objdiff` are fail**; families live; 6 rows, no sealed row |

After the run, measured on the same commit in the main checkout with nothing else running: `bench speed --only sa2`
764.5 ms (limit 787.6) and 765.3 ms (808.3); with `src/foundation/rom/rom.ts` as it was before fix round 2 766.5 ms
(791.0) and 769.9 ms (772.8); `g3.speed-budget` alone on the real tier in the run's worktree passes (calibration 0.960,
sa2 analysis 783 ms, pokeemerald `generate` 8,159 of 9,598 ms, `init` 10,448 of 14,398 ms). `bench/results.json` is
committed as run 4's artifact.

### Run 5 (`fa5d7ab`, fix round 4, worktree `romlift-wt/phase-6-closing-5`)

After the owner's answers (D98, D100 to D103) and the four steps of fix round 4 that applied them. A fresh worktree at
`fa5d7ab` with `test/gates/phase.json` at `{ "landed": 6 }`, no local cache but `bench/.local/poc` and
`bench/.local/agbcc` copied in (objdiff-cli 3.7.2 found as the main checkout's `bench/.local/objdiff-target` build),
every command run in this order in the foreground of one script, each waited for (25 October 2026, 22:40 to 00:35).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error (6 s) |
| `npm run lint` | 0 | 21 tests pass (5 s) |
| `npm test` | 0 | 2,859 tests, 2,859 pass, 0 fail, 0 skipped, 0 todo (42 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree (binutils 2.45.1) (2 s) |
| signature build loop | 0 | six files, 0 diagnostics each: agb_flash 22 functions and 5 tables, libagbsyscall 22, libgcc 69, librfu 148 and 5, m4a 203 and 20 (2 versions), siirtc 16 and 1 (20 s) |
| `npm run build && npm pack --pack-destination …` | 0 | `romlift-0.0.0.tgz`, 766 files, 615.3 kB (4 s) |
| packed-signature check (the full one-liner above) | 0 | no built signature file packed |
| `npm run export-poc -- --mode raw` | 0 | 54 fixtures dumped (15 s) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (250 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` unchanged (79 s) |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, parity equal to the committed digests (51 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 122 tests, 122 pass, 0 skipped (733 s); among them `listed-invalid-signatures` no `W_LISTED_INVALID` on the six tuning ROMs (Q10), `objdiff-json` c-data every unit and untouched sa1 and klonoa every function at 100% (Q12), `decompiled-c` to klonoa's SHA-1 with signatures |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (3 s) |
| `npm run corpus` | 0 | ok, 150 ARM rows with coverage (4 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build (init, setup.sh, make) to the SHA-1 on all six; both sealed ROMs pass with their init builds at the SHA-1; objdiff differences fe7j 9 instruction, 12 relocation, 55 unnamed-target; klonoa 4 missing-relocation, 1 relocation, 130 tool; pokeemerald 42, 8, 2 missing-symbol, 144, 2,608; sa2 2,659 instruction, 5 missing-relocation, 127; sa3 1,651, 4, 3 relocation, 81; tmc 11, 5, 34, 315 (classed by D34 as amended in `g6.objdiff` below); memory family peak RSS `init` 988.4 MiB, `generate` 995.7 MiB against 1,536 MiB, heap cap 1,024 MiB; wrote `bench/results.json` (6 rows, 2 sealed, commit `fa5d7ab`) (272 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` (1 s) |
| `npm run bench -- gates --require 6 --tier real` | 0 | 30 records: 29 pass, 1 historical (`g2.poc-parity`), 0 fail. `g6.objdiff` every tuning ROM at its ceiling: fe7j 1,471 functions, gated 7 of 7; klonoa 485, 1 of 1, 130 uncompared; pokeemerald 15,850, 12 of 12, 2 uncompared; sa2 2,887, 1 of 1; sa3 4,305, 4 of 4; tmc 8,388, 25 of 25. `g6.signatures-judged` every PoC floor held and tmc at the owner's floor (libagbsyscall 13, m4a 55 and 10, 68 placements, 0 wrong); sizes fe7j 20 = 15 equal + 5 unjudged, klonoa 17 = 15 + 2, pokeemerald 17 = 15 + 2, sa2 17 = 15 + 2, sa3 19 = 17 + 2, tmc 5 = 0 + 5. `g6.expected-bytes` 452 modules on 61 targets (1 `runs_at`), linked at their modules' addresses. `g6.ram-code-mapped` the RAM-copy fixture and Klonoa (`0x0804F318 -> 0x03000388`). `g6.signatures-loo` 7 runs, 0 added, moved or lost; `-heldout` pokefirered 353 placements and 18 tables, pokeruby 226 and 15, none wrong; `-rebuild` libagbsyscall, libgcc, m4a equal the PoC's converted files. `g4.toml-mutations` 242 legal edits (add-override 29, each accepted through its seed, no `W_OVERRIDE_IGNORED`), 239 illegal, 60 ROMs. `g4.e2e-real` the six tuning ROMs to their SHA-1s from the source tree and the tarball. `g2.speed` calibration 0.966: fe7j 1,205 of 12,762 ms, klonoa 249 of 308, pokeemerald 2,386 of 4,242, sa2 754 of 787 (95.8%), sa3 1,138 of 1,500, tmc 1,488 of 1,794. `g3.speed-budget` calibration 0.951: pokeemerald `generate` 8,061 of 9,505 ms, `init` 10,448 of 14,258 ms. `g3.readability` at its floors (3,494 s) |
| `npm run bench -- gates --require 6 --tier ci` | 0 | 46 gates, 46 pass, 0 fail. `g1.provenance` (source digest `929668b8…`, 30 real-tier records pass or are historical), `g6.reconciler` (9 cases, 11 golden tests, 16 comment and string tokens untouched), `g6.rename` (`sub_080000F4` renamed; both refusals change nothing), `g6.evidence-conflict` (162 contradictions on 54 fixtures), `g6.expected-bytes` (229 modules on 55 targets, 1 `runs_at`), `g6.ram-code-mapped`, `g6.c-data-ranges`, `g6.explain-coverage` (58 analysis and 5 sig rule ids in 213 goldens), `g6.no-heldout-references` (6 specs, 12 references), `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (766 files, no ROM, ELF, map or built signature file; 53 fixtures to their SHA-1), `g4.e2e-fixtures` (53 fixtures), `g3.large-rom` (`init` 964.7 MiB, `generate` 1,009.1 MiB peak RSS, heap cap 1,024 MiB) (1,917 s) |
| `npm run bench -- provenance` | 0 | source digest `929668b8…` ok (Node 24); gate record: 30 real-tier gates of phase ≤ 6 pass or are historical; families live (code-end, determinism, entries, extents, readability, scaffold, signatures, speed, memory, printer); 6 rows, one per tuning dataset; no sealed row |

Every command exits 0, so **phase 6 passes its closing gate**. No speed gate needed a rerun (sa2's analysis at 95.8%
of its limit, inside the spread phase 4 recorded). `bench/results.json` is committed as run 5's artifact.

**Verdict.** Phase 6 passes its closing gate at `fa5d7ab` with `test/gates/phase.json` at `{ "landed": 6 }`: every
command of the list exits 0 in a fresh worktree, both gate tiers pass every gate of phases 1 to 6 (the one historical
record, `g2.poc-parity`, frozen since phase 2), and every owner question is answered and applied (Q1 to Q3, Q5, Q6,
Q8 to Q16; Q4 and Q7 needed no answer). It lands when the phase pull request merges to `main` with the raised marker,
after its CI workflows run, or, if GitHub refuses to start them, after the checks they run pass locally (D103).

### Run 6 (`d66d802`, fix round 5, worktree `romlift-wt/phase-6-closing-6`)

After the review of fix round 4 and its fixes (D104). A fresh worktree at `d66d802` with `test/gates/phase.json` at
`{ "landed": 6 }`, no local cache but `bench/.local/poc` and `bench/.local/agbcc` copied in (objdiff-cli 3.7.2 found as
the main checkout's `bench/.local/objdiff-target` build), every command run in this order in one script, each waited
for (26 October 2026, 02:31 to 04:43).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error (5 s) |
| `npm run lint` | 0 | 21 tests pass (5 s) |
| `npm test` | 0 | 2,865 tests, 2,865 pass, 0 fail, 0 skipped, 0 todo (35 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree (2 s) |
| signature build loop | 0 | six files, 0 diagnostics (18 s) |
| `npm run build && npm pack --pack-destination …` | 0 | `romlift-0.0.0.tgz`, 768 files, 617.9 kB (3 s) |
| packed-signature check (the full one-liner above) | 0 | no built signature file packed (1 s) |
| `npm run export-poc -- --mode raw` | 0 | (13 s) |
| `npm run export-poc -- --mode scored` | 0 | (238 s) |
| `npm run export-poc -- --mode parity` | 0 | (76 s) |
| `npm run export-poc -- --mode queries` | 0 | (49 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 122 tests, 122 pass, 0 skipped (691 s); `listed-invalid-signatures` no `W_LISTED_INVALID` on the six tuning ROMs; `objdiff-json` sa1 0 of 2,013 and klonoa 0 of 422 functions below 100% |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (2 s) |
| `npm run corpus` | 0 | ok (5 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build to the SHA-1 on all six; both sealed ROMs pass with their init builds at the SHA-1; objdiff differences as run 5 (fe7j 9 instruction, 12 relocation, 55 unnamed-target; klonoa 4 missing-relocation, 1 relocation, 130 tool; pokeemerald 42, 8, 2 missing-symbol, 144, 2,608; sa2 2,659 instruction, 5 missing-relocation, 127; sa3 1,651, 4, 3 relocation, 81; tmc 11, 5, 34, 315); memory family peak RSS `init` 1,191.4 MiB, `generate` 1,091.4 MiB against 1,536 MiB, heap cap 1,024 MiB; wrote `bench/results.json` (6 rows, 2 sealed, commit `d66d802`) (245 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` (1 s) |
| `npm run bench -- gates --require 6 --tier real` | 0 | 30 records: 29 pass, 1 historical (`g2.poc-parity`), 0 fail. `g6.objdiff` every tuning ROM at its ceiling (fe7j 7 of 7, klonoa 1 of 1 with 130 uncompared, pokeemerald 12 of 12 with 2 uncompared, sa2 1 of 1, sa3 4 of 4, tmc 25 of 25), the committed ceilings at the owner's pinned values. `g4.toml-mutations` 273 legal edits (move-start 48, rename 60, delete-function 57, add-override 60: a data override that changes the model on every one of the 60 ROMs, split-module 48), 239 illegal. `g6.expected-bytes` 452 modules on 61 targets (1 `runs_at`). `g6.signatures-judged`, `-loo`, `-heldout`, `-rebuild`, `g6.ram-code-mapped`, `g4.e2e-real` (the six tuning ROMs to their SHA-1s) pass as in run 5. `g2.speed` calibration 0.931: fe7j 1,132 of 12,301 ms, klonoa 242 of 297, pokeemerald 2,225 of 4,089, sa2 723 of 759 (95.3%), sa3 1,115 of 1,446, tmc 1,421 of 1,729. `g3.speed-budget` calibration 0.960: pokeemerald `generate` 7,740 of 9,598 ms, `init` 10,093 of 14,398 ms. `g3.readability` at its floors (3,038 s) |
| `npm run bench -- gates --require 6 --tier ci` | 0 | 46 gates, 46 pass, 0 fail. `g1.provenance` (source digest `26c98574…`, 30 real-tier records pass or are historical), `g4.toml-mutations` 243 legal edits (add-override 54, every fixture), 215 illegal, `g6.expected-bytes` 229 modules on 55 targets (1 `runs_at`), `g6.rename` (`sub_080000F4`), `g6.evidence-conflict` (162 contradictions on 54 fixtures), `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (768 files, 53 fixtures to their SHA-1), `g3.large-rom` (`init` 1,182.3 MiB, `generate` 1,155.8 MiB peak RSS, heap cap 1,024 MiB, under the 1,536 MiB limit) (1,707 s) |
| `npm run bench -- provenance` | 0 | source digest `26c98574…` ok (Node 24); gate record: 30 real-tier gates of phase ≤ 6 pass or are historical; families live; 6 rows, one per tuning dataset; no sealed row (1 s) |

Every command exits 0, so **phase 6 passes its closing gate** at `d66d802`. No speed gate needed a rerun (sa2's
analysis at 95.3% of its limit, inside the spread phase 4 recorded). The memory peaks are higher than run 5's (`init`
1,191.4 against 988.4 MiB in the bench, `g3.large-rom` 1,182.3 against 964.7) and still under the 1,536 MiB limit; the
review's own rerun of `3befe08` measured 1,173.7 and 1,222.2, the same spread before this round's changes, which touch
no memory path. `bench/results.json` is committed as run 6's artifact.

## Review

### Fix round 1 (review of `1484ab0`, D95)

38 findings (1 blocker, 16 major, 21 minor). Every one is fixed or recorded; none is rejected. Commits on `phase-6`:
`a018847` (expected/, `__load_`), `648ba59` (rename), `bb37577` (the split, zod, the gate tightenings, the local test),
`080f589` (documents), `e8043cc` (hermetic explain tests), then this record.

| Finding | Severity | Disposition |
| --- | --- | --- |
| architecture-1 | major | Fixed (`bb37577`): `core/workflow/proposals.ts` holds `checkProposals` alone (185 lines); the signature layer and folding are `core/workflow/signature-layer.ts`; the library-module planning is `core/layout/module-proposals.ts`; `freeModuleName` lives beside `runsAtName`; §2 updated. |
| architecture-2 | major | Fixed (`bb37577`): `planRunsAtBorders` and `planLibraryModules` build the resumed module once (`resumedModule`) and name through `runsAtName`/`freeModuleName`, which init's `inferModules` now uses for library names too (same output); `ModuleProposal` is exported once from `core/proposals/types.ts`. |
| architecture-3 | major | Fixed (`bb37577`, D95 d): signature file and spec are zod schemas decoded with `safeParse` into the same results and refusal texts (`issues.ts`); `Refusal`, `refuse`, `decodeHelpers` deleted; the `zod` edge added to §2 and the checker. |
| architecture-4 | major | Fixed (`bb37577`, D95 b): `signaturesOnRom`/`signaturesOver` own the analysis-error policy; the CLI and the bench call them; `loadSignatureFiles` is the one locator call of the four commands, `W_SIGNATURES_ABSENT` included; whether a run reports the notes is the workflow's (`signatureNotes`, `enabled` and `--no-signatures`). |
| architecture-5 | major | Fixed (`648ba59`, D95 c): `readRenameTexts` lists every skipped file (link, not-utf8, binary) with its bytes; `planRename` warns `W_RENAME_SKIPPED` or refuses `E_RENAME_SKIPPED_FILE` when a skipped file names the old name; the link policy is documented in architecture §6.6. |
| architecture-6 | minor | Fixed (`bb37577`): `isSealedDataset` and `isLibraryName` in `core/signatures/spec.ts` (the bench reads them via `romlift/internal`); `isRegularFile`, `readText`, `readJson` in `shell/fs.ts`, ENOENT/ENOTDIR only; `locate.ts` reports an unreadable entry as `W_SIGNATURE_FILE_SKIPPED` instead of dropping it. |
| architecture-7 | minor | Fixed (`a018847`): one `incbinLine` in `foundation/asm/dialect.ts` (data writer, C-data stand-in, expected writer); the expected writer's `.inst` copy is gone with its byte printer. |
| architecture-8 | minor | Fixed (`bb37577`): `insnUnit`, one `functionAt` (`core/analysis/types.ts`), `alignUp` (`foundation/util/align.ts`), `le32` (`foundation/util/bytes.ts`), `hexBytes`/`bytesOfHex` together in `foundation/util/hex.ts`. |
| architecture-9 | minor | Fixed (`bb37577`): `loadSpaceImage` returns `RomBytes` (bytes and bounds, no sha1 or header); the byte readers and the table idiom take `RomBytes`. |
| architecture-10 | minor | Fixed (`bb37577`): `placedEnd` deleted; `GatePhase` is `1 \| 2 \| 3 \| 4 \| 6` with a D92 comment. |
| architecture-11 | minor | Fixed (`bb37577`): `analyze-update.test.ts` places a library region at a runs_at range's end and asserts the libfix module replaces `main_080001B4`; `test/unit/layout/module-proposals.test.ts` covers the planners. |
| architecture-12 | minor | Fixed (`bb37577`): `parseSourceKey` beside `sourceKey`, a round-trip test, used by `explain.ts`. |
| architecture-13 | minor | Fixed (`648ba59`): `renamedFunction`/`renamedSymbol` drop only `from` by rest spread. |
| architecture-14 | minor | Fixed (`648ba59`): `C_KEYWORDS` and `directiveOf` in `c-tokens.ts`; `c-scan.ts` and `rename-tokens.ts` read directives through it (no regex over a code line; a directive's own name is never renamed). |
| architecture-15 | minor | Fixed (`080f589`): §2 records the r1-2 aliases as removed in phase 6 and lists core/workflow's real contents. |
| correctness-1 | major | Fixed (`648ba59`, D95 c): `rename` refuses a name the confirm model emits (`renameModelNames`); measured on sa1: `unk_0800032C`, `gUnk_0809B670` and `_08004808` each exit 1 with `E_RENAME_EXISTS` and change nothing; tests with a default orphan, a data symbol and a local label. |
| correctness-2 | major | Fixed as far as the gates allow, the rest an owner question (`a018847`, D95 a, Q12): targets are the unit's own assembly with the ROM's bytes written over `.text`, relocations kept (`objcopy --update-section` drops them, measured); sa1 34 to 33 functions below 100%, klonoa 51; every remaining row is objdiff reading a relocated field as its addend, which no object holding the ROM's bytes can avoid. `test/local/objdiff-json` now runs klonoa and checks every differing row is in that class. |
| correctness-3 | major | Owner question Q14 (pokeemerald's `_fpadd_parts_f` measured); the gate stands changed without authorisation until he answers. |
| correctness-4 | major | Fixed in the gate (tightening: equal + differ + unjudged = proposed, unjudged reported per ROM), §8.4 documents the exemption, and the exemption is owner question Q13 with the counts. |
| correctness-5 | major | Fixed (`a018847`): pool and data words name a runs_at load address as `__load_<module> + n`; the text-layout check resolves it; klonoa with the override links to its SHA-1 and prints `.4byte __load_ram_03000388 + 1`; the todo test is a test. |
| correctness-6 | minor | Fixed (this record): run 2 counts corrected to 28 pass, 1 historical, 1 fail (real) and 46 gates, 42 pass, 4 fail (ci). |
| correctness-7 | minor | Fixed (this record): RSS measured against the 1,536 MiB gate limit with the heap capped at 1,024 MiB, spread noted. |
| correctness-8 | minor | Fixed (`bb37577`): a run range over the ROM's load space (the identity excepted) or over another run range is `E_OVERRIDE_INVALID`; model tests. |
| correctness-9 | minor | Recorded: the ROM-called tail `sub_0804F6B6` stays inside the range because the RAM code loads the pool word after it PC-relatively (D63); `bench/overrides/klonoa.json`'s `source` and "Known limitations" record the two raw `bl` lines as the measured cost. |
| correctness-10 | minor | Fixed (`bb37577`, D95 e): a recipe option missing from `--help` fails `g4.cli-contract`. |
| correctness-11 | minor | Fixed in the documents (`080f589`): §6.6 states that a range may take the `data` modules after it and that `make` needs C for the whole range, and that `verify --link` does not judge a data range's C. |
| delivery-1 | blocker | Agreed: the phase stays unmerged. The full closing list ran again after the fixes (below); it still fails on the gates that wait for the owner. |
| delivery-2 | major | Fixed (this record, roadmap 6.I, AGENTS.md): Q5 says scenario (c) is the lead's own at `3becd96` and that option (a) corrects it; a gate the lead writes or restates is run against the fixtures before it is frozen. |
| delivery-3 | major | Fixed (`bb37577`): `test/local/listed-invalid-signatures.test.ts` runs init with signatures on the six tuning ROMs and pins the set, which turned out to be 17, not 3 (Q10 updated); AGENTS.md's wording and listed-invalid's name and header corrected. |
| delivery-4 | minor | Fixed (`080f589`): README lists `g1.provenance` and `bench provenance` as failing on the artifact's `g6.objdiff` record, and separates `g6.objdiff` from the three gates that cannot pass as written. |
| delivery-5 | minor | Fixed: thirteen components in this record, roadmap "As executed", D93's amendment and "Deviations". |
| delivery-6 | minor | Fixed: correctness-r0-5's remainder credited to `p6-objdiff` here and in roadmap's carried table. |
| delivery-7 | minor | Fixed: the roadmap threshold marks tmc's floor pending Q9 and the name rule pending Q14; the cli-contract skip is removed (correctness-10). |
| delivery-8 | minor | Fixed (`080f589`): AGENTS.md lists the phase-6 local suites and the five workflows. |
| delivery-9 | minor | Fixed: the full packed-file one-liner is written in both closing lists. |
| delivery-10 | minor | Fixed (`080f589`): plan.md's `import-legacy` row marked dropped (D92). |
| delivery-11 | minor | Fixed (`080f589`): the scaffold's AGENTS.md and README document `npx romlift rename`, `from = "sig:…"` entries, `runs_at` overrides and the objdiff remainder; scaffold golden regenerated. |
| delivery-12 | minor | Recorded in "Known limitations" (librfu ambiguity and m4a@2004 dropped warnings on klonoa). |
| delivery-13 | minor | Fixed: Q6 gains option (c), the `tool` class as uncompared (klonoa 131 to 1). |

### Fix round 2 (review of `ea1dbcb`, D96)

16 findings (3 major, 13 minor). Fourteen are fixed, one is an owner question (delivery-r1-1, Q15) and one is rejected
with a measurement (architecture-r1-5's suggested command; its concern is addressed otherwise). Commits on `phase-6`:
`95e9f5b` (code and tests), `41b9eae` (documents), then this record.

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-r1-1 | major | Fixed (`95e9f5b`, D96 a), a gate tightening: `make expected` keeps the unit's object as assembled at `build/expected/<module>.o`; `g6.expected-bytes` requires its `.text` to equal the ROM range outside every relocated field (`readelf -r`, ARM field widths, an unknown type fails) and every symbol the model places to sit at the model's offset. Run against the committed fixtures before freezing: 225 modules on 54 ROMs pass. A scratch copy of the gate that swaps the `sub_080000F8` and `sub_0800010C` includes of c-data's `expected/main.s` fails: "build/expected/main.o differs from the ROM at 0x080000F8, outside every relocated field (sub_0800010C) \| sub_080000F8 sits at 0x0800011C … where the model places it at 0x080000F8 \| sub_0800010C sits at 0x080000F8 …"; the gate before the fix passes it ("PATCHED TEXT EQUALS ROM"). README and D96 now say fix round 1 left the gate able to catch only a wrong size. |
| correctness-r1-2 | major | Fixed (`95e9f5b`, D96 c): `linkerNameCollisions` (core/model/names.ts) makes a config name equal to a runs_at module's `__load_<module>` `E_NAME_COLLISION`; `modelNamesOf` lists it, so rename refuses it. Measured on klonoa with `bench/overrides/klonoa.json` (init, the override appended, `analyze --update --write`, `generate`): `rename SoundMain __load_ram_03000388` exits 1 with `E_RENAME_EXISTS` and leaves the TOML unchanged; the TOML edited by hand to that name makes `generate` exit 1 with `E_NAME_COLLISION … is the symbol ldscript.txt defines as the load address of runs_at module ram_03000388`; the unedited project still generates, `verify --link` gives SHA-1 `a0a298d9…` and `make expected` exits 0. Model test with a function and a RAM symbol of that name. |
| delivery-r1-1 | major | Owner question Q15 (D96 b), with both measurements (`bench/tools/objdiff-classes.ts`, new `--own-spelling`): gated with `objectWords` 19, 131, 157, 4, 55, 17; without it 21, 135, 201, 2,665, 1,664, 51 (under Q6 option b 3, 1, 6, 1, 54, 5 and 7, 1, 44, 2,648, 1,642, 37). Nothing reverted before the owner answers. |
| correctness-r1-3 | minor | Fixed (`95e9f5b`, D96 d): `runAddresses` refuses a `runs_at` that is not its start plus a multiple of 4 and a run range ending past `0xFFFFFFFF` (`E_OVERRIDE_INVALID`); §6.7 and the scaffold AGENTS.md state both. On klonoa, `runs_at = 0x0300038A` and `0xFFFFFF00` now make `analyze --update` refuse its patch (exit 1) and `generate` exit 1. Model tests. |
| correctness-r1-4 | minor | Fixed (`95e9f5b`): the assertion reads `src/<m>.c defines data; see AGENTS.md (only read-only data is placed, in a data range: data_start)`, which still matches `g4.c-data-fails-loud`'s pattern (the gate file, including its header comment that quotes the old text, is not edited); writer, scaffold and unit goldens regenerated. |
| architecture-r1-1 | minor | Fixed (`95e9f5b`): `linkedFileBytes` reads ENOENT, ENOTDIR and ELOOP as a link to nothing and throws anything else, which `readRenameTexts` reports as `E_IO_READ`; a read-inputs test with a link to a mode-000 file. |
| architecture-r1-2 | minor | Fixed (`95e9f5b`): `signatureFromPlacements` calls `signaturesOver(...).placements`; explain.ts's header, codes.ts (both mentions) and architecture §2's `fs.ts` entry corrected. |
| architecture-r1-3 | minor | Fixed (`95e9f5b`, D96 e): a `c` module's `expected/<module>.s` is its heading plus `stubAssemblyText` over the written chunk paths; the statement parser (D49) reads `.syntax divided` as a no-byte directive and refuses an instruction or include under it; text-layout has one `chunkBytes` (taking the Map) and one `macrosOrderError`. |
| architecture-r1-4 | minor | Fixed (`95e9f5b`): text-layout cases for each refusal of `checkExpectedFile` (macro file after a chunk include, misordered and missing include, the asm/matchings twin accepted, an instruction under `.syntax divided`, a byte past the module) and `checkExpectedRomFile` (another offset, a short range, an include); fs tests for `isRegularFile` (EACCES via mode 000, ENOTDIR, a link) and `readJson` (EACCES, not JSON, a decoder refusal); `test/unit/workflow/signature-layer.test.ts` for `signaturesOnRom` on a non-cartridge image, `signaturesOver` over an analysis with an error, and `signatureNotes(false, …)`. |
| architecture-r1-5 | minor | Rejected as written, concern addressed: `objcopy --update-section .text=expected/rom/main.bin` measured again (binutils 2.45.1, c-data): `.rel.text` has 1 entry before and "There are no relocations in this file" after, and D95 a needs them kept. The rule now refuses an object without exactly one `.text` instead of splicing at a guessed offset; it still reads `readelf -SW`'s columns, which no binutils command replaces while keeping the relocations. |
| architecture-r1-6 | minor | Fixed (`95e9f5b`): `runsAtOverrides`/`runsAtSpans` exported from core/model/modules.ts and used by modules.ts, signature-layer.ts and analyze-update.ts; layout/align.ts's function is `alignWord`, re-exported through borders.ts; `peek32` and `u32` read through `le32`; spec.ts sorts with `compareCodeUnits`; the bench's `romSignatures` returns core's `RomSignatures` and refuses a run whose analysis or matcher reports an error. |
| architecture-r1-7 | minor | Fixed (`95e9f5b`): the orphan doc comment in match.ts is deleted. |
| architecture-r1-8 | minor | Fixed (`95e9f5b`): `core/signatures/zod-helpers.ts` holds `nonEmptyText`, `anyText`, `listOf`, `exactObject` for both schemas (`memberIdText` is schema.ts's own again); `core/signatures/sealing.ts` holds `isSealedDataset`, which the builder and `romlift/internal` read; §2 and core/index.md list both. |

### Fix round 3 (review of `b64f0b7`, D97)

11 findings (1 major, 10 minor). The major is fixed; nine minors are carried (each stays open and goes to the next
round or phase with the phase) and one is owner question Q16. Measured after the fix, in the main checkout: `npm run typecheck` 0, `npm run lint` 0,
`npm test` 2,849 of 2,849 (the scaffold golden regenerated for the template's new sentence);
`ROMLIFT_REQUIRE_LOCAL=1` `test/local/{ram-code,config-mutations,emission-real}` 9 of 9; on the ci tier
`g6.ram-code-mapped`, `g6.expected-bytes` (225 modules on 54 ROMs), `g6.c-data-ranges`, `g4.c-data-fails-loud` pass;
on the real tier `g6.ram-code-mapped` passes (the RAM-copy fixture and Klonoa, `0x0804F318 -> 0x03000388`).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-r2-1 | major | Fixed (D97 a): `names.ts sectionNameCollisions` refuses a `runs_at` module whose section `.<module>` is `.text`, a `c` module's `.c_data_<m>` or a data range's `.rodata_<m>` (`E_NAME_COLLISION`, exit 1); the ldscript writer and check spell the section and `__load_` names through `runSectionOf`/`loadSymbolOf`, and `.c_data_<m>` through `cDataName`. Measured on Klonoa with its override: the module renamed `text` and `c_data_main_6` each make `generate` exit 1 (`E_NAME_COLLISION`); the unedited project's `verify --link` gives `a0a298d9…`. Model test over `text`, `c_data_main` (a `c` module `main`; none for an `asm` one), `rodata_data` (a data range; none without `data_start`) and a non-`runs_at` module named `text`. §6.7 and the scaffold AGENTS.md state the rule. |
| architecture-r2-1 | minor | Owner question Q16: `g6.expected-bytes`' `runs_at` branch (line 183) returns before the symbol check and no target has a `runs_at` module; the fix (compare at `at - runAt`, add the RAM-copy fixture with its override to the targets) changes a frozen gate file. |
| architecture-r2-2 | minor | Partly fixed: `ldscript.ts` and `link-scripts.ts`' message build the name with `loadSymbolOf`. Carried: `link-scripts.ts`' parsing regex, and one `linkerDefinedNames(modules)` for names.ts, rename.ts and text-layout.ts. **Fixed at fix round 4, step 1** (`10fe83a`, D99 a): `modules.ts linkerDefinedNames` read by names.ts, rename.ts, text-layout.ts and the ldscript check, whose `LOADADDR` pattern no longer spells the prefix and accepts only a name of that list. |
| architecture-r2-3 | minor | Carried: `runAddresses` through `runsAtOverrides`, `proposals.ts` through `runsAtSpans`, `DATA_ALIGN` and chunks.ts's `WORD` from `layout/align.ts`. **Fixed at fix round 4, step 1** (`10fe83a`, D99 b), as written. |
| architecture-r2-4 | minor | Carried: one `isAbsentError` in `shell/fs.ts` (ELOOP decided once) and `linkedFileBytes` as `isRegularFile` then `readBytes`. **Fixed at fix round 4, step 1** (`10fe83a`, D99 c): `isAbsentError` (ENOENT, ENOTDIR, ELOOP) at every shell site that read ENOENT with ENOTDIR; a link loop is now absent in `isDirectory`, `isRegularFile` and `digestOf` too. |
| architecture-r2-5 | minor | Carried: `placeSignatures` made module-private and dropped from `api/proposals.ts`; `explain.test.ts` through `signaturesOver`. **Fixed at fix round 4, step 1** (`10fe83a`, D99 d), as written. |
| architecture-r2-6 | minor | Carried: `nameBase`'s positional `rewriteWords` replaced by an options object, with a unit case for the own spelling (Q15's second row). **Moved to the step of fix round 4 that applies Q15** (D99 g), which removes the bench's rewrite and its parameter. Done there (D102 b): `nameBase` takes no such parameter, since the rewrite is gone. |
| architecture-r2-7 | minor | Carried: the `.syntax mixed` refusal text, `bytes.ts`' header, and the frozen `g4.c-data-fails-loud` header that quotes the C-data assertion's old text (the gate file is not edited; its pattern still matches the new text). **Fixed at fix round 4, step 1** (`10fe83a`, D99 e) but the gate header: the refusal names both dialects read, `bytes.ts`' header names its readers; `g4.c-data-fails-loud` is not among the gate files the owner authorised, so its comment stays. |
| correctness-r2-2 | minor | Carried: `make expected` writes `expected/*.o`, `expected/rom/*.o` and `expected/rom/*.bin` under a generated root, so each later `generate` warns `W_UNOWNED_FILE` for each (sa1 69, Klonoa 81). **Moved to the step of fix round 4 that applies Q12** (D99 g), which changes what `make expected` writes. **Fixed at fix round 4, step 3** (D101 c): the targets are `build/expected/<module>.o` and nothing else is written; `generate` after `make expected` warns none (sa1 0, Klonoa 0). |
| correctness-r2-3 | minor | Carried: `rename` skips a symbolic link to a directory under `include/` with `W_RENAME_SKIPPED` without reading its files, so a file there that names `old` keeps it (exit 0). **Fixed at fix round 4, step 1** (`10fe83a`, D99 f): every rename text behind the link is read and listed as skipped with its bytes, so `rename` refuses one that names `old` (`E_RENAME_SKIPPED_FILE`); a file rename edits by its own path is not listed; new read-inputs test. |

### Fix round 4, step 1 (the owner's answers, D98, D99)

The owner answered the open questions on 25 October 2026. This step applied the answers that are gate edits and
records (Q1, Q2, Q3, Q5, Q8, Q9, Q11, Q13, Q14; each recorded under its question above) and fixed seven of fix round 3's
nine carried minors (the table above; two moved to the steps of Q12 and Q15). Commits: `fb16a0f` (the gate edits),
`10fe83a` (the minors), then the documents. Measured on `10fe83a` in a fresh worktree (`romlift-wt/phase-6-step1`, the
signature files built, `bench/.local/agbcc` and `bench/.local/poc` copied in):

| Command | Exit | Output |
| --- | --- | --- |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,850 tests, 2,850 pass |
| `g6.reconciler` (ci) | 0 | 9 cases, 11 golden tests, 16 comment and string tokens untouched (1 s) |
| `g6.rename` (ci) | 0 | `sub_080000F4` renamed on the composite fixture; both refusals change nothing (3 s) |
| `g6.evidence-conflict` (ci) | 0 | 162 contradictions on 54 fixtures (0.4 s) |
| `g4.toml-mutations` (ci) | 0 | 212 legal edits (move-start 42, rename 54, delete-function 51, add-override 23, split-module 42; add-override found no place on 31 fixtures), 215 illegal edits, 54 ROMs (467 s) |
| `g4.toml-mutations` (real) | 0 | 242 legal edits (move-start 48, rename 60, delete-function 57, add-override 29, split-module 48; add-override on all six tuning ROMs), 239 illegal edits, 60 ROMs (977 s) |
| `g6.signatures-judged` (real) | 0 | every PoC floor held; tmc libagbsyscall 13, m4a 55 and 10, 68 placements, 0 wrong (its owner floor); sizes fe7j 20 = 15 + 5 unjudged, klonoa 17 = 15 + 2, pokeemerald 17 = 15 + 2, sa2 17 = 15 + 2, sa3 19 = 17 + 2, tmc 5 = 0 + 5; pokeemerald 1 reviewed name reported (14 s); a scratch copy with tmc's m4a floor 56 and placements 69 fails: "tmc: m4a 55 functions < the owner's 56; tmc: 68 placements < the owner's 69" |
| `g6.ram-code-mapped` (ci, real) | 0, 0 | the RAM-copy fixture (57 s); and Klonoa `0x0804F318 -> 0x03000388` (124 s) |
| `g6.expected-bytes` (ci) | 0 | 225 modules on 54 ROMs (78 s) |
| `g3.self-check`, `g3.link`, `g6.explain-coverage` (ci) | 0 | 54 fixtures; 54 linked; 58 analysis and 5 sig rule ids in 213 goldens |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/{ram-code,config-mutations,emission-real}` | 0 | 9 of 9 (48 s) |

Not run in this step: the full closing list (the round's last step runs it), `g6.objdiff` (Q6 and Q15), `g1.provenance`
and `bench provenance` (they read the committed artifact, which the closing run regenerates).

### Fix round 4, step 2 (Q10, D100)

Q10 applied as the owner chose: `src/core/analysis/driver/listed-extent.ts` (`checkListed` calls its
`whyListedInvalid`; `validity.ts firstInvalid` judges an ARM entry by every rule's `check`), its unit test beside the
driver's, `test/local/listed-invalid-signatures` pinning the empty set, and `test/local/decompiled-c` running `init`
with signatures again. Measured on the phase branch with the built signature files (rebuilt from the six specs into a
scratch directory: byte-equal to `signatures/*.json`):

| Command | Exit | Output |
| --- | --- | --- |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,855 tests, 2,855 pass (the new `listed-extent.test.ts`: 5) |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/listed-invalid-signatures` | 0 | no `W_LISTED_INVALID` on fe7j (134 signature-named functions), klonoa (120), pokeemerald (377), sa2 (147), sa3 (189), tmc (68); 17 before (15 s) |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/listed-invalid` | 0 | 0 on each ROM, and the other diagnostics as phase 3; with every listed entry validated fe7j 2, klonoa 1, pokeemerald 3, sa2 1, sa3 1, tmc 21 (5, 4, 6, 4, 4, 24 before: three fewer on each ROM) |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/epoch-reuse` | 0 | 'epoch-reuse' equals 'epoch' on the six tuning ROMs |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/decompiled-c` (with signatures) | 0 | 1 of 1 to klonoa's SHA-1 (142 s) |
| `g2.determinism`, `g3.self-check`, `g3.link` (ci) | 0 | 54 fixtures each |
| `g4.e2e-fixtures`, `g4.generate-idempotent` (ci) | 0 | 53 fixtures built to their SHA-1; every fixture's generate keeps every file |
| `g4.toml-mutations` (ci, real) | 0, 0 | ci 212 legal edits (add-override 23), 215 illegal, 54 ROMs (464 s); real 242 legal (add-override 29), 239 illegal, 60 ROMs (956 s) |
| `g6.explain-coverage`, `g6.evidence-conflict`, `g6.reconciler` (ci) | 0 | 58 analysis and 5 sig rule ids in 213 goldens; 162 contradictions on 54 fixtures; 9 cases |
| `g2.confirm-equals-discover`, `g4.e2e-real` (real) | 0, 0 | tmc's recorded limitation only; the six tuning ROMs to their SHA-1s (220 s) |


### Fix round 4, step 3 (Q12, Q16, D101)

Q12 and Q16 applied as the owner chose, with fix round 3's carried correctness-r2-2: the `expected` writer emits only
`expected/<module>.s`; the scaffold's `make expected` assembles it as it is into `build/expected/<module>.o` (no
`expected/rom/`, no ROM bytes written over `.text`, no `READELF`); `modules.mk`'s `EXPECTED_OBJS` and `objdiff.json`'s
`target_path` name that object; the text-layout check drops the ROM file and lays a `runs_at` module's target out at
its run address; `g6.expected-bytes` links every target at its module's address with its own linker script and judges
the linked bytes and every placed symbol, and runs code-copied-to-ram a second time with its `ramCopy` as a
hand-written `runs_at` override; `test/local/objdiff-json` requires every function at 100% on untouched sa1 and klonoa
projects; architecture §6.1, §6.8 and §13, the roadmap's threshold, D95 a and D96 a (each marked replaced by D101),
README and the scaffold's `AGENTS.md`, `README.md` and `Makefile` follow. Measured on the phase branch:

| Command | Exit | Output |
| --- | --- | --- |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,854 tests, 2,854 pass (the text-layout test of `expected/rom/<module>.s` removed) |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/objdiff-json` | 0 | 3 of 3: c-data every unit at 100%; sa1 0 of 2,013 functions in 14 units below 100% (33 before); klonoa 0 of 422 in 12 units (51 before) (15 s) |
| `g6.expected-bytes` (ci) | 0 | 229 modules on 55 targets, 1 `runs_at` (68 s) |
| `g6.expected-bytes` (real) | 0 | 452 modules on 61 targets, 1 `runs_at` (131 s) |
| scratch copy of `g6.expected-bytes`, c-data with the `sub_080000F8` and `sub_0800010C` includes of `expected/main.s` swapped (correctness-r1-1) | 1 | "c-data: main: build/expected/main.o linked at 0x080000F4 differs from the ROM at 0x080000F8 (sub_0800010C) \| c-data: main: sub_080000F8 links at 0x0800011C, where the model places it at 0x080000F8 \| c-data: main: sub_0800010C links at 0x080000F8, where the model places it at 0x0800010C" |
| scratch copy linking the `runs_at` module at its load address (Q16's check) | 1 | "code-copied-to-ram+runs_at: data: gUnk_0800012C links at 0x0800012C, where the model places it at 0x03000000 \| … sub_0800012C links at 0x0800012C, where the model places it at 0x03000000 \| … main: build/expected/main.o linked at 0x080000F4 differs from the ROM at 0x08000110 (sub_080000F4)" |
| scratch copy on Klonoa with `bench/overrides/klonoa.json`'s override (measured, not a gate target) | 0 | 27 modules, 1 `runs_at` (`0x0804F318 -> 0x03000388`) |
| `init`, `make expected`, `generate --json` (correctness-r2-2) | 0 | `W_UNOWNED_FILE` sa1 0 (69 before), Klonoa 0 (81 before); `build/expected/` holds 23 and 25 objects |
| `g3.checks-fail`, `g3.golden-writers`, `g3.link`, `g3.raw-link`, `g3.self-check`, `g3.text-layout`, `g3.tree-determinism`, `g4.c-data-fails-loud`, `g4.checks-fail`, `g4.cli-contract`, `g4.e2e-fixtures`, `g4.generate-idempotent`, `g4.packed-e2e`, `g4.worktree`, `g6.c-data-ranges`, `g6.ram-code-mapped` (ci) | 0 | 16 pass (988 s) |
| `g3.link`, `g3.raw-link`, `g3.self-check`, `g3.text-layout`, `g3.tree-determinism`, `g4.generate-idempotent`, `g4.worktree`, `g6.ram-code-mapped`, `g4.e2e-real` (real) | 0 | 9 pass on 60 ROMs (the six tuning ROMs to their SHA-1s in `g4.e2e-real`, 210 s; Klonoa's override in `g6.ram-code-mapped`) (1,117 s) |

Not run in this step: the full closing list (the round's last step runs it), `g6.objdiff` (Q6 and Q15, the next step),
`g1.provenance` and `bench provenance` (they read the committed artifact, which the closing run regenerates).

### Fix round 4, step 4 (Q6, Q15, D102)

Q6 and Q15 applied as the owner chose (the answer and every count before and after, per class, are under Q6): the
printer's one word rule (`src/core/model/resolver.ts wordNameOf`, `linkedWordOf`; `print/pool.ts wordText` and the
label scopes and `gUnk_` candidates of `model/labels.ts` read it; `model.ts` builds the model's functions before the
labels so both read one `sizedEntries`); the bench's `objectWords`, `dataNameAt`, `ownSpelling` and `--own-spelling`
removed (`bench/src/objdiff.ts`, `bench/tools/objdiff-classes.ts`, carried architecture-r2-6 with them); D34 amended in
the classifier (`bench/src/objdiff-classes.ts isGated`, `classTotals`, `value-named` with an addend) and in the
verdict, whose row member gains `classes`; the ceiling file `bench/baseline/objdiff-ceiling.json` with its reader and
lowering writer (`bench/src/objdiff-ceiling.ts`, `objdiff-classes.ts --write-ceiling`); `test/gates/g6.objdiff.test.ts`
as the owner authorised; D34's revision, D96 b marked replaced, D102, architecture §5, §8.4 and §13, the roadmap,
AGENTS.md and README follow. No golden changed (no committed fixture has a sized entry, or a pool word naming another
module's local label), so none was regenerated. Commits: `644af21` (the code, the gate and the ceiling file), then the
documents. Measured on the phase branch at `644af21`:

| Command | Exit | Output |
| --- | --- | --- |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 tests pass |
| `npm test` | 0 | 2,859 tests, 2,859 pass (new: `wordNameOf` and `linkedWordOf` in `resolver.test.ts`, two label cases, two ceiling cases; the `objectWords` case removed) |
| `node --conditions=source bench/tools/objdiff-classes.ts` (before, `77ae472`; with and without `--own-spelling`) | 0, 0 | gated fe7j, klonoa, pokeemerald, sa2, sa3, tmc 19, 131, 157, 4, 55, 17 and 21, 135, 201, 2,665, 1,664, 51 (Q15's two rows; 50 s each) |
| `node --conditions=source bench/tools/objdiff-classes.ts --write-ceiling` (after) | 0 | gated (D34 as amended) 7, 1, 12, 1, 4, 25, written as the ceilings; uncompared 0, 130, 2, 0, 0, 0; same word 14, 4, 182, 2,663, 1,654, 25; every class but `unnamed-target` 21, 135, 196, 2,664, 1,658, 50 (50 s); a second run gives the same counts |
| `g6.objdiff` (real) | 0 | fe7j 1,471 functions, gated 7 of ceiling 7; klonoa 485, 1 of 1, 130 uncompared; pokeemerald 15,850, 12 of 12, 2 uncompared; sa2 2,887, 1 of 1; sa3 4,305, 4 of 4; tmc 8,388, 25 of 25 (155 s) |
| scratch ceiling file with tmc 24 (restored after) | 1 | "objdiff: tmc: 25 gated differences above its ceiling 24 (classes: 11 value-named, 9 alias, 5 value-for-symbol, 25 relocation-other, 315 unnamed-target); CreateRandomItemDrop relocation-other +0x680 R_ARM_ABS32: gObjectDroptables \| gAreaDroptables \| …" |
| `npm run bench -- run --scaffold` | 1 | every tuning ROM: raw link SHA-1, readable link SHA-1, init build SHA-1 (init 0, setup.sh 0, make 0); both sealed ROMs' init builds SHA-1; exit 1 only because it does not write `bench/results.json` (the printer member's corpus is stale: `npm run corpus` first, which the closing run does) |
| `g3.link`, `g3.raw-link`, `g3.self-check`, `g3.text-layout`, `g3.tree-determinism`, `g3.golden-writers`, `g4.e2e-fixtures`, `g4.generate-idempotent`, `g6.expected-bytes` (ci) | 0 | 9 pass: 54 fixtures linked by both printers, 8 writers × 54 fixtures equal their goldens, 53 fixtures built to their SHA-1, 229 expected modules on 55 targets (434 s) |
| `g3.link`, `g3.raw-link`, `g3.self-check`, `g3.text-layout`, `g3.tree-determinism`, `g3.readability`, `g4.e2e-real`, `g6.expected-bytes` (real) | 0 | 8 pass on 60 ROMs: the readable printer links 6 of 6 tuning ROMs, `g4.e2e-real` the six to their SHA-1s, readability at its floors, 452 expected modules on 61 targets (619 s) |
| `ROMLIFT_REQUIRE_LOCAL=1` `test/local/{objdiff,objdiff-json,emission-real}` | 0 | 10 of 10: the misnamed pool word still fails the verdict (gated 1); sa1 0 of 2,013 and klonoa 0 of 422 functions below 100%; both printers' trees of the six tuning ROMs link (60 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree |

Not run in this step: the full closing list (the round's last step runs it), `g1.provenance` and `bench provenance`
(they read the committed artifact, which the closing run regenerates).


### Fix round 5 (review of `3befe08`, D104)

16 findings (1 major, 15 minor; gate-honesty-o0-4 a recorded empty scope check). Every one is fixed or recorded; none
is rejected and no owner question is raised. Commits on `phase-6`: `43c89f0` (code, gates and tests), `d66d802`
(documents), then this record with run 6 (all 20 commands exit 0).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-o0-1 | major | Fixed (`43c89f0`, D104 a), within the owner's answer to Q11 ("the add-override edit must be one that changes the model", no override kind named). Measured first, on the 54 fixtures: no `code` override without `runs_at` changes a confirm model (its seed takes nothing unlisted, nothing listed is new, and `placeEntries` gives an override's extent only to a listed entry the analysis did not take, which happens only inside a data override), and a `data` override over the deleted F changes nothing either (0 of 54). The edit is now a `data` override over a listed function's trailing pool words, F still listed; the gate keeps it only when `buildModel`'s functions' extents or chunks differ from the original config's, and requires no `W_OVERRIDE_IGNORED`, the SHA-1 and `make` as before. `acceptedByOverride` is gone. ci tier: 243 legal edits (add-override 54, every fixture), 215 illegal (423 s); real tier in run 6: 273 legal edits (add-override 60, every fixture and tuning ROM), 239 illegal. The gate header, D98 d (corrected in place) and Q11's "Applied" text no longer say F is accepted. |
| correctness-o0-2 | minor | Fixed (`43c89f0`, D104 d): `appliedOverrides` no longer counts a code override whose seed only gave an unlisted finding; `W_OVERRIDE_IGNORED` names the unlisted start and `analyze --update`; `model.test.ts` asserts it. |
| correctness-o0-3 | minor | Recorded in "Known limitations" (the ci tier's one `runs_at` target has every symbol at offset 0; the review's Klonoa measurement shows the check works deeper). |
| correctness-o0-4 | minor | Fixed (`43c89f0`, D104 b): `g6.objdiff` fails a committed ceiling above the owner's D102 value and a tuning ROM whose readable build does not link. |
| correctness-o0-5 | minor | Recorded in "Known limitations" (a sized entry drops the `gUnk_` labels inside it; C naming one fails at `make`). |
| gate-honesty-o0-1 | minor | Fixed (`43c89f0`, D104 b, D102 d): `OWNER_CEILINGS` in `g6.objdiff` (fe7j 7, klonoa 1, pokeemerald 12, sa2 1, sa3 4, tmc 25); a value above it or an unknown ROM in `bench/baseline/objdiff-ceiling.json` fails the gate before it runs the bench. |
| gate-honesty-o0-2 | minor | Fixed (`43c89f0`, D104 c): `ObjdiffVerdict.pass` removed; the unit and local tests assert `classes.gated`. |
| gate-honesty-o0-3 | minor | Fixed (`d66d802`): Q8, Q13 and Q14 quote D98 b's full sentence. |
| gate-honesty-o0-4 | minor | Recorded: the review's empty scope check of the gate, bench and baseline diff since `615fb0e`, and its independent rerun of the closing list at `3befe08` (20 of 20 exit 0). Nothing to change. |
| architecture-o0-1 | minor | Fixed (`43c89f0`, D104 e): `foundation/asm/relocation.ts abs32Word`, (S + A) \| T, read by the layout (`LayoutInput.resolve` returns `SymbolValue`), core's `linkedWordOf` and the bench's `linkedWord`; the layout test of `.4byte F + 3, F + 4, F - 1, F, G - 1, G + 3` expects the words binutils 2.45.1 writes (0x08000003, 0x08000005, 0x07FFFFFF, 0x08000001, 0x0800001B, 0x0800001F), and the old test's `Func - 1` now expects ld's 0x08001233. |
| architecture-o0-2 | minor | Fixed (`43c89f0`): `BaseLabel.value`, `ObjectName.size` and `labelForWord` deleted; the pool test reads `wordText`. |
| architecture-o0-3 | minor | Fixed (`43c89f0`, D104 c): `pass` removed; `objdiffVerdict` classes each difference once (`countClasses`). |
| architecture-o0-4 | minor | Fixed (`43c89f0`): the `ValidityRule` contract names the ARM-part call (D100); `shell/index.md`'s `fs.ts` row names `isAbsentError`'s three codes. |
| architecture-o0-5 | minor | Fixed (`43c89f0`, D104 f): `resolver.ts entryLabelOf` is the `entryLabel` of `pool.ts wordText`, `labels.ts` candidates (through the run address's load address) and `labels.ts` scopes; `resolver.test.ts` covers a TOML-sized function of a `runs_at` module. |
| architecture-o0-6 | minor | Fixed (`43c89f0`, D104 g) without a gate change: `test/unit/emit/sized-entries.test.ts` links three fixture trees with a sized entry each (`gTable + 8` from another module, an odd word `name + 4` inside a TOML-sized Thumb function, an even word never `name + n`) to their SHA-1s with binutils, in `npm test`. No gate's config can hold a sized entry (each is `configFromDiscover`'s). |
| architecture-o0-7 | minor | Fixed with gate-honesty-o0-1 (`OWNER_CEILINGS`) and `lowerCeilings` refusing a ROM without a ceiling (D104 b). |
| architecture-o0-8 | minor | Recorded in "Known limitations" as carried past phase 6 (the frozen `g4.c-data-fails-loud` header's stale quote); no gate edit, so no owner question. |
