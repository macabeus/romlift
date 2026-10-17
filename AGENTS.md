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
| `npm run test:local` | `test/local/**`; needs `ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC` (below): the PoC decoder differential, `epoch-reuse` against `epoch` on the tuning ROMs, and the committed PoC-parity evidence (`poc-parity`, `poc-lockstep`) |
| `npm run bench -- <command>` | the benchmark harness (architecture §8.5), from phase 1 |
| `npm run bench -- gates --require <n> --tier ci\|real` | runs the gate tests of phase ≤ n and prints every verdict (D29) |
| `npm run bench -- doctor-real\|run\|poc-check\|dataset-check\|provenance\|stale-check` | the real-tier inputs; rescoring into `bench/results.json` (`run [--only <rom>] [--json] [--disable <rule>...] [--cpu-prof]`; a sealed dataset prints counts only); the PoC baseline; datasets against ELFs; the artifact's provenance; whether it is current |
| `npm run bench -- speed [--only <rom>] [--write-baseline]` | serial median CPU time of the analysis per tuning ROM against `bench/baseline/speed.json`, calibrated (`g2.speed`); only the phase lead writes the baseline |
| `npm run bench -- ablate <rule> [--tier synthetic\|real]` | re-runs with one rule disabled and prints where it was decisive and what moves |
| `npm run bench -- explain <rom> <addr>` | what the discover run decided about one address of a tuning ROM or a fixture |
| `npm run bench -- adopt <rom>` | seeds a new tuning dataset's lists as `unreviewed` placeholders to classify (refuses a sealed dataset) |
| `npm run corpus` | generates the `as` round-trip corpus into `bench/.local/corpus/` and assembles it with the system `arm-none-eabi-as` (romlift's `runCorpus`, the run `doctor` makes); exits 0 only at 100% round-trip; `--reuse` prints the cached summary while its inputs digest (the corpus's import closure, D55) is current |
| `npm run fixtures -- rebuild\|check [--only <name>]` | builds the synthetic fixtures with agbcc and binutils; `check` compares them with the committed builds (D28) |
| `npm run export-poc -- --mode scored\|parity\|queries` | runs the read-only PoC from `ROMLIFT_POC` and dumps into `bench/.local/poc/<rom>/`: `scored.json` (its scored run and scaffold verdict), `parity.json` (its parity view, and the digests into `bench/baseline/poc-digests.json`), `queries.ndjson` and `readings.ndjson` (the lockstep log) (architecture §4.5) |
| `node --conditions=source src/cli/main.ts <command>` | runs the `romlift` CLI from source: `doctor [--json] [--full]` (exit 0 when binutils, the corpus through the user's `as` and the JUMP11 probe are ok), and from phase 2 `analyze <rom> [--json] [--disable <rule>...]` and `explain <addr> --rom <rom> [--json]` |
| `npm run build` | emits `dist/` for publishing only; development never builds |

Node runs the TypeScript sources directly (type stripping, `--conditions=source`); `engines.node` is
`>=22.18` and CI runs Node 22.18 and 24 on Linux and macOS (D2, D30). `@match-kit/decomp-yaml` declares
`node >=24`, so `npm ci` on Node 22.18 prints an `EBADENGINE` warning; it is only a warning, and
`engine-strict` stays off.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROMLIFT_BENCH_ROOT` | the parent directory of the repository root | where the benchmark checkouts live (docs/benchmark-roms.md) |
| `ROMLIFT_POC` | `$ROMLIFT_BENCH_ROOT/romlift-poc` | the read-only proof-of-concept checkout |
| `ROMLIFT_REQUIRE_LOCAL` | unset | `1` makes `test/local/**` tests fail instead of skipping as `unavailable` when an input is missing |
| `ROMLIFT_GATE_TIER` | `ci` | the tier the gate tests run (`ci` or `real`); `bench gates --tier` passes it to them |
| `ROMLIFT_GATE_REPORT` | unset | a file each gate test appends its verdict to, one NDJSON line per gate (`test/gates/gate.ts`) |

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
  `kleod/` (klonoa), `sa2/`, `sa3/`, `FireEmblem7J/` (fe7j), `pokeemerald/`, each with its ROM, ELF and
  map (table in docs/benchmark-roms.md). agbcc builds: `pokeemerald/tools/agbcc` and `agbcc/` under the same root.
- **The proof of concept** is at `ROMLIFT_POC` (`/Users/macabeus/ApenasMeu/decompiler/romlift-poc`). It
  is read-only: never modify it. Its numbers are the acceptance bar, pinned by content (D50).
- **Held-out ROMs** (`pokefirered`, `pokeruby`, `tmc`, and any admitted from the reserve pool) are never
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
- Every commit message ends with exactly these two lines:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JNLnM6KmzWvJDFNNgMvvvX
  ```
