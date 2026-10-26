# Final review

This is the final report of romlift's review after the six phases, run on 26 October 2026 against `main` at
`2499afa` (phase 6 merged as `7a5342f`, tag `phase-6`, then the review's fix rounds 1 and 2, D106 and D107). It
states what was verified and how, the final gate numbers per ROM (the held-out ones included), how they compare with
the proof of concept, the findings that remain and why, and the commands that reproduce the verification. The
dispositions of every earlier finding follow, from "Fix round 1" on.

**Verdict.** Phases 1 to 4 and 6 have landed; phase 5 (Migration) was skipped by the owner on 20 October 2026 (D92):
legacy import (`import-legacy`, the Luvdis cfg, ldscript symbols, `analyze --evidence`), the Klonoa migration tooling
and the switch-over are dropped, and `rename`, the reconciler, the `expected/` and `objdiff.json` writers, C data
ranges and the objdiff gate moved into phase 6 as `g6.*` gates. The plan's gba-kit trace integration was dropped by
the owner the same day (D91: "very few functions are called and found by gba-kit"); code run from RAM comes from
hand-written `runs_at` overrides only. Neither absence is a finding. At `2499afa` (source digest `641f0167…`, the same as
the closing run's `b98b2e6`) every gate of phases 1 to 6 passes
on both tiers, all six tuning ROMs and both sealed held-out ROMs go from `romlift init` through `./setup.sh` and
`make` to their SHA-1 with no file edited, and the five ROMs the proof of concept was tuned on reproduce its function
boundaries exactly. Ten minor findings of the last review pass remain (one fixed by this report's commit, nine open,
none touching a built ROM or a gate), with the five owner questions O1 to O5 and the items carried in roadmap.md
"Carried past phase 6". Release 1 cannot yet claim generality: the held-out gate passes only with both family
conditions waived (D60, D61).

## How it was verified: the five lenses

Each review pass read the project through five lenses. A finding's id names its lens and pass: no suffix for the
first pass (review of `0ccc5a0`), `-r1-` for the second (review of `a1a4328`, after fix round 1), `-r2-` for the
third (review of `2499afa`, after fix round 2).

| Lens | What it does | Finding ids (pass 1 / 2 / 3) |
| --- | --- | --- |
| clean clone (`clean-clone-*`) | clones the repository fresh and follows the README and AGENTS.md literally: `npm ci`, `npm run build`, the "Try it before it is published" flow, the real-tier prerequisites, the signature build, `bench run` | 11 / 4 / 3 |
| gates (`gates-*`) | re-runs the phase-6 closing list in a fresh worktree or clone and reads each gate's verdict against the decision that set it (thresholds, waivers, ceilings, timing margins) | 8 / 4 / 0 |
| end-to-end user (`end-to-end-user-*`) | a new user's session on real ROMs: `init`, `setup.sh`, `make`, then `generate`, `rename`, `analyze --update`, `[functions]` and `[[overrides]]` edits, `explain`, `make expected` and objdiff-cli on the result | 16 / 6 / 7 |
| architecture (`architecture-*`) | reads `src/` against docs/architecture.md: layer rules and the checker, the D36 composition rule, the diagnostic-code table, helpers, exports, the §2 tree | 15 / – / – |
| documents and plan (`docs-and-plan-*`) | reads README, AGENTS.md, plan.md, roadmap.md, the phase records and decisions.md against the code and each other, and against the owner's decisions (D91, D92) | 15 / – / – |

A dash marks a lens a pass did not run: passes 2 and 3 re-ran the clean clone, the gates and the new user only. Pass 1's 65 ids are
dispositioned in 12 major and 44 minor rows below (its own tally said 15 majors and 32 minors; a row merges ids that
name one defect, such as clean-clone-1, end-to-end-user-1 and docs-and-plan-7), pass 2 raised one blocker, one major
and twelve minors, pass 3 ten minors, two pairs of which are the same defect seen by two lenses. Fix rounds 1 and 2 fixed
every blocker and major. Each pass re-ran the gates: the closing list of fix round 1 at `31f13ce`, that of fix round 2
at `b98b2e6` (whose `bench/results.json` is committed), and pass 3's gates lens ran `bench run --scaffold` and the
real tier again in a fresh clone at `2499afa` (`romlift-verify`), with the same rows and verdicts as `b98b2e6` and only
the timings different (below). `2499afa` differs from `b98b2e6` in documents and `bench/results.json` only; the source
digest of both is `641f0167…`.

For this report a fresh clone of `main` at `2499afa` was checked again on 26 October 2026: `npm ci` 0;
`npm run typecheck` 0; `npm run lint` 0; `npm test` 0, 2,885 tests, 2,884 pass, 1 skipped (the objdiff-cli test, no
`ROMLIFT_OBJDIFF` in a plain clone); `npm run fixtures -- check` with `ROMLIFT_BENCH_ROOT` 0, 54 of 54 fixtures agree;
`npm run build` 0; then, in bash, from an empty directory holding klonoa's `baserom.gba`, `$ROMLIFT_CLI init
baserom.gba` 0 (560 functions, 18 modules, 631 files written; `W_SIGNATURES_ABSENT` and `W_LOCKFILE_DEFERRED`),
`git init`, `./setup.sh` 0 and `make` 0, `akle.gba: OK`, 51 s in all. The same `$ROMLIFT_CLI --version` under zsh
exits 127 (clean-clone-r2-1, still open).

## Final gate numbers

From the committed artifact of fix round 2's closing run (`b98b2e6`, source digest `641f0167…`, `bench/results.json`),
which every command of the closing list passed: the real tier 30 records, 29 pass and 1 historical
(`g2.poc-parity`, frozen since phase 2), 0 fail; the ci tier 46 of 46 pass; `bench provenance` ok.

### Tuning ROMs

| ROM | ELF functions | Found | Precision / recall | Missed / false | Extents agree | Code end | `init` → `setup.sh` → `make` | `g2.speed` CPU / limit (ms) | Signature placements, wrong | `g6.objdiff` gated / ceiling (uncompared) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 7,735 | 7,724 | 99.86% / 99.86% | 11 / 11 | 1,471 / 1,471 | 0 | SHA-1 | 1,050 / 12,314 | 134, 0 | 7 / 7 (0) |
| klonoa | 559 | 556 | 99.82% / 99.46% | 3 / 1 | 485 / 485 | 0 | SHA-1 | 224 / 297 | 120, 0 | 1 / 1 (130) |
| pokeemerald | 15,856 | 15,856 | 99.96% / 100.00% | 0 / 6 | 15,850 / 15,853 | 0 | SHA-1 | 2,062 / 4,093 | 377, 0 | 12 / 12 (2) |
| sa2 | 2,892 | 2,892 | 99.79% / 100.00% | 0 / 6 | 2,887 / 2,889 | 0 | SHA-1 | 619 / 760 (81.4%) | 147, 0 | 1 / 1 (0) |
| sa3 | 4,693 | 4,693 | 99.87% / 100.00% | 0 / 6 | 4,305 / 4,307 | 0 | SHA-1 | 1,008 / 1,448 | 189, 0 | 4 / 4 (0) |
| tmc | 8,636 | 8,631 | 99.86% / 99.94% | 5 / 12 | 8,388 / 8,388 | 0 | SHA-1 | 1,311 / 1,731 | 68, 0 | 25 / 25 (0) |

Every tuning ROM also links to its SHA-1 with both printers (`g3.raw-link`, `g3.link`, with the 54 fixtures), its
readable tree prints 99.999% or more of its instructions as mnemonics with 99.998% or more of branches and 100% of
pool words symbolic (`g3.readability`), `generate` is idempotent and every seeded legal TOML edit still builds
(`g4.toml-mutations`: 269 legal edits, 239 illegal, on 60 ROMs), the `expected/` objects of 432 modules on 61 targets
equal their ROM ranges (`g6.expected-bytes`), and klonoa's `SoundMainRAM` links at its run address through a
hand-written `runs_at` override (`g6.ram-code-mapped`). `g3.speed-budget` (calibration 0.932): analysis at most
1,953 of 2,795 ms (pokeemerald), pokeemerald `generate` 7,473 of 9,318 ms and `init` 9,333 of 13,977 ms;
`g3.large-rom` on the 32 MiB ROM peaks at 1,163.3 MiB (`init`) and 1,274.0 MiB (`generate`) under the 1,536 MiB budget.
Pass 3's re-run at `2499afa` measured `g2.speed` at calibration 0.962: fe7j 1,104 / 12,715, klonoa 233 / 307, pokeemerald
2,139 / 4,227, sa2 669 / 784 (85.3%), sa3 1,035 / 1,495, tmc 1,401 / 1,787 ms; everything else as above.

tmc is a tuning ROM since D60 and is held to its measured numbers (D61), not to the PoC-comparison gates;
confirm-equals-discover differs on 8 tmc functions, a recorded limitation (D61, Q6). `g6.objdiff` is a no-regression
ceiling, not a 100% score; on klonoa 130 of 485 functions are not compared (objdiff-cli cannot read one object,
carried as gates-4).

### Held-out ROMs (sealed)

| ROM | Family | ELF functions | Found | Precision / recall | False (startup / inside an ELF function) | Extents agree | Code end | `init` → `setup.sh` → `make` | Signature placements, tables, wrong |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pokefirered | pret-gen3 | 12,389 | 12,389 | 99.95% / 100.00% | 4 / 6 | 12,383 / 12,386 (99.976%) | 0 | SHA-1 | 353, 18, 0 |
| pokeruby | pret-gen3 | 11,455 | 11,455 | 99.95% / 100.00% | 4 / 6 | 11,449 / 11,452 (99.974%) | 0 | SHA-1 | 226, 15, 0 |

Both pass `g2.held-out` with nothing glued and no label candidates, and `g6.signatures-heldout`, sealed: no rule was
tuned on them. Both are from one family that the tuning set also holds (pokeemerald), so the gate passes only with its
two family conditions waived by the owner (D60, D61 b). tmc was the third held-out ROM until it failed in phase 2 and
the owner moved it into tuning (D60).

## Comparison with the proof of concept

| Measure | Proof of concept (docs/proof-of-concept.md) | romlift at `2499afa` |
| --- | --- | --- |
| Function entries on the five PoC ROMs | klonoa 99.82% / 99.46%, sa2 99.79% / 100%, sa3 99.87% / 100%, fe7j 99.86% / 99.86%, pokeemerald 99.96% / 100% | identical, entry for entry: the same true positives (556, 2,892, 4,693, 7,724, 15,856), misses and false entries; the parity digests and lockstep equal the PoC's (`g2.poc-parity`, frozen at phase 2) |
| tmc | not in the PoC's pinned results; its own run finds 8,582 | 8,631 (+49), recall 99.94% |
| Extents on the five | 24,995 of 25,005 (99.96%) | 24,998 of 25,005 (99.97%) |
| Held-out ROMs | none run | pokefirered and pokeruby sealed, 99.95% / 100% each |
| Library placements (m4a, libagbsyscall, libgcc) | klonoa 120, sa2 130, sa3 172, fe7j 134, pokeemerald 191; libagbsyscall, libgcc and m4a signature files | the same three libraries equal the PoC's converted files (`g6.signatures-rebuild`); with agb_flash, librfu and siirtc added: klonoa 120, sa2 147, sa3 189, fe7j 134, pokeemerald 377, tmc 68, held-out 353 and 226, 0 wrong on all |
| Scaffold | five ROMs rebuild byte for byte from raw `.2byte`/`.4byte` chunks; no instructions, no C stubs, no agbcc | six tuning and two sealed ROMs rebuild from readable GNU `as` (99.999%+ mnemonics) with `INCLUDE_ASM` C stubs compiled by agbcc, `expected/` and `objdiff.json`; the raw printer still reproduces the PoC's raw output on every fixture |
| Analysis time | 1 to 2 s per ROM, 7 s pokeemerald, 19 s sa3 (wall, unoptimised) | median CPU 0.22 s (klonoa) to 2.06 s (pokeemerald); sa3 1.01 s |

## Remaining findings

The last review pass (pass 3, review of `2499afa`) raised these after the last fix round. The workflow has no fix
round after it, so they are recorded here (and in roadmap.md "Carried past phase 6") rather than fixed, except
clean-clone-r2-3, which this report's commit fixes. All are minor: none changes a built ROM, a tree's SHA-1 result or a
gate verdict.

| Finding | Severity | Area | Status | Why it remains |
| --- | --- | --- | --- | --- |
| clean-clone-r2-1, end-to-end-user-r2-2 | minor | README "Try it before it is published", AGENTS.md `npm run build` row | open | In zsh (macOS's default shell) `$ROMLIFT_CLI init baserom.gba` exits 127, because zsh does not word-split `"node …/main.js"`; `dist/cli/main.js` is built 0644, so the bin path alone does not run either. Confirmed again for this report. The flow works in bash, `setup.sh` and the Makefile are unaffected, and zsh users can write `${=ROMLIFT_CLI}`. The fix (chmod the bin in the build and document the single-word form, or a shell function) touches the build and two documents, and no fix round followed the pass |
| clean-clone-r2-2, end-to-end-user-r2-3 | minor | README wording vs `init` (`W_LOCKFILE_DEFERRED`) | open | With `ROMLIFT_CLI` set, init skips npm and its 404 wait as the README says, but still prints `W_LOCKFILE_DEFERRED` (seen again for this report). The message is accurate and harmless; demoting it or rewording the README is a one-line change no round was left to make |
| clean-clone-r2-3 | minor | README documentation table | fixed in this report's commit | The row now says the file holds the final report, every finding's disposition and the gate results of both fix rounds |
| end-to-end-user-r2-1 | minor | `generate`, a `[functions]` entry inside a found function | open | The cut leaves the outer function's tail as an unowned `unk_` chunk with an `INCLUDE_ASM` stub and no diagnostic; `make` still reaches the SHA-1, but objdiff counts the chunk's local labels as functions. The fix is a new warning (`W_CODE_UNOWNED`) with tests and a template paragraph; it is the same gap as end-to-end-user-14, carried at fix round 1 as not cheap |
| end-to-end-user-r2-4 | minor | generated AGENTS.md and README (`asm/matchings`) | open | Decompiled functions' assembly moves to `asm/matchings/<module>/` for the objdiff target, which works (objdiff scored the function at 100%) but is not documented; a template sentence and a scaffold golden update |
| end-to-end-user-r2-5 | minor | printer readability | open | A libgcc `_call_via_rN`'s trailing nop pad prints as bare `.inst.n 0x46C0`; it assembles to the same bytes. A comment or `mov r8, r8` changes the printer and every affected golden and tree digest |
| end-to-end-user-r2-6 | minor | `runs_at` module label naming | open | Default labels in a `runs_at` module are named by ROM load address while the header and `adr` comments use run addresses. Renaming by run address changes the printer's naming convention, goldens and `g6.expected-bytes`' objects, a convention change for a decision, not a minor fix |
| end-to-end-user-r2-7 | minor | generated AGENTS.md examples | open | The TOML examples carry klonoa's fixed addresses in every project and are not marked illustrative; filling them from the project's model needs new template variables |

Also open: the five owner questions below (O1 re-measuring `speed.json`, O2 shipping built signature files, O3 the
fresh-family pair to seal, O4 a Linux runner, O5 `g3.speed-budget`'s scope), the items carried from fix rounds 1 and
2 (roadmap.md "Carried past phase 6"), and the Linux CI jobs of phase 6, which have never run (GitHub Actions is
refused; their checks ran locally on macOS only, D103).

## Owner questions

All five are open at this report.

- **O1. Re-measure `bench/baseline/speed.json` at the current tuning?** (gates-2, gates-3, clean-clone-11, gates-r1-1)
  Until fix round 2 sa2 ran at 94 to 101% of its limit depending on machine load (the review of fix round 1 measured
  100.9% in a plain run, which failed the closing list); fix round 2's result-neutral speed changes (D107 a) bring it
  to about 81%. fe7j and pokeemerald have limits about ten and two times what they measure. Re-measuring gives every
  ROM a limit 1.5 times today's time.
- **O5. May `g3.speed-budget` judge only its own budgets?** (gates-r1-2, D107 b) It fails whenever `bench speed --json`
  exits 1, which happens when any ROM exceeds the `g2.speed` limit, so one slow sa2 run fails both speed gates while
  the 3 s, 10 s and 15 s budgets are met with a wide margin. The fix is a gate edit (read the JSON whatever the exit
  code, or a `bench speed` flag that skips the ratchet's exit).
- **O2. Ship built signature files?** (clean-clone-2, docs-and-plan-2; D40, architecture §12 item 1) Until then a user
  names libraries only by building them from the reference decomps.
- **O3. Which fresh-family pair to seal before release 1?** (gates-1) Kirby & the Amazing Mirror or Pokémon Pinball,
  from the reserve pool, once its build reproduces its SHA-1.
- **O4. A Linux runner for phase 6's CI** (docs-and-plan-6, gates-8): restore Actions billing, or name a host.

## Reproducing the verification

In a fresh clone of `git@github.com:macabeus/romlift.git` at `main`, with Node 24, GNU binutils for ARM, `make`, `git`
and a C compiler:

```sh
export ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler      # the benchmark checkouts (docs/benchmark-roms.md)
export ROMLIFT_POC=$ROMLIFT_BENCH_ROOT/romlift-poc                 # read-only
echo '{ "landed": 6 }' | cmp - test/gates/phase.json               # the gates' phase
mkdir -p bench/.local && cp -R /path/to/main-checkout/bench/.local/agbcc bench/.local/agbcc
cargo build --release --manifest-path "$ROMLIFT_BENCH_ROOT/objdiff/Cargo.toml" -p objdiff-cli \
  --target-dir "$PWD/bench/.local/objdiff-target"                  # objdiff-cli 3.7.2, or set ROMLIFT_OBJDIFF
```

Then the phase-6 closing list (phase-6.md "The closing gate"), in this order, each command waited for:

```sh
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

About two hours in all (fix round 2's run: 19:30 to 21:15). Expect every command to exit 0, `npm test` 2,885 pass with
objdiff-cli reachable, `test:local` 122 of 122, the real tier 29 pass and 1 historical, the ci tier 46 of 46, and
`bench run --scaffold` to rewrite `bench/results.json` with the rows above and only timings and peak RSS changed. The
user path, in bash (not zsh, clean-clone-r2-1), from an empty directory holding only a ROM:

```sh
export ROMLIFT_CLI="node /path/to/romlift/dist/cli/main.js"
$ROMLIFT_CLI init baserom.gba
git init && ./setup.sh && make                                      # klonoa: akle.gba: OK
```

## Fix round 1

The first pass reviewed `main` at `0ccc5a0` (phase 6 landed, tag `phase-6`) through the five lenses. It raised 15
majors and 32 minors and no blocker. Fix round 1 (branch `final-review-1`, decision D106) fixed every major in code or
in the documents, as each finding's own fix proposed, and the cheap minors; the rest are carried past phase 6 with a
reason (roadmap.md "Carried past phase 6"), and four need the owner ("Owner questions", above).

Dispositions: **fixed** (the finding's fix, or an equivalent, is in the branch), **partly fixed** (the part named is
fixed, the rest carried), **carried** (recorded and left for later, with the reason), **no change** (the finding asks
for none, or the fix is a record already made).

### Majors

| Finding | Disposition | What was done |
| --- | --- | --- |
| clean-clone-1, end-to-end-user-1, docs-and-plan-7 (the README's first command fails: romlift is not on npm) | fixed | README opens with "Try it before it is published": `npm ci && npm run build`, `node <checkout>/dist/cli/main.js init baserom.gba`, `ROMLIFT_CLI="node <checkout>/dist/cli/main.js" ./setup.sh && make`; the `npx` line is marked as the post-publication form. `setup.sh` prints the `ROMLIFT_CLI` remedy when `npm ci`/`npm install` fails (`npm_failed`). AGENTS.md's `npm run build` row and `ROMLIFT_CLI` variable say the same. Verified: init from `dist/`, `setup.sh` with `ROMLIFT_CLI` and `make` on klonoa end at `akle.gba: OK` |
| clean-clone-2, end-to-end-user-2, docs-and-plan-2 (signatures cannot work from a clone or the package) | fixed | The package no longer ships `signatures/specs/` (a spec names bench datasets it cannot reach); `W_SIGNATURES_ABSENT` says files are not shipped (D40) and that building needs a source checkout with the reference decomp checkouts under `ROMLIFT_BENCH_ROOT`; an unreadable reference names its checkout and the bench root instead of a bare ENOENT, and an unknown dataset says a spec is built in a source checkout; `signatures --help` says so. README intro, phase-6.md "Known limitations" and architecture §1 state it; shipping built files stays the owner's (architecture §12 item 1) |
| clean-clone-3 (`bench run` silently drops the signatures family) | fixed | `bench run` writing the artifact refuses, naming the build loop, when no signature file is built and the committed artifact carries the signatures family; with `--json` it logs that the family does not run. AGENTS.md's `bench run` row and the new real-tier prerequisites row say to build them first. Unit test in `test/unit/bench/run.test.ts` |
| gates-1 (g2.held-out passes only with both family conditions waived) | fixed (wording), carried (the fresh-family seal) | plan.md's milestone table, diagram and revision note now read "two sealed ROMs pass (family conditions waived, D60/D61)"; README says release 1 cannot claim generality. Sealing and running a fresh-family pair (Kirby & the Amazing Mirror, Pokémon Pinball) is carried to before release 1: it needs new checkouts to build to their SHA-1s first |
| gates-2 (sa2 at 99.1% of its g2.speed limit) | carried, owner question O1 | Measured: alternating same-process medians of discover on sa2 at `b0759e7` (phase 2's close) and at this round's tree are 789 against 787 ms and 722 against 747 ms, so the analysis did not slow down; `bench speed --only sa2` gave 782.4 of 783.1 ms at load average 7 to 10 (another agent's runs). The margin is load, and the 1.5x limit rests on a 17 October baseline. Re-measuring `speed.json` is the owner's (AGENTS.md: the phase lead writes it; the finding asks the owner). phase-6.md records the 99.1% and 99.9% measurements |
| end-to-end-user-3 (`bx pc` veneers become 4-byte C modules) | fixed | `asmOnlyReasons` gives a Thumb function with a `bx pc` (`walk.bx-pc-veneer`) the reason `mode-switch`, so a run of veneers, their nop orphans and their ARM code is one `asm_<ADDR>` module. klonoa with signatures: 15 modules (the thunks one `asm_08051BA4` module), `verify --assemble --link` to the SHA-1. The analysis is unchanged (D106 g); two fixture goldens move one module start. The finding's "one function whose Thumb entry carries the ARM body" is rejected for this round: it changes the analysis, the model and the printer for a layout the module fix already gives |
| architecture-1 (verify composed in the CLI, against D36) | fixed | `core/workflow/verify.ts` (`toolchainPlan`, `verifyReport`, `notRunOutcome`) and `shell/project/verify-run.ts` (`runToolchainChecks`, exported from `romlift/node`); `cli/commands/verify.ts` only parses and prints. The checker's CLI row allows values from the reading, formatting, codec and doctor api barrels only (types from any), with a mutation case. The bench's and the gates' own compositions are left as they are (they now could call the runner) |
| docs-and-plan-1 (the plan's `include/global.h`, `include/gba/*.h` missing) | fixed | Templates `include/global.h`, `include/gba/types.h`, `include/gba/io_reg.h` (types, `TRUE`/`FALSE`/`NULL`, the memory map and I/O registers), in `MANIFEST.json`, the scaffold golden and the project README and AGENTS.md; compiled with agbcc; written once, the user's (D106 d) |
| docs-and-plan-3 (plan.md's gates as originally written) | fixed | plan.md's revision note, milestone table, diagram and Readability row annotated with D60, D61, D102 and D104 b |
| docs-and-plan-4 (`[signatures] libraries` does nothing) | fixed | `filesFor` limits the files `analyze --update` uses to the listed libraries; documented in architecture §6.5 and the project AGENTS.md; unit test (D106 c) |
| docs-and-plan-5 (Mizuchi config "on request" with no mechanism) | fixed (recorded) | D106 e: asmlift's block always written (16 October decision), Mizuchi deferred with no flag, Transmuter open (§12 item 8); plan.md annotated |
| docs-and-plan-6, gates-8 (phase 6 landed without its Linux checks) | carried | No Linux host was used: GitHub Actions is still refused, and a Docker VM on the shared machine would load the timing gates other agents were running. Recorded as a known limitation (phase-6.md), in README's status and in roadmap.md "Carried past phase 6", to run on `main` once a Linux runner is available |

### Minors

| Finding | Disposition | What was done, or why not |
| --- | --- | --- |
| clean-clone-4 (objdiff build hardcodes the main checkout) | fixed | docs/benchmark-roms.md builds into `"$PWD/bench/.local/objdiff-target"` from the checkout; AGENTS.md lists the objdiff-cli build and the signature build as real-tier prerequisites |
| clean-clone-5, end-to-end-user-13 (W_LOCKFILE_DEFERRED promises what setup.sh will not do) | fixed | With `ROMLIFT_CLI` set, init runs no npm and says so; the message now says the lock is written on the first run that installs romlift with npm, none while `ROMLIFT_CLI` is set; `setup.sh` says the lock stays unwritten |
| clean-clone-6, end-to-end-user-16 (signature warnings users cannot act on) | fixed | `W_SIGNATURE_AMBIGUOUS` is one line per version, saying when the version placed nothing (likely not linked); a version all of whose placements another version of its library took is not reported (`W_SIGNATURE_DROPPED` stays for real conflicts). Unit tests |
| clean-clone-7 (Makefile says `npx romlift generate`) | fixed | The Makefile's stops name `$(ROMLIFT_CLI)` when set, else `npx romlift` with the `ROMLIFT_CLI` remedy |
| clean-clone-8, docs-and-plan-8 (README index stale) | fixed | D1–D106, Q1–Q16, phase 6's landing in the past tense with run 7, `7a5342f`, the tag and the macOS-only CI |
| clean-clone-9 (git init before or after setup.sh) | fixed | The project README's step 1: `git init` first, so `setup.sh` registers `tools/agbcc` as a submodule |
| clean-clone-10 ("failed under the mutant" reads as a failure) | fixed | Reworded "mutant killed (expected) by: …" |
| clean-clone-11 (g2.speed margins thin) | no change | The finding asks for none; recorded with gates-2 |
| gates-3 (fe7j and pokeemerald baselines predate a 7x speed-up) | carried, owner question O1 | Re-measuring `speed.json` is the owner's, with gates-2 |
| gates-4 (objdiff ceilings at the measured counts) | fixed (record), carried (klonoa's object) | phase-6.md "What the phase delivered" describes `g6.objdiff` as a no-regression ceiling with 130 of 485 klonoa functions unjudged; README too. The objdiff-cli workaround for `src/code_0804B254.o` is carried |
| gates-5 (tmc's signature floor is romlift's own output) | fixed (record) | phase-6.md "Known limitations": the floor is the closing round's measurement, 39 of 94 m4a members are not placed on tmc and why was not investigated, names and sizes are not judged there |
| gates-6 (tmc held to weaker phase-2 gates) | no change | Already recorded (D61); no summary calls tmc a ROM that passes every gate |
| gates-7 (a plain clone skips the objdiff-cli test) | fixed | phase-6.md's closing gate and roadmap.md "Phase 6 exit" state the environment: the pinned objdiff-cli as `ROMLIFT_OBJDIFF` or a checkout build, without which `npm test` skips one test |
| end-to-end-user-4 (no minimum objdiff version) | fixed | The project README and AGENTS.md: objdiff 3.7.2 or later (older ones cannot load the targets) |
| end-to-end-user-5 (`--rom` silently ignores the project) | fixed (the warning) | `verify`, `model` and `explain --rom` inside a project warn `W_PROJECT_CONFIG_IGNORED`; a `--discover` flag is not added (an interface change for release 1) |
| end-to-end-user-6 (missing ROM: raw ENOENT, silent `generate --rom`) | fixed | A project without its ROM: E_IO_READ naming the remedies; `generate --rom` while it is missing warns `W_PROJECT_ROM_ABSENT`; the Makefile stops with a message while `baserom.gba` is missing |
| end-to-end-user-7 (`rename` cannot rename a default data label) | fixed (documented) | The help and the project AGENTS.md: add a `[symbols]` entry under the default name first. Adding the entry automatically is carried |
| end-to-end-user-8 (overlapping `[symbols]` accepted silently) | carried | A new model diagnostic and its tests; not cheap |
| end-to-end-user-9 (decimal symbol addends) | carried | Changes every tree with addends and the committed objdiff counts; not cheap |
| end-to-end-user-10 (`explain` hard to use) | carried | Name resolution, scoping by default and `--all` are an interface change |
| end-to-end-user-11, docs-and-plan-12 (generate help omits expected/ and objdiff.json) | fixed | `generate --help`, AGENTS.md's row |
| end-to-end-user-12 (no `--version`) | fixed | `romlift --version` (and `-V`) prints the package version, exit 0; `git describe` is not added |
| end-to-end-user-14 (a listed entry that cuts a function) | carried | A new warning and its tests; not cheap |
| end-to-end-user-15 (no recipe for library modules after a late signature build) | fixed (documented) | The project AGENTS.md gives the manual `[[modules]]` steps; a refused patch carrying the blocks is carried |
| architecture-2 (§9.1 code table stale) | fixed | Regenerated from the `codes.ts` files (`W_PROFILE_MISFIT` and `W_UNDECODED_GAP` noted as not defined), and a unit test fails when the table and the defined codes differ |
| architecture-3 (Map iteration rule scope) | fixed (doc) | §4.4 states the five enforced scopes and the convention elsewhere (D106 f); widening the checker is carried |
| architecture-4 (hex formatting outside hex.ts) | fixed | `hexSize` in `foundation/util/hex.ts`, the ten sites routed through it (emitted text unchanged), and the checker refuses `.toString(16)` outside the hex helpers, the instruction formatter and the corpus, with a mutation case |
| architecture-5 (catch-all reads in the shell) | partly fixed | `readTextIfPresent`: the corpus inputs now stop on an unreadable file; the lock keeps reading an unreadable lock as untakeable (its tested contract); the `disk-state.ts` sites are recorded exceptions, carried |
| architecture-6 (duplicated helpers) | partly fixed | `codeEnd` in `analysis/types.ts`, the placeholder helpers from `scaffold/vars.ts`; the four `isRecord` copies are carried |
| architecture-7 (fragment includes lexical) | fixed (recorded) | D106 i; phase-6.md and roadmap.md say the cpp-exact resolution is for headers only |
| architecture-8 (`seed.ram-copy` size and `SpecId`) | carried | A refactor of a tuned rule, with parity risk; not cheap |
| architecture-9 (driver value-import cycle) | carried | A refactor of the driver; not cheap |
| architecture-10 (policy in shell signatures build) | carried | Moving the refusals into a core workflow; not cheap |
| architecture-11 (long reconciler messages) | carried | Splitting every template into statement and hint changes many goldens |
| architecture-12 (explain's JSON encoder in the CLI) | carried | Moving it changes the `explain --json` contract's owner; not cheap |
| architecture-13 (dead exports) | partly fixed | `resolverOver` and the unused `ParseElf`, `ParseGnuMap` and `CanonicalJson` types removed; `emptyItemTable` kept for its tests; narrowing the 89 file-private exports carried |
| architecture-14 (§2 tree omits files) | fixed | §2 lists foundation/isa's building blocks, `insn-lookup.ts`, the driver's `rules.ts`, `seeds.ts`, `listed-extent.ts`, `rename-patch.ts`, `print/chunk.ts`, `rename-project.ts`, `temp-dir.ts` and this round's files |
| architecture-15 (doc contradictions) | fixed | The `core/workflow` row names `diagnostic-codes.ts`'s exception; the `diagnostic-codes.ts` row lists `foundation/diagnostics`; `src/index.md` drops `evidence`; `src/cli/index.md` lists the phase-6 commands and `--version` |
| docs-and-plan-9 (TOML schema docs) | fixed | §6.5 shows `libraries`, `type = "bytes"`, `mode` and a key table with `generated`; `data_start` places `.rodata` only |
| docs-and-plan-10 (§11 Git rules) | fixed | §11 states the executed rules (`phase-<n>`, flat component branches, one attribution line) |
| docs-and-plan-11 (plan's decisions checklist) | fixed | The own-repo item is checked (D1), the open items point to §12, and §12 items 5 to 9 state their built defaults |
| docs-and-plan-13 (AGENTS pointer-flood, sa1) | fixed | AGENTS.md's test:local row describes `pointer-flood`; docs/benchmark-roms.md lists sa1 (path, SHA-1 `eb00f101…`, commit `fdd89564`, objdiff evaluation only) |
| docs-and-plan-14 (src/index.md lists evidence) | fixed | Replaced with proposals, reconcile, scaffold, and the phase 4, 6 and final-review exports |
| docs-and-plan-15 ("packs" in plan.md) | fixed | "signatures" / "the m4a signatures"; the quoted history of the rejected word stays |

### Gate results of fix round 1

The phase-6 closing list (phase-6.md "The closing gate", which runs every gate of phases 1 to 6 on both tiers) ran in
a fresh worktree (`romlift-wt/final-review-1-closing`) at `31f13ce` with `test/gates/phase.json` at `{ "landed": 6 }`,
`ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC` set, `bench/.local/poc` and `bench/.local/agbcc` copied in and objdiff-cli 3.7.2
found as the main checkout's build; 26 October 2026, 14:15 to 16:03, every command waited for.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 23 tests pass (two new mutation cases) |
| `npm test` | 0 | 2,883 tests, 2,883 pass, 0 skipped (41 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree |
| signature build loop | 0 | six files (19 s) |
| `npm run build && npm pack` | 0 | `romlift-0.0.0.tgz`, 769 files, no `signatures/` file |
| packed-signature check | 0 | |
| `npm run export-poc -- --mode raw`, `scored`, `parity`, `queries` | 0 | (15, 246, 77, 52 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 1, then 0 | 120 of 122: `padding-orphans` on fe7j and klonoa counted one more zero pad kept at a `c` module's end each, the pad before a `bx pc` stub that now leaves the C module (D106 g); the count was updated (`9d3f70a`, test/local is outside the source digest) and the rerun of the whole `test:local` at `9d3f70a` gives 122 of 122 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every input and the toolchain ok |
| `npm run corpus` | 0 | ok |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build to the SHA-1 on all six; both sealed ROMs pass with their init builds at the SHA-1; objdiff differences as run 7 (fe7j 9, 12, 55; klonoa 4, 1, 130 tool; pokeemerald 42, 8, 2, 144, 2,608; sa2 2,659, 5, 127; sa3 1,651, 4, 3, 81; tmc 11, 5, 34, 315); signatures fe7j 134, klonoa 120, pokeemerald 377, sa2 147, sa3 189, tmc 68 placements, 0 wrong; wrote `bench/results.json` (260 s) |
| `npm run bench -- regression` | 0 | no regression |
| `npm run bench -- gates --require 6 --tier real` | 0 | 30 records: 29 pass, 1 historical (`g2.poc-parity`), 0 fail. `g2.speed` calibration 0.953: fe7j 1,226 of 12,596 ms, klonoa 249 of 304, pokeemerald 2,277 of 4,187, sa2 737 of 777 (94.9%), sa3 1,097 of 1,481, tmc 1,442 of 1,771. `g2.held-out` passes with both family conditions waived (D60, D61). `g6.objdiff` every ROM at its ceiling (fe7j 7, klonoa 1 with 130 uncompared, pokeemerald 12, sa2 1, sa3 4, tmc 25). `g4.toml-mutations` 269 legal edits, 239 illegal, 60 ROMs. `g4.e2e-real` all six from the source tree and the installed tarball, both sealed ROMs. `g6.expected-bytes` 432 modules on 61 targets (3,226 s) |
| `npm run bench -- gates --require 6 --tier ci` | 0 | 46 gates, 46 pass, 0 fail; `g1.provenance` (source digest `673ca046…`), `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (769 files), `g3.large-rom` (init 1,160.6 MiB, generate 1,149.0 MiB peak RSS under the 1,536 MiB budget) (1,770 s) |
| `npm run bench -- provenance` | 0 | source digest `673ca046…` ok; 30 real-tier gates pass or are historical; families live; 6 rows; no sealed row |

Every gate of phases 1 to 6 passes on both tiers. `bench/results.json` is committed as this run's artifact. The Linux
CI jobs were not run (docs-and-plan-6, carried).

## Fix round 2

A second review pass over main at `a1a4328` (fix round 1 merged) followed a clean clone and a new user again and re-ran
the closing list in a fresh clone. It raised 1 blocker, 1 major and 12 minors. Fix round 2 (branch `final-review-2`,
decision D107) fixed the blocker and the major in code, the cheap minors, and carried or recorded the rest (roadmap.md
"Carried past phase 6").

| Finding | Severity | Disposition | What was done, or why not |
| --- | --- | --- | --- |
| gates-r1-1 (the closing list fails on sa2's `g2.speed` limit) | blocker | fixed | Result-neutral speed changes to the analysis, from a profile of sa2 (D107 a): `insnAligned` by mask instead of `%`, `factFrom`'s code spans merged without an object per instruction, `claim()` writing instruction claims without building a `ClaimEdit`, `claimRuns` scanning equal claims a word at a time. The analysis digests of all six tuning ROMs are unchanged (fe7j `a1e91da5…`, klonoa `518d9572…`, pokeemerald `698343b9…`, sa2 `bfa0a805…`, sa3 `9c0fb964…`, tmc `5c747e55…`, before and after). `bench speed --only sa2`: 728.3 of 746.8 ms (97.5%) before, 610.0 of 751.0 and 624.9 of 769.4 ms (81%) after. No gate, threshold or `speed.json` changed; re-measuring the baseline stays the owner's (O1). The closing list ran again (below) |
| clean-clone-r1-1 (`bench run` without the PoC dumps writes a degraded artifact) | major | fixed | `bench run` writing the artifact is refused while a committed row's `poc.source` is `dump` (tmc) and its `bench/.local/poc/<rom>/scored.json` is missing, naming the file and `npm run export-poc -- --mode scored`; `--json` runs are not refused (unit test in `test/unit/bench/run.test.ts`). AGENTS.md's real-tier prerequisites and `bench run` rows name the four `export-poc` modes and the gates that need them |
| gates-r1-2 (`g3.speed-budget` fails on `g2.speed`'s criterion) | minor | carried, owner question O5 | The gate throws on `bench speed --json`'s exit 1, which `test/unit/bench/speed.test.ts` pins and the gate's header states as its contract; changing either is a gate change (D73 c). gates-r1-1's fix removes the trigger for now (D107 b) |
| gates-r1-3 (D106 g lost `g4.toml-mutations` coverage) | minor | fixed (record), carried (the fixture) | D107 e records it: the bx-pc-veneer and adr-label-and-data fixtures hold no `c` module `move-start` or `split-module` can edit, so the real tier's legal edits went from 273 (move-start 48, split-module 48) to 269 (46, 46) and the ci tier's from 243 to 239 (40, 40). A `c` module after the bx-pc-veneer fixture's veneers is a fixture rebuild, carried |
| gates-r1-4 (g2.held-out passes only with the family conditions waived) | minor | no change | The finding asks for none; the documents say it (plan.md, README, roadmap, O3). A fresh-family pair is sealed before release 1 |
| clean-clone-r1-2 (the generated CI workflow fails at `npm install` while romlift is unpublished) | minor | fixed | The project README's pre-release paragraph says `.github/workflows/build.yml`'s `./setup.sh` fails at the npm install once `BASEROM_URL` is set, and how to build there (a romlift checkout and `ROMLIFT_CLI`) or to leave the secret unset; scaffold golden updated |
| clean-clone-r1-3 (environment variables missing from AGENTS.md) | minor | fixed | `ROMLIFT_SIGNATURES`, `ROMLIFT_AGBCC` and `ROMLIFT_AGBCC_COMMIT` rows in the Environment table; the README's signatures paragraph names `ROMLIFT_SIGNATURES` |
| clean-clone-r1-4 (a stale count and a loop that hides a failure) | minor | fixed | phase-6.md's plain-clone count reads 2,884 pass, 1 skipped (this round's 2,885 tests); the README's loop uses `\|\| exit 1` |
| end-to-end-user-r1-1 (ARM `adr r0, X + 1` printed raw) | minor | carried (recorded) | D107 f corrects D69 d: `adr r0, <label> + 1` round-trips through GNU as. Printing it needs a `label + 1` form of the ISA's `target` operand (format and parse), `adrResolverFor` taking a label at target − 1, a local label where only a Thumb function label lies (D72 c's interworking offset), the text-layout check and the corpus: a change to the foundation's instruction syntax for two klonoa instructions, not cheap |
| end-to-end-user-r1-2 (`rename gUnk_…` gives no remedy) | minor | fixed | `E_RENAME_UNKNOWN` of a default name of the project's model appends ``…is a default name of the project's model at 0x08051C76: add `0x08051C76 = "gUnk_08051C76"` to [symbols] (or to [functions] for a function) first, then rename it``; unit test |
| end-to-end-user-r1-3 (init still calls the npm registry in the README flow) | minor | fixed | The README exports `ROMLIFT_CLI` before `$ROMLIFT_CLI init baserom.gba`, so init skips the npm lock step; AGENTS.md's `npm run build` row says the same |
| end-to-end-user-r1-4 (`W_SIGNATURE_POINTERS` of a version that lost) | minor | fixed | `resolvePlacements` drops the warning of a version that kept no placement while another version of its library kept some (D107 d); unit test. `signatures` on klonoa: 2 diagnostics (librfu's ambiguous line, m4aSoundInit's constant), no m4a@2004 line |
| end-to-end-user-r1-5 (`W_LIBRARY_MODULE_DROPPED` names two ranges) | minor | fixed | The message and the diagnostic's span name the range the module border check read, and say when it adds the region's trailing pad; unit test |
| end-to-end-user-r1-6 (`model` gives asm and data modules a compiler) | minor | fixed (text), no change (`--json`) | The text table prints `-` for an asm or data module; the `--json` header's `compiler` is the model's field in the public `romlift/model-json@1` schema, left as it is |

### Gate results of fix round 2

The phase-6 closing list ran in a fresh worktree (`romlift-wt/final-review-2-closing`) at `b98b2e6` (the round's code;
the later commits change documents only, outside the source digest) with `test/gates/phase.json` at `{ "landed": 6 }`,
`ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC` set, `bench/.local/poc` and `bench/.local/agbcc` copied in and objdiff-cli 3.7.2
found as the main checkout's build; 26 October 2026, 19:30 to 21:15, every command waited for, load average 2 to 4
after the first minutes (14 to 17 while `npm test` and the signature builds ran).

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | |
| `npm test` | 0 | 2,885 tests, 2,885 pass, 0 skipped (36 s) |
| `npm run fixtures -- check` | 0 | 54 of 54 fixtures agree |
| signature build loop | 0 | six files (17 s) |
| `npm run build && npm pack` | 0 | |
| packed-signature check | 0 | |
| `npm run export-poc -- --mode raw`, `scored`, `parity`, `queries` | 0 | (13, 241, 76, 49 s) |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 122 tests, 122 pass, 0 skipped (673 s) |
| `npm run bench -- doctor-real` | 0 | |
| `npm run corpus` | 0 | ok |
| `npm run bench -- run --scaffold` | 0 | six rows: raw and readable link to the SHA-1, the init build to the SHA-1 on all six; both sealed ROMs pass with their init builds at the SHA-1; rows as fix round 1 (tmc tp 8,631, PoC 8,582); objdiff differences as fix round 1; signatures fe7j 134, klonoa 120, pokeemerald 377, sa2 147, sa3 189, tmc 68 placements, 0 wrong; memory family `init` 1,138.7 MiB, `generate` 1,095.8 MiB peak RSS; wrote `bench/results.json` (241 s) |
| `npm run bench -- regression` | 0 | no regression |
| `npm run bench -- gates --require 6 --tier real` | 0 | 30 records: 29 pass, 1 historical (`g2.poc-parity`), 0 fail. `g2.speed` calibration 0.932: fe7j 1,050 of 12,314 ms, klonoa 224 of 297, pokeemerald 2,062 of 4,093, **sa2 619 of 760 (81.4%)**, sa3 1,008 of 1,448, tmc 1,311 of 1,731. `g3.speed-budget` calibration 0.932: sa2 analysis 602 of 2,795 ms, pokeemerald `generate` 7,473 of 9,318 ms, `init` 9,333 of 13,977 ms. `g2.held-out` passes with both family conditions waived. `g6.objdiff` every ROM at its ceiling. `g4.toml-mutations` 269 legal edits (move-start 46, rename 60, delete-function 57, add-override 60, split-module 46), 239 illegal, 60 ROMs. `g6.expected-bytes` 432 modules on 61 targets (3,062 s) |
| `npm run bench -- gates --require 6 --tier ci` | 0 | 46 gates, 46 pass, 0 fail; `g1.provenance` (source digest `641f0167…`), `g4.cli-contract` (10 commands, 17 `--json` runs), `g4.packed-e2e` (769 files), `g4.toml-mutations` 239 legal edits (move-start 40, split-module 40), `g3.large-rom` (init 1,163.3 MiB, generate 1,274.0 MiB peak RSS under the 1,536 MiB budget) (1,806 s) |
| `npm run bench -- provenance` | 0 | source digest `641f0167…` ok; 30 real-tier gates pass or are historical; families live; 6 rows; no sealed row |

Every gate of phases 1 to 6 passes on both tiers. `bench/results.json` is committed as this run's artifact. The Linux
CI jobs were not run (docs-and-plan-6, carried).

