# Phase 4: One shot

The record of phase 4 (roadmap "Phase 4", architecture §2.1, §3.4, §6.3 to §6.6, §13, D20, D21, D23, D47, D49, D51,
D62 to D74). It is kept by the phase lead: the components as they merge, every deviation from the roadmap, the owner
questions, the known limitations, the measured numbers and the closing gate. Every number is measured on the owner's
machine with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. The tuning set is six ROMs (fe7j, klonoa, pokeemerald,
sa2, sa3, tmc; D60), and every phase-4 threshold applies to all six (D74 j); the held-out ROMs (pokefirered, pokeruby)
run sealed and report counts only (D25).

**Verdict.** Not landed. Every component is merged on `phase-4` and the closing list ran at `a4c753e` (below, "The closing
gate"): every command exits 0 but `gates --require 4 --tier ci` and `gates --require 4 --tier real`, which fail on
`g4.toml-mutations` alone (owner question Q4, which has no default), and nothing else of phase 1 to 4 fails. The phase
also waits for the owner's answers to Q1 to Q3, built with their defaults. `test/gates/phase.json` stays at
`{ "landed": 3 }`; nothing is merged to `main` or pushed.

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
| `romlift generate [--rom <rom>] [--dry-run] [--out <dir>] [--json]` | inside a project (found by walking up to `decomp.yaml`): the confirm analysis over `romlift.toml`, the model, the check pass and the write plan under the project lock; never opens the TOML for writing (`g4.no-toml-write`); a ROM whose SHA-1 is not `[rom] sha1` is `E_ROM_SHA1_MISMATCH` and a model error (`E_MODULE_BORDER`, …) writes nothing and exits 1; a keep-only plan is not applied, so mtimes stay |
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
  worktree, `npm ci`, `romlift generate` when `asm/` is absent), `.gitignore`, `AGENTS.md`, `README.md`, the build
  workflow, `.gitmodules`, `package.json` (the exact romlift version), `include/macros.inc` and `include/include_asm.h`.
- C modules (D74 e, f): `src/<module>.c` is `#include "include_asm.h"` and one `INCLUDE_ASM("asm/nonmatchings/<module>",
  <name>);` per chunk in ROM order (`planIncludeAsm` over the C tokenizer, never a regex over code; `W_C_ORDER`);
  `modules.mk` holds `OBJS`, `C_OBJS` and each C object's `CC1` and `CFLAGS`; the ldscript's `.c_data_<m>` section and
  `ASSERT` make C data fail the link loudly (`g4.c-data-fails-loud`); `agbcc` and `old_agbcc` per module
  (`g4.multi-compiler`).
- The phase-3 work items the owner assigned (D68 e, D72 c): padding-only orphans folded into the next function (orphan
  files on pokeemerald 3,222 → 24, tmc 2,321 → 34, fe7j 1,558 → 41, sa3 882 → 16, sa2 464 → 17, klonoa 87 → 24; no byte
  changes; `test/local/padding-orphans.test.ts`); the confirm run validates only `[functions]` entries with `from`
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

The closing run deviates from roadmap "Phase 4 exit" and AGENTS.md in five ways, each by the orchestrator's plan or
forced by a fact:

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

The phase does not land until each is answered. Work proceeds with the stated default.

### Q1. The scope of Q5 c: which listed functions the confirm run still validates

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

### Q4. g4.toml-mutations: is deleting the last listed function a legal edit?

Raised by `p4-workflows` (wave 3), the first branch on which `init` exists and the g4 gates run. `g4.toml-mutations`
draws its "delete a listed function that starts no module" edit from every `[functions]` entry that starts no module.
On 10 of the 51 committed fixtures the draw is the **last** listed function (adr-function-label 0x0800010C, c-data
0x08000130, code-copied-to-ram 0x08000128, code-end-data-decodes 0x08000100, code-end-unsized-last 0x08000100,
data-frame-not-function 0x08000164, pointer-table-before-leaf 0x08000144, pointer-word-in-gap 0x08000120,
ram-code-entries 0x08000158, ram-copy-memcpy 0x08000164; checked by script: each is the highest key of its config).

Facts. Without that entry the confirm run takes nothing past the previous function (W_UNLISTED_FUNCTION: discovery
would accept it, but confirm mode claims nothing it does not list, architecture §4.2, D8), so the analysis' code end,
and with it the data start of the layout (`core/layout/borders.ts` codeLayout), moves down to the deleted entry; the
`data` module still starts at the old data start, which is no longer a legal border, and `generate` refuses the
config with E_MODULE_BORDER (exit 1, nothing written), naming the new data start as the nearest legal border below.
Example (adr-function-label): `module data starts at 0x08000118, which is not a legal border: the nearest legal borders
are 0x0800010C below`. Every other legal edit of the gate (move-start, rename, add-override, split-module, and
delete-function when the entry is not the last) passes `generate` and `verify --link` to the SHA-1 on all 51
fixtures, and every illegal edit gives its code; the gate fails on these 10 only. `p4-e2e`'s pure property test
(`test/unit/workflow/toml-mutations.prop.test.ts`, wave 3) excludes the last entry from its delete edit for this reason
("and is not the last one, whose deletion moves the data start").

Options.

- (a) **The gate's delete edit skips the last listed function**, as the property test does: a gate change. A user who
  deletes the last entry still gets E_MODULE_BORDER and must move the data module to the start it names.
- (b) **The confirm run keeps what discovery accepts beyond the list inside the code region**: the code end covers
  the extent of each W_UNLISTED_FUNCTION finding (an analysis change in `core/analysis/driver`, measured against g2's
  gates; today an unlisted candidate is not read at all), so the bytes become an orphan chunk of the module before
  and the data start does not move.
- (c) **Any word-aligned address at or past the data start is a legal border for a `data` module**, so the data
  module may start after the code end and the bytes in between are data at the end of the module before (a layout and
  model change, `core/layout/borders.ts`, `core/model`).

No default: the gate is not changed and fails until the owner answers; `p4-workflows` is committed, not merged.

## Known limitations

- **Authorised by the owner** (D68 e, "Accept Q5a"): a ROM whose size the last unit's section alignment does not divide is
  refused by the text-layout check, and nothing is written (D65 a), a release-1 limitation.
- Pending the owner (Q3): the bin needs an `env` that accepts `-S`.
- Pending the owner (Q1, default (a)): a `[functions]` entry without `from` is taken without the valid.* rules, so one
  added by hand that fails validity no longer warns `W_LISTED_INVALID`.
- Pending the owner (Q4, no default): deleting the last listed function of a project moves the code end, and `generate`
  refuses the config with `E_MODULE_BORDER` until the `data` module is moved to the start the message names;
  `g4.toml-mutations` fails on the ten fixtures where its delete edit draws that entry.
- By design until phase 5 (architecture §6.6, D21): a C module that defines data fails the link on its `ASSERT`; the
  data ranges arrive with `g5.c-data-ranges`.
- `init` runs `npm install --package-lock-only` for the scaffold's `package.json`; romlift is not on the npm registry
  yet, so every `init` ends with `W_LOCKFILE_DEFERRED` (a warning, exit 0) and `setup.sh`'s `npm ci` needs a published
  romlift or `ROMLIFT_CLI`.
- `setup.sh` builds agbcc from source at the pin (network, git and a host C compiler; about 50 s); a mirror is
  `AGBCC_URL`.
- Memory: under the bin's 1,024 MiB cap the doubled pokeemerald ROM's commands peak at 1,213 to 1,526 MiB RSS (largest
  live heap 923.3 MiB, the raw `verify`), about 100 MiB under the old space; a code-dense ROM larger than 32 MiB of
  that density may exceed the cap (D72, unchanged). No gate measures the doubled ROM (D72 e).
- Three phase-5 gates fail instead of reporting `pending` once their inputs exist (`g5.c-data-ranges`: no
  `expect-ranges.json`; `g5.expected-bytes`: no `expected/`; `g5.reconciler`: no reconcile goldens); `--require 4` does
  not require them, and phase 5 builds what they read.

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
