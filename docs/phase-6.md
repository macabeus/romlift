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

**Verdict.** Pending: waves 1 and 2 are merged on `phase-6`; wave 3 is to come. The phase lands only when every command of "The closing gate" exits 0
at `landed` 6 in a fresh worktree, every owner question below is answered, and the phase pull request's CI ran (a job
GitHub refuses to start is not a pass).

## Components

Twelve components in three waves on the branch `phase-6`, each on its flat branch under `romlift-wt/` (roadmap.md,
"Phase 6", "As executed (D93)"). Git cannot hold the branch `phase-6` beside `phase-6/<component>`, so the component
branches are spelled `phase-6-<component>` (AGENTS.md's spelling). Planned merge order: wave 1 lead, analysis-layout,
hygiene, reconcile-carried; wave 2 signatures-build, c-data-expected, ram-code, rename, include-links; wave 3
signatures-match, proposals and the twelfth. As executed: wave 2 merged signatures-build, signatures-match (moved up from
wave 3), ram-code, rename and c-data-expected, in that order; include-links did not merge in wave 2 and moves to wave 3.

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
| `p6-include-links` | 3 (planned 2) | | planned | the cpp-exact include resolution behind a symbolic link (D89 a, D90 a), gate-honesty-e1-1 |
| `p6-signatures-match` | 2 (planned 3) | `phase-6-p6-signatures-match` | merged `b635800` | roadmap 6.B: the matcher, the five rules, resolution and proposals; `romlift signatures <rom>` and `bench signatures` not yet |
| `p6-proposals` | 3 | planned | | roadmap 6.D |
| (the twelfth) | 3 | planned | | named with its files at its merge |

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
  proposed; this is recorded so the failing phase-4 gate on `phase-6` is not mistaken for a regression.

Candidates still open (written up with their measured facts and options when they arise):

- **`g6.objdiff`'s remainder**, if the gate still fails after the fix rounds: D34 as written gates every difference but
  `unnamed-target`; phase-3.md Q1 counted 200, 320, 13,788, 1,374, 564 and 895 gated differences on fe7j, klonoa,
  pokeemerald, sa2, sa3 and tmc. No amendment is assumed.
- **`g6.signatures-judged` on tmc.** The pinned PoC baseline has no signatures row for tmc (revealed after it was pinned,
  D60), so the gate as phase 1 wrote it fails on tmc for want of a floor; as aligned by D93 h it judges tmc by the ELF
  checks with no floor. That restatement is not in the owner's words: it is written up at integration with the measured
  tmc placements, unless the owner's decision covers it.
- **`g4.toml-mutations`' edits** (correctness-b0-5's add-override edit that changes the model, correctness-b0-4's odd
  `[functions]` key among the illegal edits): each changes a gate the owner has not authorised (D81 c); p6-analysis-layout
  builds the product side, and the gate edits wait for his word.
- **Any other gate change** a component finds it needs.

## Known limitations

- **Code run from RAM needs a hand-written override** (D91): nothing proposes `runs_at`; a user writes the
  `[[overrides]]` entry, and the analysis, the model and the ldscript honour it.
- **No import path for an existing decomp's function list** (D92): `import-legacy` is not built; a project starts from
  `init`.
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

## The closing gate

The list, run in this order in a fresh worktree at `landed` 6, the real tier before the ci tier (D54 i):

```
npm ci
npm run typecheck
npm test
npm run fixtures -- check
for s in signatures/specs/*.json; do node --conditions=source src/cli/main.ts signatures build "$s"; done
npm run build && npm pack --dry-run
npm run test:local
npm run bench -- doctor-real
npm run bench -- run --scaffold
npm run bench -- regression
npm run bench -- gates --require 6 --tier real
npm run bench -- gates --require 6 --tier ci
```

Then the phase pull request: `ci.yml`, `printer.yml`, `provenance.yml`, `fixtures.yml` and `packed.yml` must run.

Not run yet.

## Review

None yet.
