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

**Verdict. NOT LANDED.** Waves 1 to 3 are merged on `phase-6`, the closing round fixed what failed in the code (the
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
- **objdiff targets and C data** (6.F, phase 5's 5.C). `expected/<module>.s` (every module's ROM range as an object
  without relocations, `make expected`), `objdiff.json` (one unit per `c` module), and the `[[modules]]` key
  `data_start`, whose range is the C object's `.rodata` in place of phase 4's C-data assertion.
- **The carried minors** of phase 4 (roadmap "Carried from phase 4"), each with its component in the table below; the
  include resolution behind a symbolic link is cpp-exact.
- **Commands** added: `signatures build <spec>`, `signatures <rom>`, `rename <old> <new>`, `init --no-signatures`, `bench
  signatures [--loo]`. **Formats** added: signature file schema 3, signature spec, `expected/<module>.s`, `objdiff.json`,
  `data_start`, the two bench signature schemas.

## Components

Twelve components in three waves on the branch `phase-6`, each on its flat branch under `romlift-wt/` (roadmap.md,
"Phase 6", "As executed (D93)"). Git cannot hold the branch `phase-6` beside `phase-6/<component>`, so the component
branches are spelled `phase-6-<component>` (AGENTS.md's spelling). Planned merge order: wave 1 lead, analysis-layout,
hygiene, reconcile-carried; wave 2 signatures-build, c-data-expected, ram-code, rename, include-links; wave 3
signatures-match, proposals and the twelfth. As executed: wave 2 merged signatures-build, signatures-match (moved up from
wave 3), ram-code, rename and c-data-expected, in that order; include-links did not merge in wave 2 and moves to wave 3.
Wave 3 merged signatures-apply (the twelfth), proposals, objdiff and include-links, in that order.

| Component | Wave | Branch | Status | Delivers |
| --- | --- | --- | --- | --- |
| `p6-lead` | 1 | `phase-6-p6-lead` | merged `b541eb6` | D91 to D93; the frozen contracts (signature schema and spec with their validators, proposal sources, `data_start`, the workflow and explain types, `CheckProposals`); the empty barrels, rule registry, codes and command lists; the gates (four g5 deleted, five renamed to g6, `g6.ram-code-mapped` and `g6.evidence-conflict` restated, the `klonoa` gate input dropped); the documents; then the integration after each wave |
| `p6-analysis-layout` | 1 | `phase-6-analysis-layout` | merged `b2beef8` | `seed.evidence-hint` and the `evidence` origin deleted (D91 e); architecture-b2-8; architecture-r1-3 with a0-4 and a1-5; correctness-b0-5; `g4.toml-mutations` |
| `p6-hygiene` | 1 | `phase-6-p6-hygiene` | merged `379d0f7` | architecture-r1-2, r1-4, r1-6 with a2-8, r1-8's remainder, a2-6 |
| `p6-reconcile-carried` | 1 | `phase-6-p6-reconcile-carried` | merged `14c62f7` | architecture-b2-9 (`core/reconcile/c-scan.ts`), b2-11, r1-7's remainder, gate-honesty-e1-2 |
| `p6-signatures-build` | 2 | `phase-6-p6-signatures-build` | merged `a03d417` | roadmap 6.A |
| `p6-c-data-expected` | 2 | `phase-6-p6-c-data-expected` | merged `fc559ac` | roadmap 6.F (architecture-r2-2 and r2-3 not done, carried to wave 3) |
| `p6-ram-code` | 2 | `phase-6-p6-ram-code` | merged `52ccc66` | roadmap 6.C |
| `p6-rename` | 2 | `phase-6-p6-rename` | merged `9c3e864` | roadmap 6.E, with correctness-r0-5's remainder |
| `p6-include-links` | 3 (planned 2) | `phase-6-p6-include-links` | merged `d0b7395` | the cpp-exact include resolution behind a symbolic link (D89 a, D90 a), gate-honesty-e1-1 |
| `p6-signatures-match` | 2 (planned 3) | `phase-6-p6-signatures-match` | merged `b635800` | roadmap 6.B: the matcher, the five rules, resolution and proposals; `romlift signatures <rom>` and `bench signatures` not yet |
| `p6-proposals` | 3 | `phase-6-p6-proposals` | merged `145a291` | roadmap 6.D: the library regions at legal borders and cut around `runs_at` ranges, `checkProposals`, the signature proposals in `init` and `analyze --update`, explain's signature part and the `sig.*` goldens |
| `p6-signatures-apply` (the twelfth) | 3 | `phase-6-p6-signatures-apply` | merged `379c599` | roadmap 6.B's remainder: `romlift signatures <rom>`, `bench signatures [--loo]`, the signatures family of `bench run` (`src/cli/commands/signatures.ts`, `bench/src/signatures.ts`) |
| `p6-objdiff` | 3 | `phase-6-p6-objdiff` | merged `11ec05d` | `g6.objdiff` (D34, D92): the readable printer's words inside named, sized entries and `.inst.n`, the objdiff family's base per reference object, one REL/RELA decoder (architecture-r2-2, r2-3) |

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

- **Q5. `g6.evidence-conflict` scenario (c) cannot pass on any fixture.** The gate takes the first two found functions
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
  the phase does not land; (b) amend D34 as phase-3.md Q1 option b.
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
  three on `61dd414`); not a gate (`g4.e2e-real` builds klonoa to its SHA-1, the warnings are warnings), but phase 4's
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

Open, each blocking the landing: Q1, Q2, Q3, Q5, Q6, Q8, Q9, Q10, Q11 (Q4 and Q7 need no answer).

## Known limitations

- **Code run from RAM needs a hand-written override** (D91): nothing proposes `runs_at`; a user writes the
  `[[overrides]]` entry, and the analysis, the model and the ldscript honour it.
- **No import path for an existing decomp's function list** (D92): `import-legacy` is not built; a project starts from
  `init`.
- **A load address of a `runs_at` module prints as a number** in a pool word, not as `__load_<module> + n`
  (`test/unit/model/resolver.test.ts` keeps it as a todo: `core/emit/print/pool.ts` and the text-layout check would
  both need the symbol). The tree links to the SHA-1 either way (`g6.ram-code-mapped`).
- **Signature-proposed functions the valid.* rules refuse warn `W_LISTED_INVALID`** in every confirm run (three on
  klonoa; Q10, until the owner answers).
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
npm pack --dry-run --json | node -e '…'   # exits 1 when a signatures/*.json outside signatures/specs/ is packed
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
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build (init, setup.sh, make) to the SHA-1 on all six; both sealed ROMs pass (init build SHA-1); objdiff gated differences (every class but `unnamed-target`) fe7j 19, klonoa 131, pokeemerald 157, sa2 4, sa3 55, tmc 17; memory family `init` 1,022.7 MiB, `generate` 974.1 MiB peak RSS under the 1,024 MiB cap (272 s) |
| `npm run bench -- regression` | 0 | no regression against `89deb54` |
| `npm run bench -- gates --require 6 --tier real` | **1** | 27 pass, 1 historical (`g2.poc-parity`), **1 fail: `g6.objdiff`** (Q6). Among the passes: `g6.signatures-judged` (every PoC floor held: fe7j libagbsyscall 18, libgcc 22, m4a 94 and 10; klonoa 6, 20, 94 and 10; pokeemerald 15, 67, 109 and 10, with agb_flash 22 and 4, librfu 148 and 5, siirtc 16 and 1; sa2 12, 24, 94 and 10, agb_flash 17 and 1; sa3 13, 65, 94 and 10, agb_flash 17 and 1; tmc libagbsyscall 13, m4a 55 and 10, no floor, Q9), `g6.signatures-loo` (7 runs, 0 added, moved or lost), `g6.signatures-heldout` (pokefirered 353 placements and 18 tables, pokeruby 226 and 15, none wrong), `g6.signatures-rebuild` (libagbsyscall, libgcc, m4a equal the PoC's converted files), `g6.expected-bytes` (448 modules on 60 ROMs), `g6.ram-code-mapped` (the RAM-copy fixture and Klonoa), `g2.speed` (ratio 0.960; sa2 765 of 783 ms, 97.7%; klonoa 259 of 306, tmc 1,505 of 1,784, sa3 1,173 of 1,492, pokeemerald 2,381 of 4,219, fe7j 1,186 of 12,692), `g3.speed-budget` (pokeemerald `generate` 8,946 of 9,611 ms, `init` 11,370 of 14,417 ms), `g4.e2e-real` (six tuning ROMs from the source tree and the tarball, sealed 2 of 2), `g4.toml-mutations` (273 legal edits, add-override 60 no-ops warning `W_OVERRIDE_IGNORED`, 179 illegal) (3,414 s) |
| `npm run bench -- gates --require 6 --tier ci` | **1** | 40 pass, **4 fail: `g1.provenance`** (the artifact records `g6.objdiff` failing), **`g6.evidence-conflict`** (Q5: scenario (c) on all 54 fixtures), **`g6.reconciler`** (Q2: all nine cases), **`g6.rename`** (Q3: "no src/*.c names sub_08000000"). Among the passes: `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (750 files, no built signature file), `g3.large-rom` (`init` 1,019.8 MiB, `generate` 1,021.5 MiB), `g6.c-data-ranges`, `g6.explain-coverage` (58 analysis and 5 sig rule ids in 213 goldens), `g6.no-heldout-references` (6 specs, 12 references) (1,938 s) |
| `npm run bench -- provenance` | **1** | source digest `393eefba…` ok (Node 24); **gate record: `g6.objdiff` is fail**; families live; 6 rows, no sealed row |

Four commands exit 1, so **phase 6 does not pass its closing gate**. Every failing gate is one whose file cannot pass as
written (Q2, Q3, Q5) or one D34 gates as written (Q6, and with it `g1.provenance` and `bench provenance`); none is
changed here. sa2's `g2.speed` at 97.7% of its limit is at the top of the spread phase 4 recorded (85.6% to 97.7%); the
analysis did not change in this phase's closing round. `bench/results.json` is committed as run 2's artifact.

## Review

None yet.
