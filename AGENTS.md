# AGENTS.md

How to work in the romlift repository. This file is the agent instructions of the repository; there is
no `CLAUDE.md` and none is ever created.

romlift turns a GBA ROM into a matching-decompilation project. Its design is fixed by
[docs/architecture.md](docs/architecture.md) (definitive), [docs/decisions.md](docs/decisions.md) (every
contestable choice, cited as `D<n>`) and [docs/roadmap.md](docs/roadmap.md) (build order, file ownership
and the exit commands of each phase). Follow them; a decision changes only through a commit to
`decisions.md` that says what replaced it and why.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | install exactly the lock file (`npm install` only when changing dependencies) |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `test/` and `bench/` |
| `npm run lint` | the architecture checker alone: `test/architecture.test.ts` and its mutation test (D5, D54 j); `npm test` runs both too |
| `npm test` | `test/*.test.ts` and `test/{unit,golden,mutation}/**`; needs no ROM |
| `npm run test:local` | `test/local/**`; needs `ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC` (below): the PoC decoder differential, `epoch-reuse` against `epoch` on the tuning ROMs, and the committed PoC-parity evidence (`poc-parity`, `poc-lockstep`); from phase 3 `emission-real` (both printers' trees of the six tuning ROMs pass the self-checks and link to their SHA-1s), `poc-raw-printer` (needs the dumps of `export-poc --mode raw`; roadmap 3.B's gate, D65 l, accepted by the owner, D68 d), `large-rom-bin` (the bin's commands on the 32 MiB synthetic ROM under its 1,024 MiB cap, D70 b, D71 e, D72; about fifteen minutes), `objdiff` (needs objdiff-cli, `ROMLIFT_OBJDIFF` below) and `config-mutations` (klonoa's config with a mode-flipped listed function, whose tree must link, and with module names the model refuses); from phase 4 `listed-invalid` (init's config then the confirm run raises no `W_LISTED_INVALID` on the six tuning ROMs), `padding-orphans` (no padding-only orphan file precedes a function; the zero pads kept at a `c` module's end after a function are exactly the counts the owner kept, Q8 of phase-4.md, D79 a) `c-stub-agbcc` (every C stub of two fixtures and klonoa compiled with agbcc and old_agbcc equals the stub assembly the checks read) and, from fix round 3, `decompiled-c` (on klonoa, a renamed NONMATCHING block and a `c` module split behind a decompiled function, through `generate`, `setup.sh` and `make` with agbcc, to the SHA-1; D78 a, b; from fix round 5 also the `#ifndef NONMATCHING do { … } while (0);` idiom, then a fresh clone through `./setup.sh`, and a `c` module renamed with its source moved by hand, D81 a; from fix round 6 a split at a decompiled function whose C is pasted alone into the new module's file, and a Git clone that pulls a TOML edit, whose `make` stops until `./setup.sh` or `romlift generate` regenerates, D82 a, b; from fix round 7 three `INCLUDE_ASM` lines moved into an `#include`d `src/part.c`, kept by `generate`, a TOML rename of one refused naming the fragment until it is fixed there, and a `decomp.yaml` naming another config refused while `make` still builds, D83 a, b) and `c-scan-corpus` (fix round 6: the C scanner over every `src/**/*.c` of the six tuning checkouts, 1,729 files, splits all but sa2's two `ASM_FUNC` shapes, D81 a, D82 c) |
| `npm run bench -- <command>` | the benchmark harness (architecture §8.5), from phase 1 |
| `npm run bench -- gates --require <n> --tier ci\|real` | runs the gate tests of phase ≤ n and prints every verdict (D29) |
| `npm run bench -- doctor-real\|run\|poc-check\|dataset-check\|provenance\|stale-check` | the real-tier inputs; rescoring into `bench/results.json` (`run [--only <rom>] [--json] [--disable <rule>...] [--cpu-prof]`; a sealed dataset prints counts only); the PoC baseline; datasets against ELFs; the artifact's provenance; whether it is current |
| `npm run bench -- run --scaffold [--write-readability-floor]` | from phase 3: each tuning ROM's tree emitted with both printers (readable and raw), linked to its SHA-1, with the readability shares and the objdiff family (architecture §8.4); from phase 4 also each ROM built as a user builds it, in a fresh directory holding only the ROM: `init`, `./setup.sh` (agbcc from the cache `bench/.local/agbcc`, built once at `templates/agbcc.json`'s pin) and `make`, to the ROM's SHA-1 (the row's `scaffold.init`); `--write-readability-floor` writes `bench/baseline/readability.json`, the first committed readability shares that `g3.readability` keeps as floors, and only the phase lead passes it (D62 a) |
| `npm run bench -- speed [--only <rom>] [--json] [--write-baseline]` | serial median CPU time of the analysis per tuning ROM (nine runs since D76 b; the calibration and the emission timings five) against `bench/baseline/speed.json`, calibrated (`g2.speed`); from phase 3 also `generateCpuMs` (generate over a config built beforehand, then the write of its tree into a fresh temporary directory) and `initCpuMs` (discover, `configFromDiscover`, generate and the write) per tuning ROM, which `g3.speed-budget` holds to 10 s and 15 s on pokeemerald (calibrated); a run whose check pass fails writes nothing and gets no time; only the phase lead writes the baseline (analysis only) |
| `node --conditions=source bench/tools/objdiff-classes.ts [--only <rom>] [--json]` | the objdiff family of `run --scaffold` on each tuning ROM, every difference sorted into the classes of phase-3.md Q1 (`bench/src/objdiff-classes.ts`), with the totals D34 gates (`g5.objdiff`, which the owner moved to phase 5, D68 a, and then into phase 6 when he skipped phase 5, D76 g) and what Q1's option (b) would have gated; writes nothing |
| `npm run bench -- large-rom [--json] [--rom <path>]` | `g3.large-rom`: the deterministic 32 MiB synthetic ROM (or the ROM `--rom` names, how the tuning ROMs are measured), then `init` and `generate` each in its own child process under the `romlift` bin's heap cap (`--max-old-space-size=1024`, D68 b, D72); prints `{schema: 'romlift/bench-large-rom@1', romBytes, sha1, runs: [{command, exitCode, maxRssMiB, maxOldSpaceSizeMiB, peakLiveHeapMiB, treeDigest?}]}` last (the gate requires exit 0 under the cap and `maxRssMiB` < 1,536 for both, D72 b; `peakLiveHeapMiB`, the live heap after a full GC, is recorded, D70 d). The command spawns `node --conditions=source bench/src/large-rom.ts [--json]`, which also runs on its own |
| `npm run bench -- large-rom --bin [--json] [--rom <path>]` | the `romlift` bin's own commands on the same ROM (`analyze`, `analyze --json`, `explain`, `explain --json`, `model`, `model --json`, `verify --json`, `verify --assemble`, `verify --assemble --json`, `verify --assemble --link --json`, `verify --printer raw --assemble --json`, `verify --printer raw --link --json`), each its own process from source with the Node options of `src/cli/main.ts`'s launcher line, with its exit code, peak RSS, peak live heap (`bench/src/rss-probe.ts`) and summary (`romlift/bench-large-rom-bin@1`); exit 0 when every run completes; `test/local/large-rom-bin.test.ts` requires it on the synthetic ROM (D70 b, D71 e), no gate does; from phase 4 it also runs `init --json` (in a directory holding only the ROM as `baserom.gba`) and `generate --json` in the project init wrote, fourteen forms in all, and on the doubled pokeemerald ROM of phase-3 Q7 every form exits 0 since the readable `adr` fix (phase-4.md) |
| `npm run bench -- ablate <rule> [--tier synthetic\|real]` | re-runs with one rule disabled and prints where it was decisive and what moves |
| `npm run bench -- explain <rom> <addr>` | what the discover run decided about one address of a tuning ROM or a fixture |
| `npm run bench -- adopt <rom>` | seeds a new tuning dataset's lists as `unreviewed` placeholders to classify (refuses a sealed dataset) |
| `npm run corpus` | generates the `as` round-trip corpus into `bench/.local/corpus/` and assembles it with the system `arm-none-eabi-as` (romlift's `runCorpus`, the run `doctor` makes); exits 0 only at 100% round-trip; `--reuse` prints the cached summary while its inputs digest (the corpus's import closure, D55) is current |
| `bench/tools/replay-regression.sh <from> <to> <out>` | replays the per-commit bench evidence of `<from>` and the range: per commit, in its own worktree with its own code, a fresh `bench run` and `bench regression --base` the previous commit plus its fresh artifact (trailers and base datasets checked), with a summary table |
| `npm run fixtures -- rebuild\|check [--only <name>]` | builds the synthetic fixtures with agbcc and binutils; `check` compares them with the committed builds (D28) |
| `npm run export-poc -- --mode scored\|parity\|queries\|raw [--pin]` | runs the read-only PoC from `ROMLIFT_POC` and dumps into `bench/.local/poc/<rom>/`: `scored.json` (its scored run and scaffold verdict; every tuning ROM, tmc from romlift's dataset, whose digest the dump records; a dump on romlift's dataset is checked against `bench/baseline/poc-dump-rows.json`, which `--pin` rewrites), `parity.json` (its parity view, and the digests into `bench/baseline/poc-digests.json`), `queries.ndjson` and `readings.ndjson` (the lockstep log, archived and re-read by its validating reader; nothing replays it since D59) (architecture §4.5); from phase 3, `--mode raw` dumps the PoC's raw-printer output (its `rawLines`) of every committed fixture, which romlift's raw printer reproduces (roadmap 3.B) |
| `node --conditions=source src/cli/main.ts <command>` | runs the `romlift` CLI from source: `doctor [--json] [--full]` (exit 0 when binutils, the corpus through the user's `as` and the JUMP11 probe are ok), and from phase 2 `analyze <rom> [--json] [--disable <rule>...]` and `explain <addr> --rom <rom> [--json]` (from phase 3 with the address's chunk and item) |
| `node --conditions=source src/cli/main.ts model --rom <rom> [--json]` | from phase 3: the model `generate` emits for a ROM (the confirm analysis over the config `configFromDiscover` builds); `--json` prints the public NDJSON (`romlift/model-json@1` header, one line per chunk), the diagnostics and a summary |
| `node --conditions=source src/cli/main.ts verify --rom <rom> [--assemble] [--link] [--printer readable\|raw] [--json]` | from phase 3: the self-checks of the tree for a ROM (tiling, re-encode, module size, text layout, paths); `--assemble` compares each module's object with its ROM range and `--link` the linked image's SHA-1, both in a fresh directory under the system temporary directory, never the working directory; NDJSON check lines, diagnostics, then `{"type":"summary","ok","exitCode","sha1"?}`; exit 0 ok, 3 a failed check, 1 an error diagnostic, 2 usage |
| `node --conditions=source src/cli/main.ts init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]` | from phase 4: creates a project in an empty directory (default the current one): `romlift.toml`, `decomp.yaml`, the scaffold (`Makefile`, `setup.sh`, `AGENTS.md`, …), `src/<module>.c` stubs and the generated tree; the ROM is copied to `baserom.gba`; then `./setup.sh && make` builds `<name>.gba` to the ROM's SHA-1 (`ROMLIFT_CLI` makes `setup.sh` run that command instead of `npx romlift`, `AGBCC_URL` fetches the pinned agbcc from a mirror) |
| `node --conditions=source src/cli/main.ts generate [--rom <rom>] [--dry-run] [--out <dir>] [--json]` | from phase 4, inside a project: regenerates `asm/`, `data/`, `ldscript.txt`, `symbols.ld`, `modules.mk` (which records `romlift.toml`'s SHA-1, so the scaffold's `make` stops on a tree older than the TOML, D82 a, and is written last, D83 d; the config is always `romlift.toml`, D83 b) and missing `src/*.c` from the project's ROM and `romlift.toml`; never writes the TOML; a model error (`E_MODULE_BORDER`, …) writes nothing and exits 1 |
| `node --conditions=source src/cli/main.ts analyze --update [--write] [--json]` | from phase 4, inside a project: what discover finds that `romlift.toml` lacks, as a patch that keeps the file's comments (`--write` saves it); `scaffold --diff [--json]` shows how the scaffold files differ from the current templates and writes nothing; `model`, `verify` and `explain` without `--rom` read the project's ROM and TOML (confirm mode) |
| `npm run build` | emits `dist/` for publishing only; development never builds |

Node runs the TypeScript sources directly (type stripping, `--conditions=source`); `engines.node` is
`>=22.18` and CI runs Node 22.18 and 24 on Linux and macOS (D2, D30). `@match-kit/decomp-yaml` declares
`node >=24`, so `npm ci` on Node 22.18 prints an `EBADENGINE` warning; it is only a warning, and
`engine-strict` stays off. The installed `romlift` bin (`dist/cli/main.js`) runs Node with V8's old space capped at
1,024 MiB: the first line of `src/cli/main.ts` is `#!/usr/bin/env -S node --max-old-space-size=1024`, which `tsc` keeps
(the owner's answers to Q2, Q6 and Q7 of phase-3.md, D68 b, D69, D72; Q7's 1,024 replaces Q6's 384, which replaced Q2's
256); `node --conditions=source src/cli/main.ts` does not apply it, so pass `--max-old-space-size=1024` to measure memory as a user's run holds it (`bench large-rom --bin` does, D70).

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROMLIFT_BENCH_ROOT` | the parent directory of the repository root | where the benchmark checkouts live (docs/benchmark-roms.md) |
| `ROMLIFT_POC` | `$ROMLIFT_BENCH_ROOT/romlift-poc` | the read-only proof-of-concept checkout |
| `ROMLIFT_REQUIRE_LOCAL` | unset | `1` makes `test/local/**` tests fail instead of skipping as `unavailable` when an input is missing |
| `ROMLIFT_GATE_TIER` | `ci` | the tier the gate tests run (`ci` or `real`); `bench gates --tier` passes it to them |
| `ROMLIFT_GATE_REPORT` | unset | a file each gate test appends its verdict to, one NDJSON line per gate (`test/gates/gate.ts`) |
| `ROMLIFT_OBJDIFF` | unset | the objdiff-cli executable of the objdiff family (measured from phase 3, gated by `g5.objdiff` in phase 6, D76 g); without it the bench looks for the repository's `bench/.local/objdiff-target` build (then the main checkout's, from a worktree), then on `PATH`, then at `$ROMLIFT_BENCH_ROOT/objdiff/target/release/objdiff-cli`, and requires the version pinned in `bench/tools/objdiff.version` (D34, D62 j) |

There is no separate linter or formatter; `npm run lint` is only a shortcut to the architecture test. Strictness comes from `tsconfig.json`, and the layer rules,
globals allowlist, `Map` iteration rule, barrel shape and dynamic-import rule are enforced by
`test/architecture.test.ts` (D5) with the checker in `test/helpers/architecture.ts`, whose edge table
is architecture §2 written as data; a violation fails `npm test`. Style follows the code in the architecture: two-space indent, single
quotes, semicolons, and `.editorconfig` for whitespace.

## Code rules

- **Layers** (architecture §2): `foundation` imports only `foundation` (no npm package, no `node:*`);
  `core` is pure (plain data in, plain data out, allowlisted globals only, never hashes, never throws
  for content); `shell` is the only code that touches files, processes, hashing or the environment and
  decides nothing; `cli` calls the shell and the workflows. The edge table in architecture §2 is
  authoritative.
- **Bench and gates** import romlift only as `romlift`, `romlift/node`, `romlift/isa` and
  `romlift/internal` (D37).
- **Erasable TypeScript only**: no `enum`, `namespace` or constructor parameter properties; closed sets
  are `as const` objects or string-literal unions; relative imports carry the `.ts` extension; type-only
  imports use `import type` (D2).
- **Public types are plain data**, deeply `readonly`, with no methods or closures (D19).
- **Determinism**: sort with an explicit comparator by code unit, never `localeCompare` or a bare
  `.sort()`; iterate `Map`/`Set` through `sortedKeys`/`sortedEntries` where §2 requires it.
- **One rule per file**, with its metadata in the file; orders and constants live in the compiler
  profile, never in code (D7, D12).
- **Nothing ships before its phase**: a command, TOML key or writer appears in the phase that gates it;
  nothing is stubbed early.
- **Diagnostics**: each module that raises codes owns its `codes.ts`; a code lands with its first raiser
  (D45).

## Naming

Use the community's terms. **Signatures**, never "packs", for the byte patterns that recognise known
code. **Library**, never "engine", for m4a, libgcc, the serial libraries and the BIOS call stubs.
**Provenance** is what a rule decided and why; **evidence** is an external fact (trace, ELF, map, legacy
cfg); **accept** names the acceptance rules (D6). Functions, modules, pools, tables, labels and
`INCLUDE_ASM` keep their usual decomp meaning.

## ROMs, benchmarks and the held-out rule

- **ROMs are never committed.** No ROM, ELF, map, object file, save or anything derived from ROM bytes;
  only SHA-1s, ELF digests, exception lists and the results artifact (docs/benchmark-roms.md).
  `.gitignore` excludes them and `test/repository.test.ts` fails if one is tracked. The only exceptions
  are the self-authored synthetic fixtures under `bench/dataset/synthetic/*/build/` and `test/fixtures/`.
- **Benchmark checkouts** live under `ROMLIFT_BENCH_ROOT`, default the parent directory of the
  repository root; on the owner's machine that is `/Users/macabeus/ApenasMeu/decompiler`. Tuning set:
  `kleod/` (klonoa), `sa2/`, `sa3/`, `FireEmblem7J/` (fe7j), `pokeemerald/`, and `tmc/` (revealed by the
  owner's decision of 17 October 2026, D60; the pinned PoC's results never covered it, and `export-poc
  --mode scored` runs the pinned PoC on it), each with its ROM, ELF and map
  (table in docs/benchmark-roms.md). agbcc builds: `pokeemerald/tools/agbcc` and `agbcc/` under the same root.
- **The proof of concept** is at `ROMLIFT_POC` (`/Users/macabeus/ApenasMeu/decompiler/romlift-poc`). It
  is read-only: never modify it. Its numbers are the acceptance bar, pinned by content (D50).
- **Held-out ROMs** (`pokefirered`, `pokeruby`, and any admitted from the reserve pool; `tmc` until its
  reveal, D60) are never
  used to tune rules: do not inspect their misses, addresses or names, and never make them signature
  references. They run sealed and report counts and verdicts only. A reveal goes through
  `bench run --reveal <rom> --reason <text>`, is recorded in Git, and the ROM stops counting (D25, D53).
  A held-out failure is fixed by a rule justified by its `restsOn` and validated on the tuning set alone.

## Phases and Git

- Six phases, each closed by one gate: a phase lands when `npm run bench -- gates --require <n>` passes
  on both tiers (`ci` and `real`) for every gate of that phase and all earlier ones (D29, D39).
- Work happens on the phase branch `phase-<n>`; parallel components on `phase-<n>-<component>`, each in
  its own `git worktree`, owning only the files roadmap.md lists for it (D43, D55 j).
- A phase closes with the full exit-command list of its record (`docs/phase-<n>.md`, "The closing
  gate"), run in that order with the real tier before the ci tier, and its record is updated with the
  measured output.
- `test/gates/phase.json` is raised on the phase branch before the closing real-tier run, because it is
  part of the source digest that run records (D55 j). Merge to `main` and push only when the phase gate
  passes and the CI workflows (`ci.yml`, `printer.yml`, `provenance.yml`) have run on the phase's pull
  request; the merge carries the raised marker. Only the phase lead regenerates `bench/results.json`
  and `bench/baseline/speed.json`.
- Every commit message ends with exactly this line (from phase 4 on; phases 1 to 3 also carried a `Claude-Session:`
  line, D75 p):

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
