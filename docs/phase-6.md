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
- **objdiff targets and C data** (6.F, phase 5's 5.C). `expected/<module>.s` and `expected/rom/<module>.s` (since fix
  round 1 the module as its unit assembles it, with the ROM's bytes written over its `.text` by `make expected`, its
  relocations kept, D95 a), `objdiff.json` (one unit per `c` module), and the `[[modules]]` key `data_start`, whose
  range is the C object's `.rodata` in place of phase 4's C-data assertion.
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
  Q10.

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
- **`decompiled-c` runs `init --no-signatures`** (Q10).
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
- **Q2. `g6.reconciler` cannot pass any add, remove or move case.** It requires the comment, string and char tokens of
  `expected.c` to equal those of `input.c`, but every `INCLUDE_ASM` statement holds the string `"asm/nonmatchings/<m>"`,
  so adding or removing a stub always changes them. Measured on all nine goldens of `test/golden/reconcile/` ("comments
  or strings differ between input.c (4) and expected.c (5)", and so on); the golden runner, which skips that string,
  passes. Options: (a) the gate skips the string directly after `INCLUDE_ASM (`, as the golden runner does; (b) another
  rule the owner names. The gate file is not edited.
- **Q3. `g6.rename` picks a function no C file names.** Its regex `/= "(sub_[0-9A-F]{8})"/g` also matches `name =
  "sub_…"` inside inline tables, so on the composite fixture it picks `sub_08000000` (the asm module `rom_header`):
  "no src/*.c names sub_08000000". With `/^0x[0-9A-F]{8} = "(sub_[0-9A-F]{8})"$/gm` in a scratch copy, `p6-rename`
  measured the gate passing (2.3 s). Options: (a) that regex; (b) another selection the owner names. The gate file is
  not edited.
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
- **Q9. `g6.signatures-judged` judges tmc with no floor.** The pinned PoC baseline has no signatures row for tmc
  (revealed after it was pinned, D60), so the gate as phase 1 wrote it had no floor for it; D93 h, not the owner's words,
  judges tmc by the ELF checks alone. Measured at the closing round: tmc libagbsyscall 13 functions, m4a 55 functions and
  10 tables; 68 placements (67 at an ELF `FUNC`, 1 at a listed untyped address, 0 wrong), 10 tables all `OBJECT`s of
  their size, 5 proposed sizes. Options: (a) accept no floor for tmc; (b) take these counts as tmc's floor; (c) another
  rule the owner names.
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
- **Q11. `g4.toml-mutations`' edits** (correctness-b0-5, b0-4, carried). `p6-analysis-layout` built the product side
  (a `data` override claims its span, a `code` override seeds `seed.override`), but the gate's add-override edit still
  covers a found function exactly, a no-op that warns `W_OVERRIDE_IGNORED` (run 1: 273 legal edits, add-override 60 such
  no-ops; 179 illegal edits), and no odd `[functions]` key is among its illegal edits. Each change is a gate change the
  owner has not authorised (D81 c). Options: (a) make the add-override edit one that changes the model and add the odd
  key; (b) keep the gate as it is.

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
- **Q13. `g6.signatures-judged` leaves `unjudged` sizes out of its comparison.** The bench counts a proposed size as
  `unjudged` when the ELF has no size for the symbol, its size is 0, or the FUNC spans another FUNC (bench/src/signatures.ts),
  and the gate tested only `differ`; architecture §8.4 said every proposed size equals the ELF size. Measured in the
  committed artifact of run 2: tmc 5 proposed, 0 equal, 5 unjudged (none of tmc's sizes is compared, which with Q9's
  missing floor leaves tmc judged by placements and tables alone); fe7j 20 and 5; klonoa 17 and 2. Fix round 1 made the
  gate require equal + differ + unjudged = proposed and report the unjudged count (correctness-4, a tightening), and
  wrote the exemption into §8.4; the exemption itself is not the owner's words. Options: (a) accept `unjudged`; (b) the
  gate fails on an unjudged size (tmc, fe7j and klonoa fail until the bench can judge them); (c) another rule.
- **Q14. `g6.signatures-judged` compares member symbols, not display names, on a reference ROM.** Phase 4's gate text
  required "on a reference ROM, every name equal to that reference's symbol"; D93 h (the lead's, not the owner's words)
  compares the MemberId's symbol and only reports a reviewed display name. Measured case (correctness-3): on pokeemerald,
  a libgcc reference, `romlift signatures pokeemerald.gba` gives `0x082E8B70 function thumb _fpadd_parts_f
  (_fpadd_parts@fp-bit.o, libgcc@agbcc)`, while the ELF symbol there is `_fpadd_parts`; run 2's note gives
  `pokeemerald: … 1 reviewed names (reported)`. Under phase 4's text that name fails the gate. Until the owner answers,
  the gate stands changed without his authorisation. Options: (a) accept the member-symbol rule (a reviewed name may
  differ on its own reference); (b) restore the old rule, and the gate fails on pokeemerald until the spec's reviewed
  name goes (the PoC's ad hoc `_dp`/`_f` disambiguation, D31); (c) another rule.

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

Open, each blocking the landing: Q1, Q2, Q3, Q5, Q6, Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15 (Q4 and Q7 need no answer).

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
- **objdiff on an untouched project** scores every function at 100% but the class of Q12 (klonoa 51 of 422, sa1 33 of
  2,013): a base jump-table word or a call to the function right after, whose relocated field objdiff reads as an addend.
- **The signature layer warns about libraries a game does not link**: every klonoa `init` reports `W_SIGNATURE_AMBIGUOUS`
  for librfu@2004 (`Callback_Dummy_ID` fits at 3 places, `rfu_setMSCCallback` at 2) and `W_SIGNATURE_DROPPED` for
  m4a@2004 (96 of its 96 placements overlap the version that placed more). They are warnings of the matcher's resolution
  and change nothing in the config (delivery-12); suppressing them for a version with no settled placement is left to a
  later phase.
- **`verify --link` does not judge a C data range's C**: it links the range's ROM bytes as a stand-in `.rodata`, so a C
  file that leaves part of its range undefined passes it while `make` fails; a range whose `data_start` lies at or past
  its module's end takes the `data` modules after it (architecture §6.6, correctness-11).
- **Signature-proposed functions the valid.* rules refuse warn `W_LISTED_INVALID`** in every confirm run (17 on the six
  tuning ROMs, three on klonoa; Q10, until the owner answers; pinned by `test/local/listed-invalid-signatures`).
- **objdiff-cli 3.7.2 cannot read one klonoa reference object** (`src/code_0804B254.o`, "Invalid instruction size 1"):
  its 130 functions are uncompared (`tool`, Q6).
- **correctness-b2-3's remainder stays carried**: `modules.mk` records only `romlift.toml`'s SHA-1, not the romlift
  version, until romlift is published (D76 d).
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

Then the phase pull request: `ci.yml`, `printer.yml`, `provenance.yml`, `fixtures.yml` and `packed.yml` must run. Not
opened: the list does not pass. This is the orchestrator's list (roadmap "Phase 6 exit" now reads the same). Both runs
used `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler`,
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
