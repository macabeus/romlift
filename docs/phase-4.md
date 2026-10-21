# Phase 4: One shot

The record of phase 4 (roadmap "Phase 4", architecture §2.1, §3.4, §6.3 to §6.6, §13, D20, D21, D23, D47, D49, D51,
D62 to D81). It is kept by the phase lead: the components as they merge, every deviation from the roadmap, the owner
questions, the known limitations, the measured numbers and the closing gate. Every number is measured on the owner's
machine with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. The tuning set is six ROMs (fe7j, klonoa, pokeemerald,
sa2, sa3, tmc; D60), and every phase-4 threshold applies to all six (D74 j); the held-out ROMs (pokefirered, pokeruby)
run sealed and report counts only (D25).

**Verdict.** Phase 4 passes its closing gate at `landed` 4. The owner answered Q1, Q2, Q3, Q5, Q6 and Q7 on 20 October
2026 (D76; Q4 was withdrawn by fix round 1), each applied exactly: Q2's answer is the one gate change (`g2.speed` takes
the median of nine runs per ROM), the others are recorded limitations or as built. The landing procedure then raised
`test/gates/phase.json` to `{ "landed": 4 }` (`55899d1`) and ran the whole closing list in a fresh git worktree with no
local caches ("The closing gate", the owner's answers): every command exited 0, `gates --require 4` passed on both
tiers, and sa2 passed `g2.speed` at 731 of 790 ms. Two fix rounds followed the reviews of that run (D77, D78); the
third, fix round 3, re-ran the whole closing list at `2efb732` in a fresh worktree, every command exit 0, sa2 at 727 of
793 ms. The owner answered Q8 and Q9 on 21 October 2026 (D79), and fix round 4 (D80) applied them and fixed the review
of fix round 3; the whole closing list at `7c0a452`, in a fresh worktree with `landed` 4, exited 0 at every command,
sa2 at 731 of 782 ms ("The closing gate"). Fix round 5 (D81) fixed the review of that run; the whole closing list at `566d5f5`, in a
fresh worktree with `landed` 4, exited 0 at every command, sa2 at 777 of 796 ms ("The closing gate"). Fix round 6
(D82) fixed the review of that run; the whole closing list at `6c7b1a6`, in a fresh worktree with `landed` 4, exited 0
at every command, sa2 at 689 of 766 ms ("The closing gate"). Nothing is merged to `main` or pushed; the merge waits for the phase pull request's
CI (AGENTS.md).

## Components

Eleven components in three waves on the branch `phase-4`, each on its flat branch `phase-4-<component>` (roadmap.md,
"Phase 4", "As executed (D74)"). Merge order: wave 1 lead, emission-carried, confirm-listed; wave 2 config, scaffold,
c-modules, fixtures, safety-minors; wave 3 workflows, e2e, bench-init.

| Component | Wave | Branch | Status | Delivers |
| --- | --- | --- | --- | --- |
| `p4-lead` | 1 | `phase-4-lead` | merged (`1b68e59`) | the frozen workflow types, the scaffold contract and `MANIFEST.json`, the C-stub constants, the empty codes modules, barrels and command lists, the `core/verify` edge, the g4 gate files aligned, D74, this record; then the integration after each wave |
| `p4-emission-carried` | 1 | `phase-4-emission-carried` | merged (`8a9bebf`) | padding-only orphans folded into the next function (Q5 b); the readable `adr` naming a function label (Q7) and its fixture |
| `p4-confirm-listed` | 1 | `phase-4-confirm-listed` | merged (`3b96377`) | the confirm run no longer re-validates the functions configFromDiscover listed (Q5 c; scope: Q1) |
| `p4-config` | 2 | `phase-4-config` | merged (`7e47ec1`) | `parseConfig`, `serializeConfig`, `planPatch`, `renderDecompYaml`; `loadConfig`, `saveConfig`, `locateProject`; the patch-planner mutation test |
| `p4-scaffold` | 2 | `phase-4-scaffold` | merged (`2cd3133`) | the templates, `renderScaffold`, `readTemplates` |
| `p4-c-modules` | 2 | `phase-4-c-modules` | merged (`dd26b5b`) | `tokenizeC`, `planIncludeAsm`, the `c-stub` and `modules-mk` writers, the C-data ASSERT, C modules in configFromDiscover, the text-layout check and the link check |
| `p4-fixtures` | 2 | `phase-4-fixtures` | merged (`c185a7e`) | the `composite`, `multi-compiler` and `c-data` fixtures, old_agbcc in the fixture build |
| `p4-safety-minors` | 2 | `phase-4-safety-minors` | merged (`6af82e4`) | the lock and journal mutation tests; architecture-r2-4, correctness-ci-1, correctness-r0-2, gate-honesty-r0-1 |
| `p4-workflows` | 3 | `phase-4-workflows` | merged (`64d1d66`) | `init`, `generate` over a project, `analyzeUpdate`, the `init`, `generate`, `analyze --update` and `scaffold --diff` commands, the project mode of `model`, `verify` and `explain` |
| `p4-e2e` | 3 | `phase-4-e2e` | merged (`4e2e4df`) | `test/helpers/e2e.ts`, the TOML mutation property test, `packed.yml`, the fixtures workflow's init step |
| `p4-bench-init` | 3 | `phase-4-bench-init` | merged (`b318e60`) | `bench run --scaffold` through `init`, `setup.sh` and `make`; `init` and `generate` in `bench large-rom --bin` |

### p4-lead (wave 1)

- Frozen types (`src/core/workflow/types.ts`): `InitOptions`, `InitInputs`, `InitPlan`, `ProjectInputs`, `GeneratePlan`,
  `AnalyzeUpdateInputs`, `AnalyzeUpdatePlan` (D74 c).
- The scaffold contract (`src/core/scaffold/vars.ts`): `AgbccPin`, `ScaffoldVars` and `scaffoldVars`, the `@@<placeholder>@@`
  spelling (`SCAFFOLD_PLACEHOLDERS`, `placeholderValues`, `placeholderText`, `placeholdersIn`), `ScaffoldTemplate`,
  `ScaffoldManifest`, `ScaffoldTemplates`, `ROMLIFT_RENDERED_TARGETS`, `decodeScaffoldManifest`, `decodeAgbccPin` (D74 d);
  `templates/MANIFEST.json` and `templates/index.md`.
- The C-stub constants (`src/foundation/asm/dialect.ts`): `includeAsmStatement`, `NONMATCHINGS_ROOT`,
  `INCLUDE_ASM_HEADER_PATH`, `INCLUDE_ASM_HEADER`, `C_STUB_HEADER` (D74 e).
- The C build pipeline, object paths, modules.mk's variables and the C-data ASSERT, as text in D74 f and architecture
  §6.3 and §6.6 (implemented by `p4-scaffold` and `p4-c-modules`).
- Empty `src/core/{config,reconcile}/codes.ts` in the `core/diagnostic-codes.ts` union; empty barrels
  `src/api/{config,config-files,scaffold,scaffold-files,reconcile,workflow-one-shot,one-shot-files}.ts`; the frozen types
  and values exported by `src/api/one-shot-types.ts` from `romlift`; empty `cli/commands/lists/{one-shot,scaffold}.ts`.
- The edge `core/verify` → `core/reconcile`, `core/config/compilers.ts` (architecture §2, `test/helpers/architecture.ts`,
  D74 g).
- The g4 gate files: the comments name the frozen interfaces, every "five tuning ROMs" reads six, `g4.e2e-real` requires
  six tuning datasets; no assertion is weakened; every g4 gate is `pending` until `init` is exported.
- Tests: `test/unit/workflow/types.test.ts`, `test/unit/scaffold/vars.test.ts`, `test/unit/asm/dialect.test.ts`,
  `test/unit/api/phase4-exports.test.ts`; `test/unit/diagnostics/codes.test.ts` finds the two new codes modules unchanged.

## What phase 4 delivered

The one-shot workflow of the plan: in a directory holding only a ROM, `npx romlift init <rom> && ./setup.sh && make`
ends at the ROM's SHA-1 with no file edited, measured on 50 committed fixtures (every one but `c-data`, whose C array
must fail the link) from the source tree, from the installed tarball and in fresh git worktrees, and on the six tuning
ROMs (`bench run --scaffold`, below); `generate` right after `init` changes no file.

**Commands** (each with `--json`: NDJSON lines then a summary whose `exitCode` is the process's, architecture §2.1;
`g4.cli-contract`):

| Command | What it does |
| --- | --- |
| `romlift init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]` | creates the project in an empty directory: copies the ROM to `baserom.gba`, runs discover, `configFromDiscover` (agbcc-shaped modules as `c`), serialises `romlift.toml` in the canonical layout and parses it back, writes `decomp.yaml`, the scaffold, the `src/<module>.c` stubs and the generated tree through the write plan, then `npm install --package-lock-only` (`W_LOCKFILE_DEFERRED` when npm cannot resolve romlift) |
| `romlift generate [--rom <rom>] [--dry-run] [--out <dir>] [--json]` | inside a project (found by walking up to `decomp.yaml`): the confirm analysis over `romlift.toml`, the model, the check pass and the write plan under the project lock; the `INCLUDE_ASM` lines of every existing `src/<module>.c` reconciled with the TOML (fix round 1, D75 b); never opens the TOML for writing (`g4.no-toml-write`); a ROM whose SHA-1 is not `[rom] sha1` is `E_ROM_SHA1_MISMATCH` and a model error (`E_MODULE_BORDER`, …) writes nothing and exits 1; a keep-only plan is not applied, so mtimes stay |
| `romlift analyze --update [--write] [--json]` | discover's unlisted functions and nested labels as a patch of `romlift.toml` (`planPatch`, which keeps comments and refuses a restructured entry with `E_TOML_PATCH_REFUSED`); `--write` saves it atomically |
| `romlift scaffold --diff [--json]` | how each scaffold file differs from what the current templates render for the project; writes nothing |
| `romlift model`, `verify`, `explain` | without `--rom`, the project's ROM and TOML in confirm mode (phase 3's `--rom` behaviour unchanged) |

**Formats and files.**

- `romlift.toml`: `parseConfig` (smol-toml, the key-spelling and duplicate-address checks `E_TOML_KEY_SPELLING` and
  `E_DUPLICATE_ADDRESS` with line numbers, the zod schema `E_TOML_SCHEMA`) and `serializeConfig` (architecture §6.5's
  canonical layout; `serialize(parse(t)) === t` on every canonical text, `g4.toml-canonical`).
- `decomp.yaml`: `renderDecompYaml`, read back through `@match-kit/decomp-yaml`; `tools.romlift.config` names the TOML.
- The scaffold (`templates/MANIFEST.json`, D74 d): `Makefile` (modules.mk's `OBJS`, asm and data units by pattern rule,
  C units through `mk/<compiler>.mk`, `sha1sum -c <name>.sha1`; a C object rebuilt by the SHA-1 of its source and of
  modules.mk), `setup.sh` (five duties: toolchain check, agbcc at the pin of `templates/agbcc.json`, `baserom.gba` into a
  worktree, `npm ci`, `romlift generate` when `asm/` is absent), `.gitignore` (since the owner's answer to Q9 every generated root too, so a
  clone gets the tree from duty 5, D79 b), `AGENTS.md`, `README.md`, the build
  workflow, `.gitmodules`, `package.json` (the exact romlift version), `include/macros.inc` and `include/include_asm.h`.
- C modules (D74 e, f): `src/<module>.c` is `#include "include_asm.h"` and one `INCLUDE_ASM("asm/nonmatchings/<module>",
  <name>);` per chunk in ROM order (`planIncludeAsm` over the C tokenizer, never a regex over code; `W_C_ORDER`);
  `modules.mk` holds `OBJS`, `C_OBJS` and each C object's `CC1` and `CFLAGS`; the ldscript's `.c_data_<m>` section and
  `ASSERT` make C data fail the link loudly (`g4.c-data-fails-loud`); `agbcc` and `old_agbcc` per module
  (`g4.multi-compiler`).
- The phase-3 work items the owner assigned (D68 e, D72 c): padding-only orphans folded into a neighbour, the next
  function or, at a module's end, the chunk before when it stays assembly (fix round 1, D75 d; fix round 3, D78 b:
  never a function of a `c` module, whose decompiled C object gas ends with a nop; orphan files on pokeemerald 3,222
  → 23, tmc 2,321 → 33, fe7j 1,558 → 32, sa3 882 → 15, sa2 464 → 16, klonoa 87 → 23; no byte changes; the 0x46C0 nop
  pads stay orphans, Q7; `test/local/padding-orphans.test.ts`); the confirm run validates only `[functions]` entries with `from`
  (W_LISTED_INVALID 0 on all six tuning ROMs, against fe7j 5, klonoa 4, pokeemerald 6, sa2 4, sa3 4, tmc 24 before;
  `test/local/listed-invalid.test.ts`); an `adr` names its target only by a label that links to the target itself
  (fixture `adr-function-label`, `test/unit/emit/adr-function-label.test.ts`), so the doubled pokeemerald ROM's
  readable `verify --assemble --link` links to its SHA-1 under the 1,024 MiB cap.
- Bench: `bench run --scaffold` also builds each tuning ROM through `init`, `setup.sh` and `make` (the row's
  `scaffold.init`, a sealed entry's counts only); `bench large-rom --bin` adds `init --json` and `generate --json`.
- Tests: `test/helpers/e2e.ts`, the pure TOML-mutation property test, the phase-4 mutation tests (lock, journal, patch
  planner; `g4.checks-fail`), `packed.yml` and the fixtures workflow's init, setup.sh and make step; three new fixtures
  (`composite`, `multi-compiler`, `c-data`) and `adr-function-label`, 51 in all.

### The closing round (`a4c753e`)

The first run of the closing list at `b318e60` failed `g3.large-rom` (and with it `test/local/large-rom-bin.test.ts`):
on the synthetic 32 MiB image, which phase 4's four new fixtures changed (SHA-1 `ba3f6988…`, built from all 51), `init`
and `generate` exited 1 with `E_MODULE_BORDER`, module `main_176` at 0x0949B910 (recorded above under wave 3 as failing
since `776a15b`). Cause: discover took 0x0949B910 as Thumb, and a `bx pc` at 0x0949B90C in the asm-only function at
0x0949B906 proposed it as ARM, which met the existing function. In confirm mode the listed entries are functions from
round 0, but `accept` checked only the entry: the ARM candidate, queued by the listed 0x0949B906 and popped before
0x0949B910's own seed, was taken in ARM with an empty extent, the chunk start moved, and 0x0949B910 was no longer a
legal border of the confirm layout, so `generate` refused the config `init` had just written. Fix
(`src/core/analysis/driver/{confirm,accept}.ts`, `isOtherModeOfListed`): a candidate whose entry is listed in the
other mode meets the listed function, as it does in discover once the entry is taken; it is neither taken nor
reported. Test: `test/unit/analysis/driver/confirm.test.ts` (fails without the fix). After it the synthetic image's
`init` and `generate` exit 0 with the tree `92610833…`; on the tuning ROMs the analysis goldens are unchanged, `bench
regression` finds no regression and every g2 gate passes (closing run below).

## Deviations from the roadmap

Recorded in D74: eleven components in three waves instead of 4.0, 4.A–4.E and 4.I (D74 a); Q5 b and Q7, which the
roadmap gives to 4.0, are the wave-1 component `p4-emission-carried`; Q5 c, which it gives to 4.D, is the wave-1
component `p4-confirm-listed`; `scaffold --diff`'s command moves from 4.B to `p4-workflows`; `p4-c-modules` also owns
configFromDiscover's kind flip, the C units of the text-layout and link checks and `objectPath` for C modules; 4.E is
three components; `src/shell/codes.ts` is not the lead's (its codes land with their raisers) (D74 b). The contract
members beyond the roadmap's names: `GeneratePlan` is a union, `ProjectInputs.profile?`, `AgbccPin` in
`core/scaffold/vars.ts`, the project's ROM always `baserom.gba` (D74 c); `init` has no `--no-signatures` before phase 6
(D74 c); the `@@<placeholder>@@` spelling and the five targets romlift renders itself (D74 d); the ASSERT's input pattern
`*src/<m>.o` where architecture §6.6 wrote `src/<m>.o` (D74 f); the `core/verify` edge (D74 g). Every phase-4 threshold
reads "five tuning ROMs" as the six of D60 (D74 j). The component branches are `phase-4-<component>`, flat, because Git
cannot hold `phase-4/<component>` beside `phase-4` (D56 h); the lead's worktree is
`/Users/macabeus/ApenasMeu/decompiler/romlift-wt/phase-4-p4-lead`.

The closing runs before the owner's answers (at `a4c753e` and fix round 1's) deviate from roadmap "Phase 4 exit" and
AGENTS.md in five ways, each by the orchestrator's plan or forced by a fact (the landing run after the answers ran in a
fresh worktree with the marker raised; its own deviations are under "The closing gate"):

- **The list.** The orchestrator's list adds to the roadmap's `npm run lint`, `npm run export-poc -- --mode raw` (the
  input of `poc-raw-printer`), `ROMLIFT_REQUIRE_LOCAL=1` on `test:local`, the doubled ROM's readable `verify
  --assemble --link --json` under the bin's cap and its `bench large-rom --bin`, and `bench provenance`; it runs `npm
  pack --pack-destination` into a temporary directory (packed.yml's steps run inside `g4.packed-e2e`), and the real tier
  before the ci tier. Phase 3's `export-poc --mode scored|parity|queries`, `corpus`, `speed`, `dataset-check`,
  `poc-check` and `stale-check` are not in it; the dumps of the first three are the ones in `bench/.local/poc`.
- **Where.** From the repository root, as the orchestrator asked, not in a fresh worktree as this record's plan said;
  the ROM-less steps of the worktree check run inside `g4.worktree` (50 fresh worktrees).
- **`test/gates/phase.json` is not raised** to `{ "landed": 4 }`: the phase cannot land while `g4.toml-mutations` fails
  and Q1 to Q4 are open, and a raised marker would make `g1.provenance` and `bench provenance` require phase-4 real-tier
  gates that are known to fail. The run therefore measures `gates --require 4` with the marker at 3.
- **An analysis change in the closing round** (`a4c753e`, "The closing round" above), which no component owned: the fix
  of a gate of an earlier phase (`g3.large-rom`), measured against the g2 gates and the regression baseline.
- **`docs/benchmark-roms.md` unchanged.** The orchestrator asked to correct it where it still says tmc has no ELF; it
  does not (wave 1's check, "Measured numbers", repeated at the close: lines 22, 34 and 36 name `tmc/tmc.elf` and
  `tmc/build/USA/tmc.map`).

## Owner questions

Bruno Macabeus answered Q1, Q2, Q3, Q5, Q6 and Q7 on 20 October 2026 (Q4 was withdrawn by fix round 1); each chosen
option is quoted below as he gave it, and is recorded in D76. The same day he took two scope decisions for the later
phases ("The owner's scope decisions", below). The review of fix round 3 raised two more, Q8 and Q9, which he answered
on 21 October 2026 (D79). These are the only gate changes he authorised.

### Q1. The scope of Q5 c: which listed functions the confirm run still validates

**Answered** (D76 a): **"Only entries with `from`"** (option a). The confirm run validates only `[functions]` entries
that carry a `from` key; entries without `from` are taken without the valid.* rules. Consequence, recorded as a
limitation ("Known limitations"): a hand-added entry without `from` that fails validity no longer warns
`W_LISTED_INVALID`. Applied as `p4-confirm-listed` built it in `generate`, `model`, `verify` and `explain`; fix round 2
applied it to `analyze --update`'s confirm run too, which had still validated every listed entry discover no longer
found (D77 e, architecture-a0-1), so the consequence holds without exception. The facts below cite `g5.import-legacy`,
which the owner's scope decisions drop; nothing in phase 4 depends on it.

The owner's answer to phase-3 Q5 (D68 e) asks that the confirm run stop re-validating the functions discover listed, so
`init` then `generate` print no spurious `W_LISTED_INVALID`. A `[functions]` entry does not record who wrote it:
configFromDiscover writes entries without `from`, and a user may add one by hand without `from` too (architecture §6.5:
"An entry without `from` was written by the analysis or by hand"); an entry with `from` is a proposal of another source
(`legacy`, `evidence:<id>`, `sig:<library>@<version>`), and `g5.import-legacy` expects `W_LISTED_INVALID` for a legacy
entry that fails validation (architecture §6.6).

Facts. Before the fix (phase-3.md Q5 c), `generate` over `init`'s config warns `W_LISTED_INVALID` on every tuning ROM:
fe7j 5, klonoa 4, pokeemerald 6, sa2 4, sa3 4, tmc 24 (valid.dense, valid.in-rom-unclaimed, valid.returns-or-prologue;
on tmc also valid.no-claimed-code and valid.balanced-stack). The listed entry is kept either way; only the warning and
the rejection row differ, and confirm equals discover on functions and extents. configFromDiscover writes no `from` key,
so under the default every entry `init` writes is taken without the valid.* rules. The counts after the fix, measured
by `test/local/listed-invalid.test.ts` in the closing run: 0 on all six (fe7j, klonoa, pokeemerald, sa2, sa3, tmc); the
other confirm diagnostics are unchanged (sa3 four W_WALK_LIMIT, tmc W_UNLISTED_FUNCTION 0x080B1A28), and the doubled
pokeemerald ROM's readable `verify` went from 357 W_LISTED_INVALID to none.

Options.

- (a) **Validate only entries with a `from` key** (`Seed.validate`, set by `listedSeedsOf` exactly when the entry has
  `from`). Consequence not in the owner's words: a hand-added entry without `from` that fails validity no longer warns.
- (b) **Skip validation only for an entry whose name is still the default name** (`functionName(entry)`, `sub_…`): a
  function the user renamed, or added by hand under a chosen name, warns again; one added by hand under a default name
  does not.
- (c) **A marker key in the TOML** (for example `found = true` on every entry configFromDiscover writes): exact, but it
  adds a key to about 16,000 lines on pokeemerald and goes against the layout of architecture §6.5.

Default while unanswered: (a), as `p4-confirm-listed` builds it.

### Q2. correctness-r0-1: sa2's `g2.speed` headroom before phase 4's landing run

**Answered** (D76 b): **"Median of more runs"** (option c, a gate change the owner authorises). `g2.speed` measures
each ROM over 9 serial runs instead of 5 and takes the median; the limits (1.5 × baseline × calibration ratio) and
`bench/baseline/speed.json` are unchanged. Applied in `bench/src/speed.ts` (`ANALYSIS_SPEED_RUNS`; the calibration and
`g3.speed-budget`'s emission timings stay five), in `bench speed --json`'s `runs` member, which the gate requires to say
nine, and stated in `test/gates/g2.speed.test.ts`, roadmap.md and architecture §8.4, §8.5 and §13. If sa2 still fails
at the landing run, that is a new owner question, not a retry. Fix round 2 (D77 f, g): `g3.speed-budget`'s 3 s analysis
budget, which at the landing read the same nine-run median, reads `budgetAnalysisCpuMs`, the median of the first five
of the nine runs, as many as before; and the run counts are the samples measured, which `g2.speed` requires per ROM.
Fix round 3 (gate-honesty-a1-1): the nine-run samples of sa2 measured so far put it at 87.4% (709 of 811 ms, ratio
0.994, the run of 16:55 on 20 October), 89.8% (708 of 788 ms, ratio 0.967, fix round 2's closing run), 92.5% (731 of
790 ms, ratio 0.969, the landing run) and 96.3% (738 of 766 ms, ratio 0.939, the review's re-run of fix round 2's list
at `1c07b13`) of its limit, every one passing; fix round 3's closing run adds 91.7% (727 of 793 ms, ratio 0.973). sa2's
CPU time moved about 4% (708 to 738 ms) and its limit about 6% (766 to 811 ms): most of the spread is the
calibration ratio, which the owner kept the median of five runs, so nine runs have not clearly narrowed the spread of
five (85.6% to 97.7% above). No gate changes: the owner's rule stands that a sa2 `g2.speed` failure in any later
required run, the phase pull request's CI and provenance evidence included, is a new owner question, not a retry.

Roadmap "Carried from phase 3" asks the owner, before phase 4's landing run, whether to re-baseline or to take the
median of more runs: sa2's `g2.speed` sat at about 90 to 100% of its limit at `main` (phase-3.md, "Review",
correctness-r0-1), and phase 3's landing run failed it once by 0.5 ms (Q8, D73).

Facts, measured now at phase 4's base (`e915c82`, `main` after phase 3's merge; `npm run bench -- speed`, one run, five
serial runs per ROM, the median; Node 24.15, macOS; `bench/baseline/speed.json` unchanged): calibration 214.3 ms CPU
against the baseline's 196.62 ms, ratio 1.090. Each ROM's analysis CPU time against its limit (1.5 × baseline × ratio):

| ROM | CPU ms | limit ms | share of limit | calibrated, × baseline |
| --- | --- | --- | --- | --- |
| sa2 | 760.6 | 888.7 | 85.6% | 1.28 |
| klonoa | 274.8 | 347.8 | 79.0% | 1.19 |
| tmc | 1,490.6 | 2,025.0 | 73.6% | 1.10 |
| sa3 | 1,162.9 | 1,693.8 | 68.7% | 1.03 |
| pokeemerald | 2,317.4 | 4,788.6 | 48.4% | 0.73 |
| fe7j | 1,248.1 | 14,406.0 | 8.7% | 0.13 |

One run, not a controlled measurement: it shared the machine with this worktree's `npm run lint` (during sa2 and sa3)
and `npm test` (from sa3's `generate` timing on), and with the two other wave-1 components' work in their own
worktrees throughout. Three later `gates --require 3 --tier real` runs in this worktree on `p4-lead`'s
commits (no analysis change from `e915c82`; the machine as busy as above) measured sa2 in `g2.speed` at 741 of 797 ms
(93.0%, ratio 0.978), 802 of 821 ms (97.7%, ratio 1.007) and 755 of 853 ms (88.5%, ratio 1.046), all passing. The phase-3 records at
`main`: 725 of 798 ms (90.9%) at the passing landing run, 787.3 of 786.8 ms at the failed one, and 731.0 to 854.8 ms
against 811.1 to 837.6 ms in the review's five runs (phase-3.md).

Options.

- (a) **Leave `g2.speed` and `bench/baseline/speed.json` unchanged.** A failure on sa2 at the landing run is then a new
  owner question under D73 b, not a retry.
- (b) **The lead re-baselines `bench/baseline/speed.json`** (`bench speed --write-baseline`, phase 4's analysis) before
  the landing run: every limit moves to 1.5 × the new medians.
- (c) **A gate change**, for example the median of more runs per ROM, or the minimum of two medians.

Default while unanswered: (a).

### Q3. correctness-r0-2: the `env -S` launcher requirement as a known limitation

**Answered** (D76 c): **"Known limitation"** (option a). A release-1 known limitation, with the unit test of the built
launcher's first line (`p4-safety-minors`).

The heap cap of D72 reaches users only through the bin's first line, `#!/usr/bin/env -S node --max-old-space-size=1024`.
Roadmap "Carried from phase 3" says phase 4 adds a unit test of the built launcher's first line (`p4-safety-minors`) and
records the `env -S` requirement as a known limitation; that limitation is in the phase-3 review's words (phase-3.md,
"Review", correctness-r0-2), not the owner's, so it is asked here.

Facts (phase-3.md, correctness-r0-2): `tsc` keeps the line, a local install runs `node --max-old-space-size=1024 …/romlift`,
and npm 11.12.1's cmd-shim accepts `-S`; a platform whose `env` lacks `-S` (BusyBox or Alpine, GNU coreutils before 8.30)
cannot start the bin, and `node dist/cli/main.js` runs uncapped.

Options.

- (a) **Record it as a release-1 known limitation**, with the launcher test.
- (b) **A launcher without `env -S`**: a small `dist/cli/bin.js` that starts `process.execPath --max-old-space-size=1024
  dist/cli/main.js` as a child (one more Node start per command, about 40 ms).
- (c) **Document the cap only** and drop it from the launcher (it would undo D72 a for users).

Default while unanswered: (a).

### Q4. g4.toml-mutations: is deleting the last listed function a legal edit? (withdrawn by fix round 1)

Raised by `p4-workflows` (wave 3) with no default: on 10 of the 51 fixtures the gate's delete edit drew the last
listed function, the confirm run's code end and data start moved down to the deleted entry, and `generate` refused the
`data` module's start (E_MODULE_BORDER), which the TOML states. The review of fix round 1 (delivery-1) found the record
wrong to leave it unanswered: R3 says `generate` takes every border from the TOML, and §13 lists the edit as legal.
Fixed in the product with the gate unchanged (D75 a, `27ab98d`): at or past the data start every word-aligned address
is a legal module start, since no instruction lies there, so the `data` module keeps its start and the bytes between
the new data start and it are an orphan of the module before (option (c) of this question; option (b) would have
changed the confirm analysis for the same result). `g4.toml-mutations` then passes on both tiers (closing run below),
the property test always deletes the last entry too (19 of its cases fail without the fix), and no analysis golden
changes. Nothing waits on the owner here.

### Q5. A project made by an unpublished romlift needs ROMLIFT_CLI (review delivery-4)

**Answered** (D76 d): **"Pre-release limitation"** (option a). Recorded as a pre-release limitation; `ROMLIFT_CLI` is
documented in the scaffold's `AGENTS.md` and `README.md` (`templates/`, the scaffold golden updated) as the way until
romlift is published. Nothing is published.

`init` writes a package.json that pins the exact romlift version, and setup.sh's duty 4 installs it (`npm ci`, or `npm
install` without a lock). romlift is not on the npm registry, so every `init` ends with `W_LOCKFILE_DEFERRED` (E404),
and setup.sh fails at duty 4 unless `ROMLIFT_CLI` names a romlift command (it then skips duty 4 and runs that command
for duty 5). Every phase-4 gate and workflow sets it. Fix round 1 records `ROMLIFT_CLI` in architecture §6.3 (D75 o) and
gates duties 4 and 5 without it: `g4.packed-e2e`'s first fixture points package.json's romlift at the packed tarball
(`file:`) and removes asm/, and setup.sh's `npm install` and `npx romlift generate` then build it to its SHA-1. What is
not authorised is the limitation itself: until romlift is published, a user's project needs `ROMLIFT_CLI` or a hand
edit of package.json.

Options.

- (a) **Record it as a pre-release limitation**: release 1 publishes romlift to the registry, after which duty 4 needs
  nothing; until then `ROMLIFT_CLI` (documented in the scaffold's AGENTS.md and README) is the way.
- (b) **`init --romlift-spec <spec>`**: `init` writes the given npm spec (a tarball path, a git URL) into package.json
  instead of the version, so duty 4 installs it without `ROMLIFT_CLI` (a new option, phase 4).
- (c) **Publish a pre-release** (`romlift@0.x`) to the registry now, so the pinned version resolves.

Default while unanswered: (a).

### Q6. W_UNLISTED_FUNCTION after init on tmc and the doubled ROM (review correctness-5)

**Answered** (D76 e): **"Known limitation"** (option a), of the same root as tmc's accepted confirm/discover differences
(D61 e).

Q5 c removed `W_LISTED_INVALID` from `generate` after `init` (0 on all six tuning ROMs), but `generate` over the config
`init` writes still raises `W_UNLISTED_FUNCTION` where the confirm run would accept a function discover did not find:
tmc 1 (0x080B1A28, ARM, proposed by `seed.ram-copy`, in the RAM-copied ARM code where the owner accepted tmc's eight
confirm/discover differences, D61 e: 0x080B1A8C, 0x080B255C and 0x080B2874 lie beside it), the doubled pokeemerald ROM
161 (as in phase 3), the five other tuning ROMs and every fixture 0. The entries are not wrong (the tree links to the
SHA-1); the warning tells the user `analyze --update` would add them.

Options.

- (a) **Record it as a known limitation** of the same root as tmc's accepted differences (D61 e).
- (b) **`initConfigOf` lists what confirm would accept**: after the config, a confirm run whose `unlisted` findings are
  added (repeated until none), so `init`'s config is confirm's fixpoint. Costs one more confirm run in `init` and in
  `verify --rom` (about 1.5 s on tmc; the doubled ROM's `verify --rom` already peaks near the 1,536 MiB budget).
- (c) **Make discover and confirm agree there** (an analysis change in `core/analysis/driver`, measured against the g2
  gates; D61 c's resettle stage was built for tmc and reverted because it changed rows on other ROMs).

Default while unanswered: (a).

### Q7. The 0x46C0 nop pads stay orphan files (review correctness-4)

**Answered** (D76 f): **"Keep as orphans"** (option a).

Q5 b's fold covers every zero pad before a function, and at a module's end after any chunk but a function of a `c`
module (D75 d, narrowed by D78 b: after such a function the pad stays its own orphan, 11 on the tuning ROMs, Q8). A pad
of one Thumb nop (0x46C0) up to a word boundary stays its own orphan file and, in a `c`
module, its own `INCLUDE_ASM` stub: fe7j 21, klonoa 21, pokeemerald 15, sa2 15, sa3 15, tmc 0, all in `c` modules. By
the ELF maps, 15 on each ROM but tmc lie in libgcc's `_call_via_rX.o` (phase 6's signatures put libgcc in a library
`asm` module, architecture §12) and 6 each in a hand-written assembly object (fe7j's `arm-call.o`, klonoa's `thunk.o`).
No start macro emits a nop (they open with `.align 2, 0`), and agbcc's output for the function before it does not hold
one, so folding it into either neighbour puts into a function's file a byte its C cannot produce.

Options.

- (a) **Keep them as orphans** (byte-exact, one stub line each; the libgcc ones leave the `c` modules in phase 6).
- (b) **Fold a nop pad into the function before it** as trailing data (`.2byte 0x46C0`): no stub of its own, but a
  user who decompiles that function must keep the nop by hand.
- (c) **Fold it into the function after it with a nop-filling start macro** (`.align 2` in Thumb, which GNU as fills
  with 0x46C0): no stub of its own, but decompiling that function makes agbcc emit zeros there.

Default while unanswered: (a).

### Q8. The zero pads that end a `c` module after a function (review gate-honesty-a2-1)

**Answered** (D79 a, 21 October 2026): **"Keep as orphans"**. Byte-exact, one stub line each, recorded as a known
limitation authorised by the owner, like Q7; `test/local/padding-orphans.test.ts` asserts exactly that rule (every
zero-pad orphan is such a pad, and their number per ROM is fe7j 4, klonoa 0, pokeemerald 5, sa2 1, sa3 0, tmc 1).

Asked after the review of fix round 3 (gate-honesty-a2-1): D78 b keeps 11 zero pads that end a `c` module right after a
function as their own orphan files (fe7j 4, pokeemerald 5, sa2 1, tmc 1), because folding one into the function before
it breaks the build once that function is decompiled (gas ends its C object with a 0x46C0 nop where the ROM has zeros;
reproduced on klonoa with a module split behind a decompiled `bx lr`). That loosened the padding-orphans assertion that
held the owner's answer to phase-3 Q5 b, with no owner question; Q7 is the precedent for a pad that cannot fold
byte-exactly.

Options: keep them as orphans; or fold them some other way that survives decompilation (none is known: the nop and the
zeros differ in the ROM).

### Q9. The scaffold commits the generated tree, against R4 (review architecture-a2-1)

**Answered** (D79 b, 21 October 2026): **"Gitignore, as R4 says"**. The scaffold's `.gitignore` ignores the generated
roots (`/asm/`, `/data/`, `/expected/`, `/ldscript.txt`, `/symbols.ld`, `/modules.mk`, `/objdiff.json`: what R4 and
plan.md's scaffold table mark "In Git: No"); a fresh clone builds through setup.sh's duty 5 (`romlift generate` when
`asm/` is absent). The reconciler's rule that uses the previous tree on disk (D78 a) holds from the second `generate`
of a clone; the first uses the fallback rule (a definition its module no longer has where a missing stub goes is
`E_C_STALE_DEFINITION`). D78 a, `src/core/workflow/c-stubs.ts` and the docs say so; `g4.worktree` now requires that no
generated root is committed (R4's list, written in the gate since fix round 6, united with the product's rule, D82 e)
and that the worktree's `setup.sh` ran duty 5, and the scaffold render test requires each root to be ignored. Since the
tree is not in Git, a pull that changes `romlift.toml` leaves it stale: since fix round 6 `modules.mk` records the
TOML's SHA-1, `make` stops until `romlift generate` runs, and `setup.sh`'s duty 5 runs it (D82 a).

Asked after the review of fix round 3 (architecture-a2-1): `templates/gitignore` (since `e7374f3`, D74 d) said the
generated roots were "deliberately NOT ignored" so a fresh clone builds, against plan.md's R4 ("`.s` files are
regenerated on every run and gitignored") and its scaffold table, with no decision replacing R4; D78 a then rested
`E_C_STALE_DEFINITION`'s previous-tree rule on a committed `asm/`. setup.sh's duty 5 already builds a clone without
it. A plan requirement changes only by the owner.

Options: gitignore the generated roots as R4 says (and reword D78 a to "from the second `generate` of a clone"); or
keep committing them and record the departure from R4.

### The owner's scope decisions (20 October 2026)

The owner skipped phase 5 ("We don't need it. Skip phase 5") and chose **"Keep rename and objdiff"**: legacy import,
the Klonoa migration tooling and the switch-over are dropped; rename and the reconciler, the `expected/` and
`objdiff.json` writers, the C data ranges and the objdiff gate move into phase 6. He also dropped the gba-kit trace
integration from phase 6. Phase 6 records both decisions and rewrites its plan; in this record and in roadmap.md
"Carried from phase 4", every item carried to phase 5 that survives points to phase 6 (D76 g), and nothing depends on
`g5.import-legacy`. The `g5.*` gate files keep their ids until phase 6 renames or drops them; `--require 4` does not
count them.

## Known limitations

- **Authorised by the owner** (D68 e, "Accept Q5a"): a ROM whose size the last unit's section alignment does not divide is
  refused by the text-layout check, and nothing is written (D65 a), a release-1 limitation.
- **Authorised by the owner** (Q3, "Known limitation", D76 c): a release-1 limitation, the bin needs an `env` that
  accepts `-S` (BusyBox or Alpine, GNU coreutils before 8.30 cannot start it; `node dist/cli/main.js` runs uncapped);
  the unit test of the built launcher's first line holds the line.
- **Authorised by the owner** (Q1, "Only entries with `from`", D76 a): a `[functions]` entry without `from` is taken
  without the valid.* rules, so one added by hand that fails validity no longer warns `W_LISTED_INVALID`, in every
  confirm run, `analyze --update`'s included since D77 e.
- Until phase 6's rename command (D77 a, D78 a): renaming, deleting or moving a function whose C you wrote needs the C
  renamed, deleted or moved by hand, and an `INCLUDE_ASM` inside an `#if` region (the NONMATCHING pattern's `#else`)
  renamed by hand too; `generate` refuses the TOML edit alone (`E_C_STALE_DEFINITION`, `E_C_DEFINITION_MOVED`,
  `E_C_CONDITIONAL_STUB`) and writes nothing, and a renamed `c` module leaves its old `src/<module>.c` unbuilt
  (`W_C_FILE_UNUSED`; its decompiled C of a function some module has is `E_C_DEFINITION_MOVED` since fix round 4, so a
  merged module or one made `asm` refuses rather than drop it, D80 b). `E_C_STALE_DEFINITION` reads the previous tree
  from the chunk files on disk; `asm/` is gitignored (Q9, D79 b), so the first `generate` of a fresh clone or worktree
  (setup.sh's duty 5), like a project whose `asm/nonmatchings/` was deleted by hand, falls back to D77 a's rule, which
  can refuse a static helper that lies where a renamed function's stub goes (write the stub by hand). A decompiled
  function renamed in C only is `E_C_STALE_DEFINITION` (D80 a): rename it in `romlift.toml` too. A definition inside an
  `#if` region counts for no build. Since fix round 5 (D81 a) the scanner reads a conditional as the preprocessor
  would, so any branch shape inside a function scans; a file it still cannot split (the branches of a file-scope `#if`
  ending differently, as an `ASM_FUNC("…", void f(void))` with no `;` against a definition: 2 of 1,739 real decomp
  files; a K&R definition) is edited never: `W_C_UNSCANNABLE` while its `INCLUDE_ASM` lines already match, so a clone
  builds, and `E_C_UNSCANNABLE` once a TOML edit needs them changed (change them yourself). A split between two chunks
  one `#if` region holds is `E_C_STUB_UNPLACED` (write the new `INCLUDE_ASM` in each branch yourself). A `c` module
  renamed with its source moved by hand (`git mv`) gets the new directory's stubs (D81 a). Since fix round 6 (D82 b)
  a definition in every branch of a conditional with an `#else` counts for every build; decompiled C belongs in
  `src/<module>.c` or a `src/*.c` it `#include`s (read as part of the module), and a quoted include of any other file
  but a `.h` refuses every stub that file would gain (`E_C_STUB_UNPLACED`: romlift cannot tell what it defines); a
  module's source created by hand with only C gains `#include "include_asm.h"` with its first stub. The scaffold's
  `AGENTS.md` says so.
- Since the generated tree is not in Git (Q9), a project whose `Makefile` predates fix round 6 (written once by an
  earlier `init`) has no staleness guard: after a pull that changes `romlift.toml` its user must run `romlift generate`
  (D82 a; `scaffold --diff` shows the new template). A project `init` makes from fix round 6 on stops `make` with the
  command to run.
- Until phase 6 (D81 c, roadmap.md "Carried from phase 4"): an `[[overrides]]` entry without `runs_at` is applied by no
  analysis rule; a `data` override, and a `code` override that gives no listed entry its extent, change nothing and
  warn `W_OVERRIDE_IGNORED`. `g4.toml-mutations`' add-override edit is such a no-op (it warns and builds); making it
  change the model is a gate change the owner has not authorised in phase 4.
- `analyze --update --write` does not check the patched config's module borders (architecture §6.2, D77 k): a newer
  discover's unlisted function whose extent covers a `c` module's start is added, and `generate` then refuses the TOML
  with `E_MODULE_BORDER` (not reproduced; carried to phase 6 with architecture-r1-3).
- **Authorised by the owner** (Q6, "Known limitation", D76 e): `generate` after `init` raises `W_UNLISTED_FUNCTION` on
  tmc (1) and the doubled pokeemerald ROM (161), the same root as tmc's accepted confirm/discover differences (D61 e).
- **Authorised by the owner** (Q7, "Keep as orphans", D76 f): a 0x46C0 nop pad stays an orphan file with its own
  `INCLUDE_ASM` stub (fe7j 21, klonoa 21, pokeemerald 15, sa2 15, sa3 15).
- **Authorised by the owner** (Q8, "Keep as orphans", D79 a): a zero pad that ends a `c` module right after a function
  stays an orphan file with its own `INCLUDE_ASM` stub (fe7j 4, pokeemerald 5, sa2 1, tmc 1; klonoa and sa3 none),
  since that function's C object, once decompiled, ends with a nop where the ROM has zeros (D78 b).
- By design (architecture §6.4, D74 g, D75 b): project-mode `verify --assemble/--link` builds a C unit from its
  `INCLUDE_ASM` statements without a compiler, so a `src/<module>.c` that holds decompiled C makes it exit 1
  (`E_TOOLCHAIN_FAILED`, "defines the function …"); `make` is the verdict there, and the matchings split is phase 6's
  (with the reconciler, D76 g).
- By design until phase 6 (architecture §6.6, D21, D76 g): a C module that defines data fails the link on its
  `ASSERT`; the data ranges arrive in phase 6 (gated by `g5.c-data-ranges` until phase 6 renames it). The ASSERT's
  message and the scaffold's `AGENTS.md` name no phase since fix round 3 ("romlift does not place C data yet", D78 c).
- **Authorised by the owner** (Q5, "Pre-release limitation", D76 d): `init` runs `npm install --package-lock-only` for
  the scaffold's `package.json`; romlift is not on the npm registry yet, so every `init` ends with
  `W_LOCKFILE_DEFERRED` (a warning, exit 0) and `setup.sh`'s duty 4 needs `ROMLIFT_CLI` (documented in the scaffold's
  `AGENTS.md` and `README.md` as the way until romlift is published) or package.json pointed at a tarball.
- `setup.sh` builds agbcc from source at the pin (network, git and a host C compiler; about 50 s); a mirror is
  `AGBCC_URL`.
- Memory: under the bin's 1,024 MiB cap the doubled pokeemerald ROM's commands peak at 1,133 to 1,581 MiB RSS across
  the runs of this phase (largest live heap 924.8 MiB, the raw `verify`), and three forms have gone over D72 b's
  1,536 MiB budget in some run: the readable `verify --link` once in six ("The closing gate", fix round 1), and, in the
  review's re-run of fix round 3's list at `2314ffe` (gate-honesty-a2-3), `init --json` at 1,562.8 MiB and the readable
  `verify --assemble` at 1,551.3 MiB, in fix round 4's closing run `verify --assemble --link --json` at 1,540.6 MiB, and
  in fix round 5's `init --json` at 1,581.4 MiB, and in fix round 6's `verify --assemble --link --json` at 1,569.9 MiB;
  `init`, the phase-4 one-shot command, is not held under the budget on it,
  and `generate --json`, the other, has come within a MiB of it (1,535.2 MiB in the review's re-run of fix round 5's
  list, 0.8 MiB under), so both one-shot commands sit at the doubled ROM's budget edge. A
  code-dense ROM larger than 32 MiB of that density may exceed the cap (D72, unchanged). No gate measures the doubled
  ROM (D72 e), and `bench large-rom --bin` records the peaks without judging them.
- Three `g5.*` gates fail instead of reporting `pending` once their inputs exist (`g5.c-data-ranges`: no
  `expect-ranges.json`; `g5.expected-bytes`: no `expected/`; `g5.reconciler`: no reconcile goldens); `--require 4` does
  not require them, and phase 6 builds what they read (D76 g).

## Measured numbers

### Wave 1 (`p4-lead`)

- `npm run bench -- speed` at `e915c82`: Q2's table.
- The gates at `de5c7a8` (wave 1 of `p4-lead`), in its worktree, with the PoC dumps of the main checkout's
  `bench/.local/poc` copied in (gitignored): `npm run bench -- run --scaffold` exit 0, then `gates --require 3 --tier
  real` exit 0 (every phase-1 to phase-3 real gate passes or is historical; `g5.objdiff` fails as recorded since D68 a,
  not required), then `gates --require 3 --tier ci` exit 0: 26 pass, every g4 gate `pending` (`init` not exported), the
  g5 and g6 ones `pending`. `bench/results.json` was restored afterwards (never committed by a component). Without a
  regenerated artifact `g1.provenance` fails on the source digest, as on every branch that changes `src/`; without the
  PoC dumps `g1.bench-harness`, `g2.baseline-rows`, `g2.entries` and `g2.extents` fail on tmc's missing PoC reference.
- The frozen C stub builds with both compilers (a smoke test, not a gate; `p4-c-modules` measures and encodes the unit's
  layout, D74 f): a `src/main.c` of `C_STUB_HEADER` and two `includeAsmStatement` lines, with `include/include_asm.h`
  = `INCLUDE_ASM_HEADER`, preprocessed by the host `cc -E -x c -nostdinc -undef -I include` (Apple clang) and compiled
  by pokeemerald's `tools/agbcc/bin/agbcc` and `old_agbcc` with `BUILD_COMPILERS`' flags, gives in both cases `.code 16`,
  the `.gcc2_compiled.:` label, `.include "include/macros.inc"`, then per statement `.syntax unified`, the chunk's
  `.include` and `.syntax divided`; `arm-none-eabi-as -mcpu=arm7tdmi` (2.45.1) assembles it to the two chunk files'
  bytes at offsets 0 and 4.
- The orchestrator asked to correct any document that still says tmc has no ELF. Checked by grep over every Markdown file
  of the repository (`docs/*.md`, `README.md`, `AGENTS.md`, the `index.md` files) for tmc beside "no ELF", "without",
  "lacks", "not" or "missing": none says it. docs/benchmark-roms.md names tmc's ELF (`tmc/tmc.elf`) and map
  (`tmc/build/USA/tmc.map`) in both tables (lines 22 and 34) and states that all three held-out builds reproduce their
  SHA-1 (line 36); architecture §8.1's "each once its build reproduces its SHA-1" is a condition, met. Nothing changed.

### Wave 3 (`p4-workflows`)

Measured on branch `phase-4-workflows` (Node 24.15, macOS; the machine shared with the other wave-3 worktrees).

- `npm run bench -- gates --require 4 --tier ci` at `1b30b5e`: pass g4.checks-fail, g4.cli-contract (8 commands, 12
  --json runs), g4.e2e-fixtures (50 fixtures built to their SHA-1 from init, setup.sh and make; the composite's
  illegal border is E_MODULE_BORDER), g4.generate-idempotent (every fixture keep only), g4.no-toml-write (153 runs),
  g4.packed-e2e, g4.toml-canonical, g4.worktree (50 worktrees); fail g4.c-data-fails-loud, g4.multi-compiler (both
  fixed at `5410c6f`, below), g4.toml-mutations (Q4); fail g1.provenance (the source digest, as on every branch that
  changes `src/`) and g3.large-rom (E_MODULE_BORDER `main_176` at 0x0949B910 on the synthetic 32 MiB ROM; it fails
  the same way at `776a15b`, the phase-4 base, before p4-workflows, through bench's own init: not caused by this
  component). Fixed in the closing round (`a4c753e`): a confirm-mode defect the new synthetic image exposed.
- g4.c-data-fails-loud and g4.multi-compiler: GNU make 3.81 (macOS `/usr/bin/make`) compares modification times to the
  second. A C source copied over within the second of the previous build was not recompiled and the old ELF not
  relinked (measured: `src/main.c` 16 ms newer than `build/src/main.o`, the same second), and a C object did not
  depend on `modules.mk`, so a compiler change by `generate` never reached it. `templates/Makefile` (p4-scaffold's)
  now records each C object's source and modules.mk SHA-1 in `build/src/<m>.sum` and removes a stale object and the
  ELF before make decides (`5410c6f`), and writes the ROM in the link's own recipe, since a ROM objcopied in the same
  second as a new ELF otherwise survived it (g4.multi-compiler then failed 1 run in 3: the control's ROM was the
  first build's). After both, g4.multi-compiler passed 4 runs of 4 and g4.c-data-fails-loud 1 of 1 alone.
- `init` and `generate` on pokeemerald under `node --max-old-space-size=1024` (`/usr/bin/time -l`): init 10.9 s
  wall, peak RSS 714 MiB, 15,866 functions, 43 modules, 15,937 files written, only W_LOCKFILE_DEFERRED (romlift is
  not on the npm registry: E404); generate right after it 8.0 s, 697 MiB, 15,924 keep, 0 writes, no diagnostic (no
  W_LISTED_INVALID).
- klonoa end to end: `init baserom.gba` 2.2 s, 334 MiB, 560 functions, 28 modules; `./setup.sh` with `ROMLIFT_CLI`
  set to the source CLI 52 s (agbcc fetched at the pinned commit and built); `make` reaches
  `a0a298d9dba1ba15d04a42fc2eb35893d1a9569b` (`akle.gba: OK`); `generate --dry-run` right after init: 606 keep.
- The doubled pokeemerald ROM of Q7 (`fb17b88d…`): readable `verify --rom … --assemble --link --json` under the cap
  exits 0, every check ok, linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`, 44.6 s, peak RSS 1,508 MiB. The
  bin's `init` on it under the cap: exit 0, 29,084 functions, 521 modules, 29,550 files, 35.8 s, peak RSS 1,500 MiB;
  `generate` right after: 29,537 keep, 17.8 s, 1,499 MiB (below D72 b's 1,536 MiB budget, with 2% to spare).

## The closing gate

### Fix round 6's closing run (`6c7b1a6`)

After fix round 6 (D82; `d664b4d`, `6c7b1a6`), with `test/gates/phase.json` at `{ "landed": 4 }`, the whole closing
list in a fresh worktree at `6c7b1a6` (`git worktree add --detach` under the system temporary directory: no
`node_modules`, no `bench/.local`, so the PoC dumps, the corpus summary and the agbcc cache were made in the run;
objdiff-cli 3.7.2 from the main checkout's build), in the landing run's order and environment (the real tier before
the ci tier), from 19:28 to 21:12 on 21 October 2026. Node 24.15, binutils 2.45.1, macOS; nothing else ran on the
machine. The worktree was clean afterwards but for the `bench/results.json` the run wrote, committed as this run's
artifact (`ee22c89`: `meta.commit` `6c7b1a6`, not dirty, source digest `830b5ffa…`, with the real-tier gate record).
The doubled ROM is the same `fb17b88d…` image, rebuilt for the run and never committed.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,432 tests, 2,432 pass, 0 fail (30 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 478.6 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (246 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (50 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 97 tests, 97 pass, 0 skipped (732 s); `decompiled-c` builds klonoa to its SHA-1 through every earlier step and the two new ones (a split at the decompiled `Nop` with its C pasted alone into `src/m3a.c`; a Git clone whose `make` stops after each pulled rename until `./setup.sh`, then `romlift generate`, regenerates); `c-scan-corpus` (new) 1,729 files, unscannable exactly sa2's two; `listed-invalid` W_LISTED_INVALID 0 on all six; `padding-orphans` orphan files fe7j 32, klonoa 23, pokeemerald 23, sa2 16, sa3 15, tmc 33, zero pads kept after a `c` module's last function 4, 0, 5, 1, 0, 1, equal to Q8's counts |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (5 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,318.0 MiB, `generate` 1,179.9 MiB peak RSS under the 1,024 MiB cap, tree `d60c5331…` (unchanged: outside a project modules.mk records no TOML SHA-1) (321 s, agbcc built at the pin included) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled ROM: 7 checks ok (29,463 files), linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET (44 s) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,128.0 to 1,569.9 MiB peak RSS (`verify --assemble --link --json` the largest, over D72 b's 1,536 MiB budget in this run, as recorded under "Known limitations"; `generate --json` 1,521.8, `init --json` 1,494.6) (389 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending. Among them: **g2.speed** ("median of 9 runs"; ratio 0.940; sa2 689 of 766 ms, 89.9%; klonoa 231 of 300, tmc 1,367 of 1,746, sa3 1,061 of 1,460, pokeemerald 2,016 of 4,129, fe7j 1,081 of 12,420), **g3.speed-budget** (ratio 0.937; analysis on the first five runs: largest pokeemerald 2,118 of 2,811 ms; pokeemerald `generate` 7,717 of 9,371 ms, `init` 9,988 of 14,056 ms), g4.e2e-real (six tuning ROMs, from the source tree and the installed tarball; sealed 2 of 2), g4.toml-mutations (258 legal edits build with `make`: move-start 45, rename 57, delete-function 54, add-override 57, each a no-op that warns `W_OVERRIDE_IGNORED` (D81 c), split-module 45; 170 illegal edits give their codes; 57 ROMs), g4.worktree (56; nothing generated committed by R4's list or the product's rule, duty 5 run in each worktree), g4.generate-idempotent (57 ROMs) (2,767 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `830b5ffa…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,329.0 MiB, `generate` 1,331.1 MiB, tree `d60c5331…`), g4.toml-mutations (228 legal: move-start 39, rename 51, delete-function 48, add-override 51 no-ops, split-module 39; 152 illegal; 51 ROMs), g4.packed-e2e (672 files), g4.e2e-fixtures (50), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests), g4.c-data-fails-loud, g4.multi-compiler (1,520 s) |
| `npm run bench -- provenance` | 0 | source digest `830b5ffa…` (Node 24) ok; gate record ok (23); families live; 6 rows, no sealed row |

Every command exits 0, so **phase 4 passes its closing gate** at `landed` 4 after fix round 6. sa2 passes `g2.speed`
at 89.9% of its limit, inside the spread recorded under Q2, so no new owner question arises. The merge to `main` waits
for the phase pull request's CI; nothing is merged or pushed.

### Fix round 5's closing run (`566d5f5`)

After fix round 5 (D81; `5fd0086`, `566d5f5`), with `test/gates/phase.json` at `{ "landed": 4 }`, the whole closing
list in a fresh worktree at `566d5f5` (`git worktree add --detach` under the system temporary directory: no
`node_modules`, no `bench/.local`, so the PoC dumps, the corpus summary and the agbcc cache were made in the run;
objdiff-cli 3.7.2 from the main checkout's build), in the landing run's order and environment (the real tier before
the ci tier), from 15:06 to 16:58 on 21 October 2026. Node 24.15, binutils 2.45.1, macOS; nothing else ran on the
machine. The worktree was clean afterwards but for the `bench/results.json` the run wrote, committed as this run's
artifact (`3c1a8b8`: `meta.commit` `566d5f5`, not dirty, source digest `e8c617fc…`, Node 24, with the real-tier gate
record). The doubled ROM is the same `fb17b88d…` image, rebuilt for the run and never committed.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (under 1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,422 tests, 2,422 pass, 0 fail (32 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 472.1 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (258 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (53 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 96 tests, 96 pass, 0 skipped (797 s); `decompiled-c` builds klonoa to its SHA-1 after the NONMATCHING rename, the module split, the do/while idiom, a fresh clone through `./setup.sh` and a `c` module renamed with its source moved; `listed-invalid` W_LISTED_INVALID 0 on all six; `padding-orphans` orphan files fe7j 32, klonoa 23, pokeemerald 23, sa2 16, sa3 15, tmc 33, zero pads kept after a `c` module's last function 4, 0, 5, 1, 0, 1, equal to Q8's counts |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (4.3 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,223.2 MiB, `generate` 1,102.0 MiB peak RSS under the 1,024 MiB cap, tree `d60c5331…` (unchanged) (385 s, agbcc built at the pin included) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled ROM: 7 checks ok (29,463 files), linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET (48 s) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,152.2 to 1,581.4 MiB peak RSS (`init --json` the largest, over D72 b's 1,536 MiB budget in this run, as recorded under "Known limitations"; `generate --json` 1,522.5, `verify --assemble --link --json` 1,478.9) (422 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending. Among them: **g2.speed** ("median of 9 runs"; ratio 0.976; sa2 777 of 796 ms, 97.6%; klonoa 231 of 312, tmc 1,493 of 1,814, sa3 1,100 of 1,517, pokeemerald 2,110 of 4,289, fe7j 1,125 of 12,903), **g3.speed-budget** (ratio 1.028; analysis on the first five runs: largest pokeemerald 2,078 of 3,084 ms; pokeemerald `generate` 8,100 of 10,279 ms, `init` 10,692 of 15,419 ms), g4.e2e-real (six tuning ROMs; sealed 2 of 2), g4.toml-mutations (258 legal edits build with `make`, 57 of them the add-override edit, a no-op that warns `W_OVERRIDE_IGNORED` (D81 c; noted by fix round 6, gate-honesty-b1-3), 170 illegal edits give their codes, 57 ROMs), g4.worktree (56, nothing generated committed by the product's `underGeneratedRoot`, duty 5 run in each worktree), g4.generate-idempotent (57 ROMs) (2,976 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `e8c617fc…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,245.9 MiB, `generate` 1,147.9 MiB, tree `d60c5331…`), g4.toml-mutations (228 legal, 51 of them the add-override no-op, D81 c; 152 illegal, 51 ROMs), g4.packed-e2e (672 files), g4.e2e-fixtures (50), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests), g4.c-data-fails-loud, g4.multi-compiler (1,653 s) |
| `npm run bench -- provenance` | 0 | source digest `e8c617fc…` (Node 24) ok; gate record ok (23); families live; 6 rows, no sealed row |

Every command exits 0, so **phase 4 passes its closing gate** at `landed` 4 after fix round 5. sa2 passes `g2.speed`
at 97.6% of its limit, above the spread recorded under Q2 (87.4% to 96.3%) but under the limit: Q2's answer makes a
new owner question only of a failure, so none arises; the headroom is noted for the owner. The merge to `main` waits
for the phase pull request's CI; nothing is merged or pushed.

### Fix round 4's closing run (`7c0a452`)

After fix round 4 and the owner's answers to Q8 and Q9 (D79, D80; `8a15817`, `e60a855`, `7c0a452`), with
`test/gates/phase.json` at `{ "landed": 4 }`, the whole closing list in a fresh worktree at `7c0a452` (`git worktree
add --detach` under the system temporary directory: no `node_modules`, no `bench/.local`, so the PoC dumps, the corpus
summary and the agbcc cache were made in the run; objdiff-cli 3.7.2 from the main checkout's build), in the landing
run's order and environment (the real tier before the ci tier), from 10:52 to 12:41 on 21 October 2026. Node 24.15,
binutils 2.45.1, macOS; nothing else ran on the machine. The worktree was clean afterwards but for the
`bench/results.json` the run wrote (`poc-digests.json` and `poc-dump-rows.json` byte-identical), committed as this
run's artifact (`13abfe9`: `meta.commit` `7c0a452`, not dirty, source digest `6a3e765b…`, with the real-tier gate
record). The doubled ROM is the same `fb17b88d…` image.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (under 1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,408 tests, 2,408 pass, 0 fail (32 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 465.8 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (256 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (51 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 96 tests, 96 pass, 0 skipped (751 s); `decompiled-c` builds klonoa to its SHA-1; `listed-invalid` W_LISTED_INVALID 0 on all six; `padding-orphans` orphan files fe7j 32, klonoa 23, pokeemerald 23, sa2 16, sa3 15, tmc 33, zero pads kept after a `c` module's last function 4, 0, 5, 1, 0, 1, equal to Q8's counts |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (4.2 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,104.2 MiB, `generate` 1,175.5 MiB peak RSS under the 1,024 MiB cap, tree `d60c5331…` (328 s, agbcc built at the pin included) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled ROM: 7 checks ok (29,463 files), linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET (46 s) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,174.7 to 1,540.6 MiB peak RSS (`verify --assemble --link --json` the largest, over D72 b's 1,536 MiB budget in this run, as recorded under "Known limitations"; `generate --json` 1,517.7, `init --json` 1,475.5) (405 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending. Among them: **g2.speed** ("median of 9 runs"; ratio 0.959; sa2 731 of 782 ms, 93.5%; klonoa 230 of 306, tmc 1,469 of 1,781, sa3 1,084 of 1,490, pokeemerald 2,066 of 4,211, fe7j 1,085 of 12,669), **g3.speed-budget** (ratio 0.969; analysis on the first five runs: largest pokeemerald 2,067 of 2,906 ms; pokeemerald `generate` 8,048 of 9,688 ms, `init` 10,446 of 14,532 ms), g4.e2e-real (six tuning ROMs; sealed 2 of 2), g4.toml-mutations (258 legal edits build with `make`, 170 illegal edits give their codes, 57 ROMs), g4.worktree (56, nothing generated committed, duty 5 run in each worktree), g4.generate-idempotent (57 ROMs) (2,930 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `6a3e765b…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,324.9 MiB, `generate` 1,185.1 MiB, tree `d60c5331…`), g4.toml-mutations (228 legal, 152 illegal, 51 ROMs), g4.packed-e2e (672 files), g4.e2e-fixtures (50), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests), g4.c-data-fails-loud (1,644 s) |
| `npm run bench -- provenance` | 0 | source digest `6a3e765b…` (Node 24) ok; gate record ok (23); families live; 6 rows, no sealed row |

Every command exits 0, so **phase 4 passes its closing gate** at `landed` 4 after fix round 4 and the owner's answers
to Q8 and Q9. sa2 passes `g2.speed` at 93.5% of its limit, inside the spread recorded under Q2 (87.4% to 96.3%), so
no new owner question arises. The merge to `main` waits for the phase pull request's CI; nothing is merged or pushed.

### Fix round 3's closing run (`2efb732`)

After fix round 3 (D78; `ebd9f37`, `24aed24`, `2efb732`), with `test/gates/phase.json` still `{ "landed": 4 }`, the
whole closing list again in a fresh worktree at `2efb732` (`git worktree add --detach` under the system temporary
directory: no `node_modules`, no `bench/.local`), in the landing run's order and environment (the real tier before the
ci tier, objdiff-cli 3.7.2 from the main checkout's build), from 23:12 on 20 October to 01:01 on 21 October 2026.
Node 24.15, binutils 2.45.1, macOS; nothing else ran on the machine. The worktree was clean afterwards but for the
`bench/results.json` the run wrote, committed as this run's artifact (`3cd738d`: `meta.commit` `2efb732`, not dirty,
source digest `26c7ae17…`, Node 24, with the real-tier gate record). The doubled ROM is the same `fb17b88d…` image.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,396 tests, 2,396 pass, 0 fail (31 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 460.4 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (265 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (54 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 96 tests, 96 pass, 0 skipped (805 s); `decompiled-c` (new) builds klonoa to its SHA-1 after the NONMATCHING rename and the module split; `listed-invalid` W_LISTED_INVALID 0 on all six; `padding-orphans` orphan files fe7j 32, klonoa 23, pokeemerald 23, sa2 16, sa3 15, tmc 33, zero pads kept after a `c` module's last function 4, 0, 5, 1, 0, 1 (D78 b) |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (4.2 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass; memory family `init` 1,135.9 MiB, `generate` 1,170.2 MiB peak RSS under the 1,024 MiB cap, tree `d60c5331…` (the new tree of the module-end pads, D78 b) (350 s, agbcc built at the pin included) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled ROM: 7 checks ok (29,463 files), linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET (45 s) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,152.9 to 1,525.8 MiB peak RSS (`init --json` the largest; `verify --assemble --link --json` 1,509.9, `generate --json` 1,470.7), under D72 b's 1,536 MiB in every form of this run (414 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending. Among them: **g2.speed** ("median of 9 runs"; ratio 0.973; sa2 727 of 793 ms, 91.7%; klonoa 233 of 311, tmc 1,409 of 1,808, sa3 1,098 of 1,512, pokeemerald 2,064 of 4,275, fe7j 1,132 of 12,862), **g3.speed-budget** (ratio 0.983; analysis on the first five runs: largest pokeemerald 2,090 of 2,948 ms; pokeemerald `generate` 8,022 of 9,825 ms, `init` 10,438 of 14,738 ms), g3.readability, g3.link (51 fixtures, 6 of 6 tuning ROMs), g4.e2e-real (six tuning ROMs; sealed 2 of 2), g4.toml-mutations (258 legal edits build with `make`, 170 illegal edits give their codes, 57 ROMs), g4.worktree (56), g4.generate-idempotent (2,881 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `26c7ae17…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,232.4 MiB, `generate` 1,223.8 MiB, tree `d60c5331…`), g4.toml-mutations, g4.packed-e2e (672 files), g4.e2e-fixtures (50), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests), g4.c-data-fails-loud (1,608 s) |
| `npm run bench -- provenance` | 0 | source digest `26c7ae17…` (Node 24) ok; gate record ok (23); families live; 6 rows, no sealed row |

Every command exits 0, so **phase 4 still passes its closing gate** at `landed` 4 after fix round 3. sa2 passes
`g2.speed` at 91.7% of its limit, inside the spread recorded under Q2 (87.4% to 96.3%), so no new owner question
arises. The merge to `main` waits for the phase pull request's CI; nothing is merged or pushed.

### Fix round 2's closing run (`cf95b2f`)

After fix round 2 (D77; `b2f1d1c`, `c3a6a25`, `cf95b2f`), with `test/gates/phase.json` still `{ "landed": 4 }`, the
whole closing list again in a fresh worktree at `cf95b2f` (`git worktree add --detach` under the system temporary
directory: no `node_modules`, no `bench/.local`), in the landing run's order and environment (the real tier before the
ci tier, objdiff-cli 3.7.2 from the main checkout's build), from 19:07 to 20:49 on 20 October 2026. Node 24.15,
binutils 2.45.1, macOS; nothing else ran on the machine. The worktree was clean afterwards but for the
`bench/results.json` the run wrote (`poc-digests.json` and `poc-dump-rows.json` byte-identical), committed as this run's
artifact (`c1b8b45`: `meta.commit` `cf95b2f`, not dirty, source digest `3e3e3503…`, Node 24, with the real-tier gate
record). The doubled ROM is the same `fb17b88d…` image, rebuilt for the review's run and never committed.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,377 tests, 2,377 pass, 0 fail (29 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 455.9 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (247 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (51 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 95 tests, 95 pass, 0 skipped (731 s); `listed-invalid` W_LISTED_INVALID 0 on all six |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (4.1 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,194.5 MiB, `generate` 1,213.4 MiB peak RSS under the 1,024 MiB cap, tree `9c4bda7e…` (314 s) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled ROM: 7 checks ok (29,404 files), linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET (44 s) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,174.3 to 1,520.8 MiB peak RSS (`generate --json` the largest; `verify --assemble --link --json` 1,490.5, `init --json` 1,513.2), under D72 b's 1,536 MiB in every form of this run (397 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending. Among them: **g2.speed** ("median of 9 runs", nine measured per ROM; ratio 0.967; sa2 708 of 788 ms, 89.8%; klonoa 236 of 308, tmc 1,407 of 1,796, sa3 1,077 of 1,502, pokeemerald 2,070 of 4,246, fe7j 1,092 of 12,773), **g3.speed-budget** (ratio 0.955; analysis on the first five runs, D77 f: largest pokeemerald 2,049 of 2,865 ms; pokeemerald `generate` 7,929 of 9,549 ms, `init` 10,340 of 14,324 ms), g3.link (51 fixtures, 6 of 6 tuning ROMs), g4.e2e-real (six tuning ROMs from the source tree and from the installed tarball; sealed 2 of 2), g4.toml-mutations (258 legal edits build with `make`, 170 illegal edits give their codes, 57 ROMs), g4.worktree (56), g4.generate-idempotent (57 ROMs, all keep) (2,750 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `3e3e3503…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,229.1 MiB, `generate` 1,167.3 MiB, tree `9c4bda7e…`), g4.toml-mutations (228 legal, 152 illegal, 51 fixtures), g4.packed-e2e (672 files), g4.e2e-fixtures (50), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests) (1,464 s) |
| `npm run bench -- provenance` | 0 | source digest `3e3e3503…` (Node 24) ok; gate record ok (23); families live; 6 rows, no sealed row |

Every command exits 0, so **phase 4 still passes its closing gate** at `landed` 4 after fix round 2; sa2's `g2.speed`
passes, so no new owner question arises from it. The merge to `main` waits for the phase pull request's CI; nothing is
merged or pushed.

### The owner's answers (landing run)

The landing procedure after the owner's answers (D76): `test/gates/phase.json` raised to `{ "landed": 4 }` at `55899d1`
(after the commits that apply the answers: `a6854f7` the records, `aee6cb7` g2.speed's nine runs, `275bea3` ROMLIFT_CLI
in the scaffold, `2452525` the review's cheap minors), then the whole closing list in a fresh worktree at `55899d1`
(`git worktree add --detach` under the system temporary directory: no `node_modules`, no `bench/.local`, so the PoC
dumps, the corpus summary and the agbcc cache were all made in the run; objdiff-cli 3.7.2 found in the main checkout's
build, D65 j), every command from the worktree root in this order with the environment above, the real tier before the
ci tier, from 15:06 to 16:51 on 20 October 2026. Node 24.15, binutils 2.45.1, macOS; nothing else ran on the machine.
The worktree was clean afterwards but for the `bench/results.json` the run wrote (`poc-digests.json` and
`poc-dump-rows.json` byte-identical), which is committed as this run's artifact (`2251098`: `meta.commit` `55899d1`,
not dirty, source digest `c78418c3…`, Node 24, with the real-tier gate record).

Three deviations from fix round 1's list, each forced by the cache-free worktree: `npm run export-poc -- --mode
scored`, `--mode parity` and `--mode queries` run after `--mode raw` (the gates read their dumps from `bench/.local/poc`,
as phase 3's landing list ran them), and `npm run corpus` before `run --scaffold` (which refuses a missing corpus
summary). The doubled ROM is `pokeemerald.gba` twice over, rebuilt for the run (`fb17b88d…`, never committed).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,364 tests, 2,364 pass, 0 fail (29 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 672 files, 449.6 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (255 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs (51 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 95 tests, 95 pass, 0 skipped (773 s); `listed-invalid` W_LISTED_INVALID 0 on all six (5, 4, 6, 4, 4, 24 with every listed entry validated; other diagnostics: sa3 four W_WALK_LIMIT, tmc W_UNLISTED_FUNCTION 0x080B1A28, Q6); `large-rom-bin` (every bin form on the 32 MiB synthetic ROM under the 1,024 MiB cap), `padding-orphans`, `emission-real`, `poc-raw-printer`, `c-stub-agbcc`, `config-mutations`, `objdiff` pass |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run corpus` | 0 | 100% round trip (4.2 s) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,260.4 MiB, `generate` 1,112.2 MiB peak RSS under the 1,024 MiB cap, tree `9c4bda7e…` (340 s, agbcc built at the pin included) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled pokeemerald ROM (`fb17b88d…`): tiling, reencode, module-size, text-layout (29,404 files), paths, assemble (521 modules) and link all ok, linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET; 45.4 s, peak RSS 1,474.3 MiB |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,132.0 to 1,513.2 MiB peak RSS (`generate --json` the largest; `verify --assemble --link --json` 1,493.3, `init --json` 1,504.1), live heap up to 924.8 MiB (the raw `verify`); both `--link` forms link `fb17b88d…` (399 s) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: not required, phase 6's since D76 g), 8 pending (g5, g6). Among them: **g2.speed** ("median of 9 runs"; ratio 0.969; sa2 731 of 790 ms, 92.5%; klonoa 231 of 309, tmc 1,404 of 1,800, sa3 1,069 of 1,505, pokeemerald 2,090 of 4,256, fe7j 1,093 of 12,804), g3.speed-budget (pokeemerald `generate` 7,735 of 9,790 ms, `init` 9,939 of 14,685 ms), g3.link (51 fixtures, 6 of 6 tuning ROMs), g4.e2e-real (all six tuning ROMs from the source tree and from the installed tarball; sealed 2 of 2, counts only), g4.toml-mutations (258 legal edits build with `make` to the SHA-1 and 170 illegal edits give their codes, on 57 ROMs), g4.worktree (56), g4.generate-idempotent (2,788 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: not required, phase 6's since D76 g), 7 pending. Among them: g1.provenance (source digest `c78418c3…`; 23 real-tier gates of phase ≤ 4 pass or are historical), g3.large-rom (`init` 1,301.0 MiB, `generate` 1,179.0 MiB under the 1,536 MiB budget, tree `9c4bda7e…`), g4.toml-mutations, g4.packed-e2e (672 files; adr-function-label through setup.sh's npm and npx duties without ROMLIFT_CLI; 50 fixtures), g4.e2e-fixtures (50; the composite's illegal border is E_MODULE_BORDER), g4.worktree (50), g4.cli-contract (8 commands, 12 `--json` runs), g4.no-toml-write (153 runs), g4.checks-fail (3 files, 24 tests), g4.c-data-fails-loud, g4.multi-compiler, g4.toml-canonical (1,535 s) |
| `npm run bench -- provenance` | 0 | source digest `c78418c3…` (Node 24) ok; gate record ok (23 real-tier gates of phase ≤ 4 pass or are historical); families live; 6 rows, no sealed row |

Every command exits 0, so by the landing procedure and the owner's answers **phase 4 passes its closing gate** at
`landed` 4, and the marker stays raised. The doubled ROM's readable `verify --link` peak (1,474.3 MiB) joins the spread
recorded below. The merge to `main` waits for the phase pull request's CI (`ci.yml`, `printer.yml`, `provenance.yml`),
as AGENTS.md requires; nothing is merged or pushed.

### The closing run of fix round 1 (`fb20674`, then `34865f5`)

The orchestrator's list, from the repository root of the main checkout, `test/gates/phase.json` at `{ "landed": 3 }`
(as at `a4c753e`: the phase cannot land while owner questions are open), Node 24.15, binutils 2.45.1, macOS, on 20
October 2026. Steps 1 to 9 and the doubled ROM's two steps ran at `fb20674`; the gates then found `g3.text-layout`
`pending` (its `needs` named `checkEntry`, which D75 n stopped exporting), fixed at `34865f5` (only `test/gates`
changed, which the source digest covers but no other command reads), after which the source-digest steps ran again at
`34865f5`: npm ci, typecheck, lint, test, fixtures check, build and pack, `run --scaffold`, `regression`, both gate
tiers and `provenance`. Two deviations: `npm run corpus` ran before `run --scaffold`, since the corpus inputs digest
changed with fix round 1's foundation files and `run --scaffold` refuses a stale corpus summary (it is the input of the
artifact's printer member, not in the orchestrator's list); and the first attempt's `gates --require 4 --tier ci` (at
`fb20674`, after its real tier failed on the pending gate) still ran while the second attempt's steps 1 to 10 and the
start of its real tier ran, so those shared the machine; every timing gate passed regardless. The artifact `bench run
--scaffold` wrote at `34865f5` is committed (source digest `bf499ebe…`, with the real-tier gate record).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | (both runs) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | the architecture checker and its mutation test pass |
| `npm test` | 0 | 2,357 tests, 2,357 pass, 0 fail |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 674 files, 449.7 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped (`fb20674`) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 95 tests, 95 pass, 0 skipped (778 s, `fb20674`); `listed-invalid` W_LISTED_INVALID 0 on all six (other diagnostics: sa3 four W_WALK_LIMIT, tmc W_UNLISTED_FUNCTION 0x080B1A28, Q6); `padding-orphans` no zero-pad orphan on the six (orphan files fe7j 1,558 → 28, klonoa 87 → 23, pokeemerald 3,222 → 18, sa2 464 → 15, sa3 882 → 15, tmc 2,321 → 32; nop pads left 21, 21, 15, 15, 15, 0, Q7); `large-rom-bin`, `emission-real`, `poc-raw-printer`, `c-stub-agbcc`, `config-mutations`, `objdiff` pass |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok (objdiff-cli 3.7.2) (`fb20674`) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (init 0, setup.sh 0, make 0, SHA-1 match) on all six tuning ROMs; both sealed ROMs pass, init build SHA-1; memory family `init` 1,156.5 MiB, `generate` 1,173.1 MiB peak RSS under the 1,024 MiB cap, tree `9c4bda7e…` (286 s) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled pokeemerald ROM (`fb17b88d…`): tiling, reencode, module-size, text-layout (29,404 files), paths, assemble (521 modules) and link all ok, linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; 161 W_UNLISTED_FUNCTION (Q6) and 1 W_READING_BUDGET; 46.9 s, peak RSS 1,481.0 MiB (`fb20674`) |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,133.0 to 1,525.9 MiB peak RSS (`verify --assemble --json` the largest; `verify --assemble --link --json` 1,480.9, `init --json` 1,524.4, `generate --json` 1,522.4), live heap up to 924.8 MiB (the raw `verify`); both `--link` forms link `fb17b88d…` (408 s, `fb20674`) |
| `npm run bench -- gates --require 4 --tier real` | 0 | 22 pass, 1 historical (g2.poc-parity), 2 fail (g5.expected-bytes, g5.objdiff: phase 5, not required), 8 pending (g5, g6). Among them: g2.speed (ratio 0.975; sa2 716 of 795 ms, 90.1%; klonoa 242 of 311, tmc 1,387 of 1,812, sa3 1,016 of 1,515, pokeemerald 2,063 of 4,284, fe7j 1,115 of 12,887), g3.speed-budget (pokeemerald `generate` 7,780 of 9,914 ms, `init` 10,092 of 14,871 ms), g3.link (51 fixtures, 6 of 6 tuning ROMs), g3.text-layout, g4.e2e-real (all six tuning ROMs from the source tree and from the installed tarball; sealed 2 of 2, counts only), g4.toml-mutations (258 legal edits build with `make` to the SHA-1 and 170 illegal edits give their codes, on 57 ROMs), g4.worktree (56; adr-function-label through the tools/agbcc submodule), g4.generate-idempotent (2,691 s) |
| `npm run bench -- gates --require 4 --tier ci` | 0 | 37 pass, 3 fail (g5.c-data-ranges, g5.expected-bytes, g5.reconciler: phase 5, not required), 7 pending. Among them: g1.provenance (source digest `bf499ebe…`), g3.large-rom (`init` 1,283.6 MiB, `generate` 1,121.6 MiB, tree `9c4bda7e…`), g4.toml-mutations (228 legal edits with `make`, 152 illegal, 51 fixtures), g4.packed-e2e (674 files; adr-function-label through setup.sh's npm and npx duties without ROMLIFT_CLI; 50 fixtures), g4.e2e-fixtures (50; the composite's illegal border is E_MODULE_BORDER), g4.worktree (50), g4.cli-contract, g4.no-toml-write (153 runs), g4.checks-fail (1,465 s) |
| `npm run bench -- provenance` | 0 | source digest `bf499ebe…` (Node 24) ok; gate record ok (19 real-tier gates of phase ≤ 3 pass or are historical); families live; 6 rows, no sealed row |

The doubled ROM's peaks across the runs measured in this phase (correctness-3): its readable `verify --assemble --link
--json` under the cap 1,508 MiB (wave 3), 1,498.8 MiB (`b318e60`), 1,525.8 MiB (`a4c753e`), 1,567.8 MiB (the review's
run of `10ff9ed`), 1,481.0 MiB and 1,480.9 MiB (this run); `large-rom --bin`'s fourteen forms 1,213.2 to 1,508.4 MiB
(`a4c753e`), 1,148.4 to 1,546.7 MiB (the review's), 1,133.0 to 1,525.9 MiB (this run). The spread is about 90 MiB, and
the readable `verify --link` on the doubled ROM can go over D72 b's 1,536 MiB budget (one run of six did); no gate
measures the doubled ROM (D72 e), and the phase-3 limitation stands (a code-dense ROM larger than this may exceed the
cap).


### The closing run at `a4c753e`

The orchestrator's list, every line from the repository root of the main checkout in this order (the real tier before
the ci tier), on branch `phase-4` at `a4c753e` (the closing round's fix on top of `b318e60`, the last wave-3 merge),
`test/gates/phase.json` at `{ "landed": 3 }` (not raised: "Deviations"), with `ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC`
as above, from 07:13 to 08:36 on 20 October 2026. Node 24.15, binutils 2.45.1 (Arm GNU Toolchain 15.3.Rel1), macOS;
nothing else ran on the machine. The working tree held this record's uncommitted docs edits (`AGENTS.md`, `README.md`,
`docs/phase-4.md`, none in the source digest), so the artifact `bench run --scaffold` wrote says `dirty`; it is committed
as this run's artifact (`meta.commit` `a4c753e`, source digest `2c9c96dd…`, Node 24, with the real-tier gate record).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 0 vulnerabilities (1 s) |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 2,343 tests, 2,343 pass, 0 fail (29 s) |
| `npm run fixtures -- check` | 0 | 51 of 51 fixtures agree (binutils 2.45.1) |
| `npm run build && npm pack --pack-destination "$(mktemp -d)"` | 0 | `romlift-0.0.0.tgz`, 656 files, 440.4 kB |
| `npm run export-poc -- --mode raw` | 0 | 51 fixtures dumped |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 95 tests, 95 pass, 0 skipped (698 s); among them `large-rom-bin` (the fourteen bin forms, `init` and `generate` included, on the 32 MiB synthetic ROM under the 1,024 MiB cap, 697 s), `listed-invalid` (W_LISTED_INVALID 0 on all six), `padding-orphans` (six ROMs), `emission-real`, `poc-raw-printer`, `c-stub-agbcc`, `config-mutations`, `objdiff` |
| `npm run bench -- doctor-real` | 0 | every ROM, ELF, map, object set, the PoC checkout and the toolchain ok (objdiff-cli 3.7.2) |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1 and the init build (`init` 0, `setup.sh` 0, `make` 0, SHA-1 match) on all six tuning ROMs; sealed pokefirered and pokeruby pass; memory family `init` 1,252.5 MiB and `generate` 1,152.7 MiB peak RSS under the 1,024 MiB cap, tree `92610833…` (271 s) |
| `npm run bench -- regression` | 0 | no regression against `e915c82` |
| `node --max-old-space-size=1024 --conditions=source src/cli/main.ts verify --rom <emx2.gba> --assemble --link --json < /dev/null` | 0 | the doubled pokeemerald ROM (`fb17b88d…`): tiling, reencode, module-size, text-layout (29,537 files), paths, assemble (521 modules) and link all ok, linked SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`; diagnostics 161 W_UNLISTED_FUNCTION and 1 W_READING_BUDGET (as in phase 3), no W_LISTED_INVALID (357 before Q5 c); 43.9 s, peak RSS 1,525.8 MiB |
| `npm run bench -- large-rom --bin --rom <emx2.gba>` | 0 | all fourteen forms exit 0 with ok summaries or completed, 1,213.2 to 1,508.4 MiB peak RSS, live heap 381.9 to 923.3 MiB (the raw `verify` the largest); both `--link` forms link `fb17b88d…`; `init --json` 1,489.6 MiB, `generate --json` 1,508.4 MiB (383 s) |
| `npm run bench -- gates --require 4 --tier real` | **1** | 21 pass, 1 historical (g2.poc-parity), 3 fail, 8 pending. Required and failing: **`g4.toml-mutations`** alone (the ten fixtures of Q4, each `delete` of its last listed function: `generate` exit 1 with W_UNLISTED_FUNCTION and E_MODULE_BORDER; every other legal and illegal edit, and every edit on the six tuning ROMs, as required). Pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end (0 on all six), g2.confirm-equals-discover (tmc's 8 recorded differences only), g2.determinism, g2.entries, g2.extents, g2.held-out (both sealed ROMs pass, family conditions waived as recorded), g2.no-unreviewed, **g2.speed** (ratio 0.947; sa2 682 of 772 ms, 88.3%; klonoa 236 of 302, tmc 1,323 of 1,759, sa3 970 of 1,472, pokeemerald 1,980 of 4,160, fe7j 1,104 of 12,515), g3.link (51 fixtures, 6 of 6 tuning ROMs), g3.raw-link (57), g3.readability, g3.self-check (57), g3.speed-budget (pokeemerald `generate` 7,461 of 9,494 ms, `init` 9,788 of 14,241 ms), g3.text-layout (57), g3.tree-determinism, **g4.e2e-real** (all six tuning ROMs reach their SHA-1 from init, setup.sh and make; sealed: 2 of 2, counts only), g4.generate-idempotent, g4.worktree (56). Not required: g5.objdiff and g5.expected-bytes fail (phase 5) (2,303 s) |
| `npm run bench -- gates --require 4 --tier ci` | **1** | 36 pass, 4 fail, 7 pending. Required and failing: **`g4.toml-mutations`** alone (the same ten fixtures). Pass, among them: g1.provenance (source digest `2c9c96dd…`), **g3.large-rom** (`ba3f6988…`, cap 1,024 MiB: `init` 1,122.3 MiB, `generate` 1,171.2 MiB against 1,536 MiB, tree `92610833…`), g4.c-data-fails-loud, g4.checks-fail (3 files, 24 tests), g4.cli-contract (8 commands, 12 `--json` runs), g4.e2e-fixtures (50 fixtures; the composite's illegal border is E_MODULE_BORDER), g4.generate-idempotent, g4.multi-compiler, g4.no-toml-write (153 runs), g4.packed-e2e (656 files; 50 fixtures from the installed tarball), g4.toml-canonical, g4.worktree (50). Not required: g5.c-data-ranges, g5.expected-bytes and g5.reconciler fail (phase 5) (1,240 s) |
| `npm run bench -- provenance` | 0 | source digest `2c9c96dd…` (Node 24) ok; gate record ok (19 real-tier gates of phase ≤ 3 pass or are historical); families live (memory and scaffold included); 6 rows, no sealed row |

Every command exits 0 but the two `gates --require 4` runs, and both fail on `g4.toml-mutations` alone, which is owner
question Q4 (no default; the gate is not changed). By the orchestrator's rule the phase does not land: `phase.json`
stays at `{ "landed": 3 }`, nothing is merged or pushed, and Q1 to Q4 wait for the owner. The run joins Q2's record
(sa2 at 88.3% of its `g2.speed` limit, passing).

### The first run at `b318e60`

Before the closing round the list ran at `b318e60` through `test:local` (06:34 to 06:50): every step exited 0 but
`test:local`, whose `large-rom-bin` failed on the synthetic ROM (`model`, `verify` and the other forms after the
config exit 1 with E_MODULE_BORDER, the closing round's defect), and a discovery run of `gates --require 4 --tier ci`
failed `g4.toml-mutations` (Q4) and `g1.provenance` (the source digest before the artifact was regenerated). The
doubled ROM's readable `verify --assemble --link` exited 0 there too (55.6 s, 1,498.8 MiB), and `large-rom --bin` on
it completed every form.

## Review

### Fix round 1 (the review of the closing run at `10ff9ed`)

Thirty-two findings: two blockers, nine majors, twenty-one minors. Every blocker and major is fixed; every minor is
fixed but three, which are fixed in part or answered with a reason; three facts the review raised that the owner has
not authorised became owner questions (Q5, Q6, Q7). The decisions are D75 (a) to (p). Commits on `phase-4` after
`10ff9ed`, in order: `27ab98d`, `f970fa1`, `82d9bcc`, `af2baf4`, `614894c`, `40be45f`, `d1a5a1a`, `587f56f`, `29c28de`,
`d77c401`, `71a30f9`, `2d71975`, `516f97f`, `066ec21`, `ab8f53e`, `9244205`, and this record's.

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-1 | blocker | **Fixed** (`f970fa1`, D75 b, c). `generate` reconciles every existing `src/<module>.c` of a generated `c` module: `planIncludeAsm` adds the stub of a function the module gained and removes the stub of its own directory whose function it lost (a rename, a deletion, a move or split: a move is a removal plus an insertion in the other file), as a `reconciled` entry applied only while the file has the sha1 it was read with (`E_STALE_EDIT`), journalled. A tree written elsewhere (`verify`'s temporary directory, `generate --out`) gets the reconciled text, so project-mode `verify --link` links the C `make` compiles and refuses a unit with decompiled C instead of linking a fresh stub. Roadmap 5.A's remove and move cases land here because without them every legal edit of a `c` module breaks `make` (D75 b). The scaffold's Makefile also rebuilt an asm object from a file `generate` rewrote within the second only for C units; every object now records the SHA-1 of what its dependency lists name (D75 c; measured: `undefined reference to Renamed` from a stale `build/crt0.o` before it). Tests: `test/unit/reconcile/include-asm.test.ts` (removal, rename, split, shared lines, CRLF), `test/unit/workflow/generate-project.test.ts` (rename edit, `E_STALE_EDIT`, reconciled text in a fresh tree), `test/unit/cli/generate.test.ts` (a TOML rename and delete reach `src/main.c`), `test/unit/cli/verify.test.ts` (the reconciled C links; decompiled C refuses the link); templates/AGENTS.md says what `generate` does to `src/*.c`. |
| correctness-2 | major | **Fixed** (`82d9bcc`). `g4.toml-mutations` runs `./setup.sh` once per target and `make` after every legal edit, which must exit 0 (`make` exits 0 only at the SHA-1 `<name>.sha1` records), besides `generate` and `verify --link`. Measured at `82d9bcc`: ci tier 228 legal edits build with `make`, 152 illegal edits give their codes, 51 fixtures; real tier 258 and 170 on 57 ROMs (51 fixtures and the six tuning ROMs); both pass. The real set of failing edits before the fix was every rename, delete, split and move of a `c` module (correctness-1). |
| delivery-1 | blocker | **Fixed** (`27ab98d`, D75 a): Q4's option (c) in the product, the gate unchanged; Q4 withdrawn (above). |
| architecture-1 | major | **Fixed** (`40be45f`, D75 j). `initDirVerdict`, `replacedProblems` and `wantsLockStep` in `core/workflow/init.ts` decide; `E_DIR_NOT_EMPTY` moved to `core/workflow/codes.ts`; the shell only lists (`readInitDir`) and hashes (`readDigests`); the CLI sequences. |
| architecture-2 | major | **Fixed** (`40be45f`, D75 f). `initConfigOf` (`core/workflow/init-config.ts`) is the one path: build name with `_build`, `--module-size`, serialise and parse back; `init`, `generateFromRom`, `initModel` and the bench call it; `discoveredConfig`, `configAlone` and `initConfig` are gone. |
| architecture-3 | major | **Fixed** (`af2baf4`, D75 d). `Chunk.entry` (and the model-json chunk line's `entry`, present when it is not the span's start) comes from the chunk plan; `chunkEntry(chunk)` reads it; the printer's `leadingPad` reads the item table only. |
| architecture-4 | major | **Fixed** (`614894c`, D75 e). `executable?: true` on the scaffold entry and the `write` op; the mode is set on the temporary file before the rename; a `mode` op (journalled) restores missing bits; `markExecutable` and `isExecutableEntry` are gone. |
| delivery-2 | major | **Fixed** (`af2baf4`, D75 d). A zero pad at its module's end is the last item of the chunk before it, printed `.align 2, 0`; `padding-orphans.test.ts` now asserts no zero-pad orphan anywhere (fe7j 1,558 → 28 orphan files, klonoa 87 → 23, pokeemerald 3,222 → 18, sa2 464 → 15, sa3 882 → 15, tmc 2,321 → 32). |
| delivery-3 | major | **Fixed** (`71a30f9`, D75 o). `g4.e2e-real` runs the six tuning ROMs a second time from the packed and installed tarball (`npx romlift init` below the install). |
| delivery-4 | major | **Fixed** (`71a30f9`, D75 o), and the limitation is owner question Q5. `ROMLIFT_CLI` is recorded in architecture §6.3; `g4.packed-e2e`'s first fixture runs setup.sh without it (package.json at the tarball, asm/ removed), so duty 4's `npm install` and duty 5's `npx romlift generate` run. |
| delivery-5 | major | **Fixed** (`af2baf4`): architecture §3.4 (`Chunk.entry`), §6.2 step 2 (the pad exception) and plan.md's "No orphan bytes", citing D68 e and D75 d. |
| architecture-5 | minor | **Fixed** (`40be45f`): `foundation/util/line-diff.ts`, `core/workflow/scaffold-diff.ts`. |
| architecture-6 | minor | **Fixed** (`40be45f`): `profileOrDefault` in discover.ts, used by all four workflows. |
| architecture-7 | minor | **Fixed** (`40be45f`, D75 g): `foundation/util/project-files.ts`; `nonmatchingDir` uses `NONMATCHINGS_ROOT`; core/emit re-exports reconcile's `TextEdit`. |
| architecture-8 | minor | **Fixed** (`40be45f`, D75 h): `E_TOML_PARSE`; `E_UNKNOWN_COMPILER` raised for `[build] compiler` and module `compiler`; the comment is now true. |
| architecture-9 | minor | **Fixed** (`40be45f`, D75 h): `romSha1Problems` and `E_ROM_SHA1_MISMATCH` in `core/config/rom-sha1.ts`. |
| architecture-10 | minor | **Fixed** (`d1a5a1a`, D75 l): `BuildCompiler.banner`; the dead `rule` removed and MANIFEST.json held to one fragment per compiler by a test; the C-data lines in `foundation/asm/c-data-assert.ts`; `moduleCompile` throws for an unknown compiler. |
| architecture-11 | minor | **Fixed in part** (`2d71975`). The defect (only the bench's cache checked the agbcc pin; two shims) is fixed: test/helpers/e2e.ts builds its shim with the bench's `sourceCliScript` and refuses a prebuilt agbcc stamped with another pin. Not merged: the two process runners, because the harness's adds a time limit and process-group kill the bench's `runProcess` does not need, and merging them would change the bench's process semantics with no defect behind it. |
| architecture-12 | minor | **Fixed** (`587f56f`, D75 m): under the lock the TOML is re-read and must equal the text the plan came from, else `E_STALE_CONFIG` and nothing is saved. |
| architecture-13 | minor | **Fixed** (`40be45f`, D75 k): `core/write-plan/project-plan.ts` (`ProjectWriteState`, `projectPlanInputs`, `freshTreePlanInputs`, `planChangesNothing`), `retainedPrefixes` in `core/model/paths.ts`, the init equivalents in init-config.ts. |
| architecture-14 | minor | **Fixed** (`587f56f`, D75 n): no handle, no `WeakMap`; `checkEntries` is the public entry. |
| correctness-3 | minor | **Fixed in the record**: the doubled ROM's peaks are recorded as the spread of the runs measured, and the record says plainly that the readable `verify --link` on it can go over the 1,536 MiB budget ("Measured numbers", fix round 1). No gate measures the doubled ROM (D72 e, unchanged). |
| correctness-4 | minor | **Fixed in part**: the zero pads at module borders fold (`af2baf4`, delivery-2). The 0x46C0 nop pads stay orphans, with their counts and objects; the limitation is owner question Q7. |
| correctness-5 | minor | **Owner question Q6**, default (a): recorded as a limitation with its counts (tmc 1, the doubled ROM 161, the rest 0). |
| correctness-6 | minor | **Fixed** (`40be45f`, D75 i): the schema holds `[build] name` to init's rule and `[rom] path` to `baserom.gba`, each `E_TOML_SCHEMA` with its line. |
| correctness-7 | minor | **Fixed** (`d77c401`): `g4.worktree`'s first target runs setup.sh in the main checkout before the commit, requires the 160000 gitlink, and its worktree checks the submodule out; measured ci: 50 worktrees pass, adr-function-label through the submodule. |
| correctness-8 | minor | **Fixed** (`f970fa1`): the link writes the ROM once; the ROM rule only restores a removed ROM. |
| delivery-6 | minor | **Fixed** (`ab8f53e`): D74 (k) names Q1 to Q7, Q4 withdrawn. |
| delivery-7 | minor | **Fixed** (this record, "The carried minors" below). |
| delivery-8 | minor | **Fixed** (`516f97f`). |
| delivery-9 | minor | **Fixed** (`066ec21`, D75 p): AGENTS.md and roadmap.md state the one trailer phase 4 uses. |
| delivery-10 | minor | **Fixed** (`29c28de`): the test passes its own temporary-directory prefix and asserts only on it. |

### The carried minors

- architecture-r2-1 (TextLayoutIndex exported with its Maps): `a328c13` made it an opaque handle; fix round 1 removed the
  handle and its registry from the public API (architecture-14, D75 n). Closed.
- architecture-r2-4 (the case rename is not journalled): `p4-safety-minors` (above). Closed.
- correctness-r0-5's remainder (pool.ts calls `moduleAt` once per address with labels): carried again, to phase 6
  (D76 g; phase 5 is skipped), for the reason phase-3.md gave (threading the relocated-module list through `wordText`,
  `labelForWord` and their callers changes the printer helpers' signatures for a filter over a few dozen modules) and
  because phase 6 now reworks the printer's matchings split, which touches the same helpers (roadmap.md, "Carried from
  phase 4").
- gate-honesty-r1-3's remainder (the phase pull request's CI numbers): done in phase 3; phase-3.md "The phase pull
  request's CI" records them (ci.yml on both OSes and both Node versions). Closed.

### The review of fix round 1 (`d3c2da5`)

Only its architecture lens ran (the correctness lens and the landing agent failed on a service error, not a finding):
eight minors. The cheap ones are fixed with the owner's answers; the rest are carried to phase 6 (roadmap.md, "Carried
from phase 4"), since each changes code with no defect behind it and phase 6 reworks the same modules (D76 h).

| Finding | Severity | Disposition |
| --- | --- | --- |
| architecture-r1-1 | minor | **Fixed**: `cDataSectionLine` and `cDataAssertLine` moved to `core/model/c-data-assert.ts`; `foundation/util/project-files.ts` recorded as the one exception to "foundation holds no project knowledge" (D76 h), and architecture §2's package layout amended to say so. |
| architecture-r1-2 | minor | **Carried to phase 6**: the aliases of `BASEROM_FILE` (`BASEROM_PATH`, `SCAFFOLD_ROM_FILE`, `TARGET`, the decomp-yaml re-export) and one of `functionName`/`defaultFunctionName`. |
| architecture-r1-3 | minor | **Carried to phase 6**: core/layout to own the whole legal-start rule (`isLegalStart` beside `borders`), `planModules` to take only `BorderRule`, §6.2's sentence updated. |
| architecture-r1-4 | minor | **Carried to phase 6**: the stub encoding to take the banner from the module's compiler (`buildCompilerOf(module.compiler).banner`, an invariant error when unknown), or one constant without the `?? ''`. |
| architecture-r1-5 | minor | **Fixed**: `E_UNKNOWN_COMPILER` comes from the refinement's structured marker (`params: {romliftCode}`, carried into `ConfigIssue.code`), never from its message; `test/unit/config/schema.test.ts` holds a compiler of the wrong type to `E_TOML_SCHEMA`. |
| architecture-r1-6 | minor | **Carried to phase 6**: one agbcc pin check (`agbccCacheCurrent`, or one function with a stated policy for an unstamped prebuilt) and one `readAgbccPin` for e2e.ts and the bench; D75's and this record's wording ("the agbcc pin check is the bench's") is corrected here: the e2e helper still re-implements it. |
| architecture-r1-7 | minor | **Fixed in part**: `test/unit/util/line-diff.test.ts` and `test/unit/config/rom-sha1.test.ts` are new. Carried to phase 6: moving the `initDirVerdict`/`replacedProblems` and project-plan tests out of `read-inputs.test.ts`, and a `test/unit/workflow/c-stubs.test.ts`. |
| architecture-r1-8 | minor | **Fixed in part**: `projectRomProblems` deleted (its callers and the public barrel use `romSha1Problems`). Carried to phase 6: removing `checkEntry`, which thirty text-layout tests call; a one-entry `checkEntries` adds the stream-level diagnostics those tests do not expect, so it needs a test helper of its own. |

### Fix round 2 (the review of the landing run at `6e5ccd1`)

The first review after the owner's answers (D76): twenty findings, three majors and seventeen minors. Every major is
fixed, every minor is fixed or fixed with a carried remainder; no fix needs a gate change the owner has not
authorised, so no owner question is raised. The decision is D77. Commits on `phase-4` after `6e5ccd1`: `b2f1d1c` (the
product fixes), `c3a6a25` (bench speed and the speed gates), `cf95b2f` (the records), `c1b8b45` (the closing run's
artifact) and this record's. The closing run is in "The closing gate", fix round 2.

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-a0-1 | major | **Fixed** (`b2f1d1c`, D77 a). `E_C_STALE_DEFINITION` (a definition the module no longer has where a missing stub goes), `E_C_DEFINITION_MOVED` (a definition the TOML gives another module), both errors, so `generate` writes nothing instead of leaving `make` a function defined twice; `W_C_FILE_UNUSED` for a `src/*.c` of no module. The scaffold's `AGENTS.md` says decompiled C is renamed or moved by hand until phase 6's rename; recorded under "Known limitations". Tests: the planner's unit tests, `test/unit/workflow/c-stubs.test.ts`, and `test/unit/cli/generate.test.ts` (a decompiled function renamed in the TOML alone exits 1 and changes no file; with its C renamed too, generate passes and the file defines it once). |
| correctness-a0-2 | major | **Fixed** (`b2f1d1c`, D77 b). The outermost conditional regions are tracked; a stub goes after the region's `#endif` or before its `#if`, never inside; an unclosed region leaves no place inside or after it (`E_C_STUB_UNPLACED`). Tests: the NONMATCHING pattern in the planner's tests and through `generate` in `test/unit/cli/generate.test.ts`. |
| architecture-a0-1 | major | **Fixed** (`b2f1d1c`, D77 e). `analyze --update`'s confirm run seeds through `listedSeedsOf` (`updateSeeds` is gone), so every confirm run validates only entries with `from`, as the owner's answer to Q1 says; it applies the answer, so it is not put to the owner. D76 a and the limitation say so; architecture §4 names the rule and its one source. |
| gate-honesty-a0-1 | minor | **Fixed** (`c3a6a25`, D77 f): the first option. `g3.speed-budget` reads `budgetAnalysisCpuMs`, the median of the first five of the nine runs, the measurement it made before D76 b; the gate comment, D76 b, architecture §8.4, §8.5 and §13 say so. No gate change beyond D76 b remains, so no owner question. |
| gate-honesty-a0-2 | minor | **Fixed** (`c3a6a25`, D77 g): the counts are the samples measured (`analysisRuns` per ROM, `runs.analysis` the fewest), and `g2.speed` requires nine per ROM. |
| gate-honesty-a0-3 | minor | **Fixed** (`b2f1d1c`, `c3a6a25`, this record): AGENTS.md's two rows, `bench/src/families.ts`'s summary (and its unit test) and `bench/src/objdiff.ts` point to phase 6 (D76 g). |
| gate-honesty-a0-4 | minor | **Fixed** (this record): D76's consequences say Q5 changed the scaffold templates and golden. |
| correctness-a0-3 | minor | **Fixed** (`b2f1d1c`, D77 c): the tokenizer skips a leading U+FEFF; no edit moves it. Unit test with a BOM file. |
| correctness-a0-4 | minor | **Fixed** (`b2f1d1c`, D77 d): `generate --out` writes the C files as generated files of that tree (manifest-listed, rewritten by a later run); a unit test runs `--out` twice across a rename. |
| correctness-a0-5 | minor | **Fixed** (`b2f1d1c`): the templates run the other commands as `node /path/to/romlift/dist/cli/main.js generate`; the scaffold golden is updated. |
| correctness-a0-6 | minor | **Fixed** (this record, D77 e): architecture §4 says only an entry with `from` is validated and one without never warns. |
| correctness-a0-7 | minor | **Fixed** (`b2f1d1c`, D77 a): every unplaced name is `E_C_STUB_UNPLACED` (an error, so nothing is written); the last stub of a shared line takes the blanks before it (the probe now gives `a);\nINCLUDE_ASM(…, c);\n`). |
| architecture-a0-2 | minor | **Fixed** (`b2f1d1c`, D77 h): `NONMATCHINGS_ROOT`, `nonmatchingDir`, `chunkFileOf` and `INCLUDE_ASM_HEADER_PATH` moved to `foundation/util/project-files.ts`, the recorded exception; architecture §2 says so. |
| architecture-a0-3 | minor | **Fixed** (`b2f1d1c`, D77 h): one `nonmatchingDir` (`includeAsmDir` is its alias), one chunk-file join, `ROMLIFT_RENDERED_TARGETS` from the constants. |
| architecture-a0-4 | minor | **Fixed in the records** (this record, D77 k): architecture §6.2 says `legalBorders` has no caller and records the `analyze --update` border case as a limitation (not reproduced); the `borders.ts` docstring is corrected; r1-3's one owner of the rule stays carried to phase 6, with this added to the carry. |
| architecture-a0-5 | minor | **Fixed** (`b2f1d1c`, D77 l): `files` is a readonly array sorted by path; the c-stubs test holds the JSON round trip. |
| architecture-a0-6 | minor | **Fixed** (this record, D77 k): the seven modules in architecture §2, the dropped legacy and trace modules marked, §6.2 names `initConfigOf`; the private helper is `configBeforeSerialising`. |
| architecture-a0-7 | minor | **Fixed** (`b2f1d1c`, D77 i): `core/verify/c-stub.ts`'s problem text ends "(build decompiled C with make)"; `text-layout.ts` and the listed comments point to phase 6; the ASSERT text stays carried. |
| architecture-a0-8 | minor | **Fixed** (`b2f1d1c`, D77 j): `writeInitProject` reads the digests under the lock and refuses with `E_DIR_NOT_EMPTY` (a unit test changes romlift.toml between two writes); the shared CLI helpers are in `analysis-records.ts`. The digests are computed by the command, since core never hashes. |
| architecture-a0-9 | minor | **Fixed** (this record): phase 6 enters after phase 4, 6.0 depends on phase 4, 6.C's gba-kit items are marked dropped by D76 g. |
| architecture-a0-10 | minor | **Fixed** (this record): the `DECOMP_YAML_NAMES` re-export added to r1-2's carry; r1-7's carry no longer lists the c-stubs test, which landed. |

### Fix round 3 (the review of fix round 2's closing run at `1c07b13`)

Twenty-one findings: five majors and sixteen minors. Every major is fixed, each reproduced on klonoa with agbcc and
`make` before and after (the NONMATCHING rename, a module split behind a decompiled function, a rename and a deletion
with a border move, a helper beside a renamed asm-only function) and held by unit and CLI tests; every minor is fixed
but one part rejected and two carried with a reason. No fix needs a gate change the owner has not authorised, so no
owner question is raised. The decision is D78. Commits on `phase-4` after `1c07b13`: `ebd9f37` (the reconciliation,
the module-end pads, the C-data text, the public names), `24aed24` (bench speed, the speed verdict, the CLI), the
records commit `2efb732`, the closing run's artifact `3cd738d` and this record's ("The closing gate", fix round 3's
closing run: every command exit 0).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-a1-1 | major | **Fixed** (`ebd9f37`, D78 a). Nothing inside an `#if` region is edited: an unwanted stub there is `E_C_CONDITIONAL_STUB` (an error, nothing written) instead of a removal, and a definition there holds nothing for the default build. On klonoa: the NONMATCHING block of `sub_08028104` renamed `Nop` in the TOML refuses with `E_C_CONDITIONAL_STUB` and `E_C_STALE_DEFINITION`, with the C renamed alone with `E_C_CONDITIONAL_STUB`, and with the `#else` stub renamed too `generate` exits 0 and `make` prints `akle.gba: OK`. Tests: the planner's NONMATCHING and conditional-definition cases, `test/unit/cli/generate.test.ts` (each step, and the `#else` branch holding `Nop` once with `asm/nonmatchings/main/Nop.s` written). |
| correctness-a1-2 | major | **Fixed** (`ebd9f37`, D78 a). `E_C_STALE_DEFINITION` keys on the previous tree, the chunk files on disk (`previousChunkFiles`, `chunkNamesOf`): a definition of a function of that tree no module has now is stale wherever it lies. On klonoa the reviewer's rename with main_3's start moved to 0x08028108 exits 1 with `E_C_STALE_DEFINITION` and writes nothing. Tests: `reconcileStubs` with previous chunk files, and a CLI test of a border move with the decompiled function moved (`E_C_DEFINITION_MOVED`), renamed or deleted (`E_C_STALE_DEFINITION`), each exit 1 with no file changed. |
| correctness-a1-3 | major | **Fixed** (`ebd9f37`, D78 a): the same key; a static helper is no function of any tree. On klonoa the reviewer's `Helper` before a renamed asm-only `DmaThing` gives `generate` exit 0 and `make` OK. Tests: the planner (with and without the previous tree) and a CLI test. Without chunk files on disk D77 a's rule stays, recorded under "Known limitations". |
| correctness-a1-4 | major | **Fixed** (`ebd9f37`, D78 b): a zero pad ending a `c` module after a function is its own orphan again; D75 d's claim is corrected in D75 d's revision, chunks.ts and architecture §6.2. On klonoa, `m3b` at 0x08028108 behind the decompiled `sub_08028104` now gives `unk_08028106`'s own `INCLUDE_ASM` and `make` OK. Orphan files: fe7j 32, klonoa 23, pokeemerald 23, sa2 16, sa3 15, tmc 33 (the 11 pads); `padding-orphans` requires every zero-pad orphan left to be one; nine fixtures' goldens change, no byte. `test/local/decompiled-c.test.ts` (new) builds it with agbcc and `make` on klonoa (and fails with the fold of D75 d put back), with the NONMATCHING rename of correctness-a1-1 before it; `test/unit/model/chunks.test.ts` holds the rule. |
| architecture-a1-1 | major | **Fixed** (`ebd9f37`, D78 a): wanted chunks are `{name, stub}` pairs (`stubChunks`); definitions match by symbol, stubs by stub name, insertions use the stub name. Tests: the planner, the c-stub writer (VBlankCB/VblankCB), `reconcileStubs`, and a CLI test that decompiles `Foo` of a Foo/foo pair (exit 0, no edit). |
| correctness-a1-5 | minor | **Fixed** (`ebd9f37`): for an `asm` or `data` destination the advice is to delete the C or make that module `c`; test in `c-stubs.test.ts`. |
| correctness-a1-6 | minor | **Fixed** (`ebd9f37`, D78 c): "romlift does not place C data yet" in the ASSERT and the scaffold's `AGENTS.md`; goldens updated; `g4.c-data-fails-loud`'s match is unchanged. |
| architecture-a1-12 | minor | **Fixed** with correctness-a1-5. |
| gate-honesty-a1-1 | minor | **Fixed** (this record): Q2 records the nine-run sa2 shares, 87.4% to 96.3%, that the limit's spread comes from the five-run calibration, and the owner's rule for a later failure; the closing run below adds its share. |
| gate-honesty-a1-2 | minor | **Fixed** (`24aed24`, D78 e): `runs.emission` is measured. |
| gate-honesty-a1-3 | minor | **Fixed** (`24aed24`, D78 e): `analysisRow` with nine known samples (first-five median 30, all-nine median 50), and `speed-verdict.ts` rejecting a report or a ROM of five runs. |
| gate-honesty-a1-4 | minor | **Fixed** (this record, `24aed24`): roadmap.md's carry from phase 3 states D77 f; the families test title points to phase 6. |
| architecture-a1-2 | minor | **Fixed** (`24aed24`, D78 f): `writeInitProject` computes the digests from its files and the ROM (one `initTexts`); D77 j's reasoning corrected. |
| architecture-a1-3 | minor | **Fixed** (`24aed24`, D78 f): `command-common.ts` holds `verifyExitCode`, listed in architecture §2; D77 j corrected. |
| architecture-a1-4 | minor | **Fixed** (`ebd9f37`, D78 d): the aliases are deleted; `stubNameOf`, `INCLUDE_DIR` and `INCLUDE_ASM_HEADER_NAME` in `project-files.ts`, with a test that the Makefile passes `-I include`. |
| architecture-a1-5 | minor | **Carried to phase 6** (roadmap.md, "Carried from phase 4", with r1-3): the gate and the property test pick borders with `legalBorders` over the discover run; one predicate over the confirm run comes with core/layout's single legal-start rule. No defect is behind it today: every legal edit the gate draws builds with `make`. |
| architecture-a1-6 | minor | **Fixed** (`24aed24`, D78 f): `project` dropped; `InitWriteOutcome.refused`. |
| architecture-a1-7 | minor | **Fixed** (`24aed24`, D78 f): `TreeSource.target`. |
| architecture-a1-8 | minor | **Fixed** with gate-honesty-a1-2: `fewest` never gives Infinity. |
| architecture-a1-9 | minor | **Fixed** (`ebd9f37`, `24aed24`): `command-common.test.ts` (refusedExitCode 1 against 3, verifyExitCode, opCounts), the CLI border-move test, the case-fold tests. |
| architecture-a1-10 | minor | **Fixed in part** (`24aed24`, `ebd9f37`, D78 c, g): the families title, the shipped text, and `g4.cli-contract`'s two recipes of dropped commands (never run: no registry holds them). **Rejected**: renumbering the `g5.*` gates and their headers; D76 g leaves their ids, phases and fate to phase 6's plan, and `--require 4` does not count them. |
| architecture-a1-11 | minor | **Fixed in the record** (D78 g): architecture §6.2 limits the one-path sentence to `init`, `verify --rom`, `model --rom`, `bench speed`'s emission and `scaffold.init`, and names `discoverModel`'s users; `explain --rom` keeps the discover model, since it explains the discover run it traced (D35). |
| architecture-a1-13 | minor | **Fixed** (this record): the carry list gains a1-5's oracle; a1-4's aliases are gone rather than carried. |

### Fix round 4 (the review of fix round 3's closing run at `2314ffe`)

Eighteen findings: five majors and thirteen minors. Two majors were owner questions, Q8 and Q9, answered on 21 October
2026 and applied exactly (D79). The three others are fixed with a planner or CLI test that reproduces each (D80 a);
every minor is fixed but one, carried to phase 6 with a reason. No gate changes beyond the owner's answers: Q9's
`g4.worktree` checks (nothing generated committed, duty 5 run in the worktree). Commits on `phase-4` after `2314ffe`:
`8a15817` (the reconciliation, the stale edit at write, the shell reader), `e60a855` (Q8 and Q9: the scaffold's
`.gitignore`, `g4.worktree`, `padding-orphans`), the records commit `7c0a452`, the closing run's artifact `13abfe9`
and this record's ("The closing gate", fix round 4's closing run: every command exit 0).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-a2-1 | major | **Fixed** (`8a15817`, D80 a). A definition where the stub goes of a chunk whose file the previous tree held in the module's own directory, and which the file neither includes nor defines, is `E_C_STALE_DEFINITION` ("where the INCLUDE_ASM of X was, and module M still has X"); a stub name new to that directory keeps D78 a's helper exemption. Tests: the planner, `reconcileStubs`, and the CLI (C-only rename exits 1, nothing written; with `asm/` removed, the fallback rule refuses it too). |
| correctness-a2-2 | major | **Fixed** (`8a15817`, D80 a). Each `#if` branch must leave the brace and parenthesis depth the conditional found; an unbalanced branch or an unclosed definition makes the file unscannable, `E_C_UNSCANNABLE` (new, error), no edit. Tests: the reviewer's shape and sa2's `screen_mask.c` shape in the planner, the reviewer's shape through `generate` (exit 1, nothing written), balanced branches unchanged. |
| correctness-a2-3 | major | **Fixed** (`8a15817`, D80 a). A missing stub between two chunks one region holds is `E_C_STUB_UNPLACED`; the planned text is scanned again and an insertion out of ROM order is `E_C_STUB_UNPLACED`, not a later `W_C_ORDER`. Test: a two-stub `#else` region and a split of the first, in the planner. |
| gate-honesty-a2-1 | major | **Owner question Q8**, answered "Keep as orphans" (D79 a): a known limitation authorised by the owner; `padding-orphans` asserts exactly that rule and pins the counts (fe7j 4, klonoa 0, pokeemerald 5, sa2 1, sa3 0, tmc 1). |
| architecture-a2-1 | major | **Owner question Q9**, answered "Gitignore, as R4 says" (D79 b): the scaffold's `.gitignore` ignores the generated roots; D78 a, `c-stubs.ts`, `include-asm.ts`, architecture §1, §6.3 and §6.6, the scaffold's `AGENTS.md` and `README.md` say that the previous-tree rule holds from a clone's second `generate`; `g4.worktree` and the render test follow (`e60a855`). |
| gate-honesty-a2-2 | minor | **Fixed** (this record): Q7's text and plan.md's "No orphan bytes" state D78 b's module-end rule and Q8. |
| gate-honesty-a2-3 | minor | **Fixed** (this record): the memory limitation names `init --json` 1,562.8 MiB and the readable `verify --assemble` 1,551.3 MiB beside `verify --link`, and says `init` is not held under the budget on the doubled ROM. |
| correctness-a2-4 | minor | **Fixed** (`8a15817`, D80 b): a `src/*.c` of no module is read, and a function a module has defined there is `E_C_DEFINITION_MOVED`. Tests: `reconcileStubs` and a CLI test deleting `main_3`'s `[[modules]]` block of the composite. |
| correctness-a2-5 | minor | **Fixed** (`8a15817`, D80 b): `applyWrites` hashes an edit's file right before its write; a save since the plan is `E_STALE_EDIT`, the save kept, the journal left. Test in `apply-writes.test.ts`. |
| correctness-a2-6 | minor | **Fixed** (`8a15817`, D80 a): the name skips `(*` declarator groups and `__attribute__`/`asm` groups (`void (*B(void))(void)`, `__attribute__((section(".iwram"))) void B(void)`); a K&R definition or an unnamed head is `E_C_UNSCANNABLE`. Planner tests. |
| correctness-a2-7 | minor | **Fixed by Q9** (D79 b): a clone has no `asm/`, so its first `generate` writes the whole tree under a new manifest and later renames delete the old files. |
| architecture-a2-2 | minor | **Fixed** (this record): architecture.md's surviving phase-5 items point to phase 6 (§1's non-goal, §2.1's `generate` and `rename` rows, the `dataStart` comments, §6.1's matchings, §6.3's `asm/matchings`, §6.6's data ranges, the C-data fixture, the evidence facts, the objdiff rows); the phase 5 and 6 rows of §1, §2.1's `import-legacy` and `trace` rows, the §6.6 heading's import-legacy and §6.8 are marked dropped or skipped by D76 g; plan.md cites D78 b. |
| architecture-a2-3 | minor | **Fixed** (`8a15817`, D80 b): `compiledDefinitions` in `core/reconcile/include-asm.ts`, read by `heldOf` and `decompStateOf`; a unit test holds a conditional-only definition out of the DecompState. |
| architecture-a2-4 | minor | **Fixed** (`8a15817`, D80 c): `isChunkFile` in `project-files.ts`; `isDirectory` in `shell/fs.ts`, absent only on ENOENT or ENOTDIR; `readChunkFiles` and `readProject`'s `previousChunkFiles` have unit tests. |
| architecture-a2-5 | minor | **Fixed** (`8a15817`, D80 c): `earlier`/`later` for the neighbours, `retired` for the previous tree's names (`IncludeAsmWanted.previous` renamed); the two chunk types say they mirror each other across the `core/reconcile` edge. |
| architecture-a2-6 | minor | **Carried to phase 6** (roadmap.md, "Carried from phase 4", D80 d): init's own file set to come from core's `InitPlan`; it changes a frozen type (D74 c) with no defect behind it, and phase 6's rename reworks init's plan. |
| architecture-a2-7 | minor | **Fixed** (`8a15817`, D80 c): `allDiagnostics` exported by `command-common.ts`, called by `verifyExitCode` and `verify.ts`. |
| architecture-a2-8 | minor | **Fixed** (this record): roadmap.md's r1-6 carry names the three `readAgbccPin` and the two pin-stamp checks. |

### Fix round 5 (the review of fix round 4's closing run at `32390c3`)

Twelve findings: three majors and nine minors. Every major is fixed, each reproduced first by a planner, CLI or
`decompiled-c` test (D81). Of the minors, seven are fixed, one (architecture-b0-8) needed nothing, and one is fixed in
part: correctness-b0-4's diagnostic lands, its gate case is carried. No gate changes what it requires: the review's two
gate edits (correctness-b0-3's add-override edit, correctness-b0-4's illegal edit) change `g4.toml-mutations`, which
the owner has not authorised in phase 4 (his answers authorise Q2's and Q9's only), so both are carried to phase 6
with the override semantics (roadmap.md, "Carried from phase 4"); neither is needed by the fix, and the gate's header
states its add-override edit exactly. `g4.worktree` now reads the product's `underGeneratedRoot` instead of its own
copy of the same list, so its verdict is unchanged. Commits on `phase-4` after `32390c3`: `5fd0086` (the code and its
tests), the records commit `566d5f5`, the closing run's artifact `3c1a8b8` and this record's results ("The closing
gate", fix round 5's closing run: every command exit 0).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-b0-1 | major | **Fixed** (`5fd0086`, D81 a). The scanner reads a conditional as the preprocessor would: each branch from the state its `#if` found, the first branch's state after the `#endif`, every branch's items kept; at file scope the branches must end alike. Over 1,739 real decomp `.c` files, 35 unscannable become 2 (sa2's `ASM_FUNC` with no `;` against a definition). A file still unscannable is `E_C_UNSCANNABLE` only when it needs an edit (a wanted chunk no stub at any depth names and no definition read holds, a stub at any depth that would go, an unwanted stub in a region), else `W_C_UNSCANNABLE` (new, warning) and no edit. Tests: the do/while idiom, tmc's per-version `if (…) {`, sa2's `screen_mask.c` and `light_bridge.c` shapes in the planner; a CLI case with the idiom then in a fresh clone (no generated file) and a TOML rename after it; an unscannable file warned, cloned, then refused once a rename needs an edit; `decompiled-c` on klonoa: the idiom in `Nop`, `make` to the SHA-1, then from a fresh clone's state through `./setup.sh` (duty 5) and `make` to the SHA-1. The known limitation now states the clone consequence. |
| correctness-b0-2 | major | **Fixed** (`5fd0086`, D81 a). `IncludeAsmWanted.tree` (the chunk files the run writes, the directories of `generated = false` modules): a stub of another `asm/nonmatchings/<m>` directory naming no file of the tree is removed outside a region, `E_C_CONDITIONAL_STUB` inside one. Tests: the planner (a `git mv`'d file, decompiled C between stubs, a live module's, a user module's and a non-nonmatchings stub kept, a region), `reconcileStubs`, a CLI case renaming the composite's `main_3` to `boot` with `src/main_3.c` moved, with and without decompiled C (every remaining stub names a file on disk), and `decompiled-c` on klonoa (main_3 renamed `boot`, `make` to the SHA-1). The scaffold's `AGENTS.md` says how to rename a `c` module. |
| correctness-b0-3 | major | **Fixed as a warning; the semantics carried to phase 6** (`5fd0086`, D81 c). `W_OVERRIDE_IGNORED` (new, `core/model`) for every override without `runs_at` that changes nothing (a data override; a code override that gives no listed entry its extent), recorded under "Known limitations" and in architecture §6.5. Applying overrides to the analysis (a data span claimed, a `seed.override` seed) changes the tree and the analysis, and making `g4.toml-mutations`' add-override edit one that changes the model changes a gate the owner has not authorised: both carried to phase 6 (roadmap.md). Tests: the model (data, unused code, a code override that gives an unfound entry its extent: no warning) and a CLI case. |
| correctness-b0-4 | minor | **Fixed; the gate case carried** (`5fd0086`, D81 c). `E_FUNCTION_MISALIGNED` (new, error, `core/model`): a `[functions]` key odd for Thumb or not word-aligned for ARM is refused naming the key (with the pointer-value hint), `generate` exit 1 before the check pass. Tests: the model and a CLI case (with and without `from`, nothing written). Adding it to `g4.toml-mutations`' illegal edits is a gate change, carried to phase 6. |
| architecture-b0-1 | minor | **Fixed** (`5fd0086`, D81 b). `staleEdit(op, sha1Now, when)` in `core/write-plan/plan-writes.ts` is the one rule; `planWrites` and the shell's `applyWrites` (`staleAtWrite`: read, hash, call) both use it; the shell raises no core code itself. architecture §6.4 steps 3 and 4 and the §9.1 table say so; `src/shell/index.md` lists it; D81 b amends D80 b. Test: `staleEdit` at plan and write time; the journal mutation test mutates the rule. |
| architecture-b0-2 | minor | **Fixed** (`5fd0086`, D81 a). `compiledDefinitions` returns `{scannable, definitions, unscannable?}`; a file of no module that cannot be split warns `W_C_UNSCANNABLE` and is still checked over what was read (`E_C_DEFINITION_MOVED`); `decompStateOf` states its policy (the definitions as read). With the new scanner the review's `A`/`B` text scans, and `decompStateOf` returns `["A", "B"]`. Tests: `reconcileStubs` (an unscannable file of no module: `W_C_FILE_UNUSED`, `W_C_UNSCANNABLE`, `E_C_DEFINITION_MOVED`) and `decompStateOf` (the review's text, a K&R file). |
| architecture-b0-3 | minor | **Fixed** (`5fd0086`). `g4.worktree` calls `cx.need('underGeneratedRoot')` (its `needs` lists it) and deletes its local list, which equalled `GENERATED_ROOTS`; the verdict is unchanged. |
| architecture-b0-4 | minor | **Fixed** (`5fd0086`). `src/api/reconcile.ts` exports `compiledDefinitions`, `CompiledDefinitions`, `CUnscannable`, `CConditional`, `WantedChunk`, `StubTree`; its ownership line names phase 6 (D76 g); the phase-4 exports test checks the reconcile names and `staleEdit`. |
| architecture-b0-5 | minor | **Fixed** (records commit). `src/cli/index.md` lists `init`, `generate`, `analyze --update`, `scaffold --diff` and project mode; `src/core/index.md` and `src/shell/index.md` gain their phase-4 tables; `analyze.ts` and `core/index.md` mark import-legacy dropped (D76 g). |
| architecture-b0-6 | minor | **Fixed** (`5fd0086`). `fs.test.ts`: `isDirectory` under a mode-000 directory is `E_IO_READ` (ENOTDIR and absent stay false); `read-inputs.test.ts`: `readChunkFiles` with `asm/`, `asm/nonmatchings/` or a module directory at mode 000 is `E_IO_READ`; both skipped as root. |
| architecture-b0-7 | minor | **Fixed** (`5fd0086`). `moduleChunkStubs(files, module)` in `core/model/paths.ts`, beside `chunkNamesOf` and with its `chunkFileOf` round trip, is what `c-stubs.ts` reads; `IncludeAsmWanted.priorStubs` is `previousStubs`, beside `retired`. |
| architecture-b0-8 | minor | **Nothing to do**: the six open architecture-r1 minors stay carried to phase 6 as roadmap.md writes them; none depends on `g5.import-legacy`. |

### Fix round 6 (the review of fix round 5's closing run at `3a1eea7`)

Seventeen findings: two majors and fifteen minors. Both majors are fixed, each reproduced first by a CLI test and then
end to end on klonoa with agbcc in `test/local/decompiled-c.test.ts` (D82). Every minor is fixed. No gate changes what
it requires: `g4.worktree` holds R4's list of generated roots again, united with the product's rule (the owner's Q9
answer is the requirement it checks), `g4.toml-mutations`' refused-edit snapshot covers `tools/` but the agbcc
checkout, as its header says, and its note reports the legal edits by kind. Commits on `phase-4` after `3a1eea7`:
`d664b4d` (the code, templates and tests), the records commit `6c7b1a6`, the closing run's artifact `ee22c89` and
this record's results ("The closing gate", fix round 6's closing run: every command exit 0).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-b1-1 | major | **Fixed** (D82 a). `modules.mk` records `ROMLIFT_TOML_SHA1`, the SHA-1 of the `romlift.toml` bytes it was generated from (`init` and `generate`); the scaffold's `Makefile` stops before any build while the file's SHA-1 differs, naming `npx romlift generate`; `setup.sh`'s duty 5 also regenerates then; the scaffold's `AGENTS.md`, `README.md` and `.gitignore` say to run it after a pull. Tests: `modules.mk`'s stamp (writer, CLI from `init` and after a TOML edit), the rendered `Makefile` and duty 5 run with `make` and `sh` against a stale, a stampless and a current `modules.mk`, and `decompiled-c` on klonoa: the project committed and cloned, two upstream renames pulled, `make` stopping with the message, then `./setup.sh` and `romlift generate` each followed by `make` to the SHA-1. |
| correctness-b1-2 | major | **Fixed** (D82 b). A file that gains a stub with neither an `INCLUDE_ASM` statement nor `#include "include_asm.h"` gains that include above its first line of code; `E_C_DEFINITION_MOVED` names the new module's source path. Tests: the planner, a CLI case (a split behind decompiled C refused, the C pasted alone into `src/math.c`, `generate` exit 0 with the include and the stubs, idempotent), and `decompiled-c` on klonoa (a split at the decompiled `Nop`, the C pasted alone into `src/m3a.c`, `make` to the SHA-1). |
| correctness-b1-3 | minor | **Fixed** (D82 b). A `src/*.c` a module's source `#include`s is part of the module (held at the `#include`, no `W_C_FILE_UNUSED`, another module's function `E_C_DEFINITION_MOVED` naming the fragment); a quoted include of an unread non-`.h` file refuses every insertion (`E_C_STUB_UNPLACED`). Tests: the planner, `reconcileStubs`, a CLI case (the `.c` fragment exit 0 with nothing written; the `.inc` one exit 1, nothing written). |
| correctness-b1-4 | minor | **Fixed** (D82 b). A definition in every branch of a terminated conditional with an `#else` (outside nested conditionals) is compiled, the first branch's counted. Planner tests: the reviewer's text needs no edit; `#elif` without `#else`, one branch only and a nested conditional still get the stub; a split after it goes after the `#endif`. |
| correctness-b1-5 | minor | **Fixed** (D82 b). Insertions (stubs, the header, joined insertions) take the file's line terminator. Planner tests in a CRLF file, with no bare LF left. |
| architecture-b1-1 | minor | **Fixed** (D82 d). `insnAligned` and `insnUnit` in `foundation/rom/span.ts`, used by the layout, the rows, `seed.ram-copy` and the config; `E_FUNCTION_MISALIGNED` is `core/config`'s, raised by `parseConfig` with the key's line, so `generate` and `analyze --update` refuse it alone (no `W_LISTED_INVALID` beside it). Tests: the config (Thumb, ARM, with `from`), the CLI asserting the full diagnostic list of both commands. `valid.in-rom-unclaimed` is unchanged: no listed entry reaches it misaligned. |
| architecture-b1-2 | minor | **Fixed** (D82 d). `PlacedEntry.override` records the override `placeEntries` applied; `W_OVERRIDE_IGNORED` is every override without `runs_at` it did not apply, never for a range wholly outside the ROM. Test: the model (the reviewer's wholly-outside code override gives only `W_OVERRIDE_OUTSIDE_ROM`). |
| architecture-b1-3 | minor | **Fixed** (D82 d). `planWrites`' docstring is back above it; `staleEdit` takes `EditedFileState` (sha1, absent, unread), the planner reads the disk first, and the write-time check reports a removed file. Tests: the four messages, the absent-and-unread case through the planner; the journal mutation test mutates the new comparison. |
| architecture-b1-4 | minor | **Fixed** (D82 c). `misplacedInsertions` is removed (unreachable: the review's coverage run and fuzz never reached it); architecture §6.6, D80 a and the planner's comment say so. |
| architecture-b1-5 | minor | **Fixed** (D82 c). `test/local/c-scan-corpus.test.ts`: 1,729 files of the six tuning checkouts, unscannable exactly sa2's two (D81 a's 1,739 included the 10 files of the klonoa-empire-of-dreams working tree, no dataset checkout); AGENTS.md's `test:local` row lists it. |
| architecture-b1-6 | minor | **Fixed** (D82 d). `readChunkFiles` builds paths with `chunkFileOf(nonmatchingDir(…), stubNameOf(…))`; `readCTexts` uses `isCSource` and `cSourceOf` (`foundation/util/project-files.ts`, which `moduleSource` uses too). |
| architecture-b1-7 | minor | **Fixed** (D82 c). `heldOf` and the unscannable check read `compiledDefinitions(scan).definitions`; the docstring, §6.6 and D81 a say the planner tests the verdict itself. |
| architecture-b1-8 | minor | **Fixed** (records). roadmap.md "Carried from phase 4" lists `seed.evidence-hint`, the `legacy` and `evidence:trace` proposal sources with their `sourceKey` spellings, and the trace reader and format; architecture §2 marks `rename-tokens.ts` as phase 6's and `read-trace.ts` and `trace-json.ts` as dropped. The six architecture-r1 remainders stay carried as written. |
| gate-honesty-b1-1 | minor | **Fixed** (D82 e). `g4.worktree`'s `R4_GENERATED` is R4's list, united with `underGeneratedRoot`. |
| gate-honesty-b1-2 | minor | **Fixed** (D82 e). The snapshot leaves out `.git` and `tools/agbcc` only; the header says so. |
| gate-honesty-b1-3 | minor | **Fixed** (D82 e). Fix round 5's closing rows state the add-override share (57 of 258, 51 of 228); the gate's note now reports the legal edits by kind; README says one kind is a no-op until phase 6. |
| gate-honesty-b1-4 | minor | **Fixed** (records). The memory limitation's range reads 1,133 to 1,581 MiB and records `generate --json` at 1,535.2 MiB, 0.8 MiB under the budget. |
