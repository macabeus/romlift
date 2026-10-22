# romlift roadmap

This is the build order of [architecture.md](architecture.md) (revision 2): for each of the six phases,
the components, who owns which file, what each one exports, which tests gate it, what it ports from the
proof of concept, what it depends on, and the exact commands that close the phase. Decisions are cited
as `D<n>` from [decisions.md](decisions.md); gate ids are defined in architecture §13.

## How a phase runs

Every phase has the same shape (D43):

1. **Component 0, the phase lead**, works alone on the phase branch. It freezes the phase's types,
   creates the empty barrels (`src/api/<component>.ts`, `cli/commands/lists/<component>.ts`) and adds
   their `export *`/import lines to `src/{index,node,isa,internal}.ts` and `cli/commands/index.ts`, empty
   family registries and `codes.ts` files, and makes the phase's gate files real (their bodies were
   written as `pending` in phase 1; component 0 updates them if the frozen API changed). It must pass
   `npm run typecheck` and `npm test`. Nothing else starts before it is committed.
2. **Three to five parallel components**, each on its own branch `phase-<n>-<component>` in its own
   worktree (phase 1 used these flat names; D55 j):

   ```
   git worktree add ../romlift-wt/p<n>-<component> -b phase-<n>-<component> phase-<n>
   ```

   Each owns the files listed for it and no others. A file listed for one parallel component is never
   edited by another parallel component of the same phase. Files that component 0 creates empty (barrels,
   family registries, `codes.ts`, writer files) pass to the parallel component that the listing names;
   component 0 does not edit them again before integration. A component that needs a frozen type
   changed asks the lead, who commits the change to the phase branch; every component then rebases. No
   component commits `bench/results.json`, `bench/baseline/speed.json` or `test/gates/phase.json`.
3. **The integrator** (the lead again) merges the components in the listed order, runs the steps that
   need everything together (milestones, real-tier runs), raises `test/gates/phase.json` on the phase
   branch (it is part of the source digest the closing real-tier run records, D55 j), regenerates
   `bench/results.json`, and runs the exit commands, the real tier before the ci tier (D54 i). When
   they pass, it pushes the phase branch and opens the pull request to `main`, so `ci.yml`,
   `printer.yml` and `provenance.yml` run on it, records their results in the phase record, and merges;
   the merge carries the raised marker.

**Every commit message** ends with this line (from phase 4 on, by the orchestrator's instruction; phases 1 to 3 also
carried a `Claude-Session:` line, D75 p):

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

**Common commands** used by every exit list below:

| Command | Meaning |
| --- | --- |
| `npm ci` | install exactly the lock file |
| `npm run typecheck` | `tsc --noEmit`; exit 0 |
| `npm test` | unit, golden, architecture, property and mutation tests (`node --conditions=source --test`); exit 0 |
| `npm run test:local` | `test/local/**` (needs `ROMLIFT_BENCH_ROOT` and `ROMLIFT_POC`); exit 0, no test reported `unavailable` |
| `npm run bench -- doctor-real` | every ROM, ELF, object directory, PoC file and toolchain matches its recorded digest; exit 0 |
| `npm run bench -- gates --require <n> --tier ci` | every gate of phase ≤ n and tier ci is `pass` (or `historical`); exit 0 |
| `npm run bench -- gates --require <n> --tier real` | the same for tier real, and the gate record is written into `bench/results.json`; exit 0 |
| `npm run bench -- regression` | the committed artifact and datasets against `git merge-base origin/main HEAD`; exit 0 |

---

## Phase 1: Decoder

Entry: an empty repository. Branch `phase-1` (D55 j). Six components: 1.0, then 1.A–1.D in parallel,
then 1.I.

### As executed (D54)

Phase 1 runs as nine components in three waves on the branch `phase-1`, each component on its own
branch and worktree; sections 1.0–1.I below still describe what the phase delivers. D54 records each
deviation and why.

| Component | Wave | Takes from the sections below |
| --- | --- | --- |
| `p1-infra` | 0 | 1.0's repository files, `test/architecture.test.ts` and its checker `test/helpers/architecture.ts`, `test/gates/gate.ts`, `phase.json`, `ci.yml`, the frozen CLI types (`registry.ts`, `exit-codes.ts`, `commands/index.ts`, `lists/toolchain.ts`), `foundation/util/prng.ts` |
| `p1-foundation` | 0 | all of 1.B, plus 1.0's barrels, `span.ts`, `diagnostic.ts`, `formats/types.ts`, `src/api/files.ts` |
| `p1-isa` | 1 | 1.A, plus `foundation/isa/types.ts`, the corpus (`test/corpus/generate.ts`, `foundation/isa/corpus.ts`) and `shell/toolchain/binutils.ts` |
| `p1-cli` | 1 | 1.C's CLI: `main.ts`, `args.ts`, reporters, registry helpers |
| `p1-bench` | 1 | 1.D |
| `p1-gates-early` | 1 | the `g1.*`, `g2.*` and `g3.*` gate files |
| `p1-doctor` | 2 | 1.C's `doctor`: `shell/toolchain/doctor.ts`, `commands/doctor.ts`, `lists/toolchain.ts`, `api/toolchain.ts` |
| `p1-gates-late` | 2 | the `g4.*`, `g5.*` and `g6.*` gate files |
| `p1-integration` | last | 1.I; runs the exit commands with the real tier before the ci tier |

### 1.0 Repository and frozen interfaces (lead)

- **Owns:** `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore`,
  `AGENTS.md`, `README.md`, `src/{index,node,isa,internal}.ts`, `src/api/{isa,rom,formats,toolchain,vocabulary}.ts`
  (empty), `cli/commands/index.ts`, `cli/commands/lists/{toolchain}.ts` (empty), `src/foundation/rom/span.ts`,
  `src/foundation/isa/types.ts`, `src/foundation/diagnostics/diagnostic.ts`, `src/foundation/formats/types.ts`
  (`ElfFile`, `ElfSymbol`, `GnuMap`, and the parser function types), `test/architecture.test.ts`,
  `test/gates/gate.ts`, `test/gates/phase.json` (`{"landed": 0}`), every `test/gates/g1.*` … `g6.*` file
  (complete bodies; each reports `pending` until its `needs` are exported), `.github/workflows/ci.yml`.
- **Public API:** types `Addr`, `Mode`, `Span`, `SpecId`, `Field`, `Fields`, `FlowKind`, `Flow`,
  `RawReason`, `InsnSpec`, `Insn`, `SymbolResolver`, `Severity`, `Diagnostic`, `CodeSpec`; function
  `defineCodes`; `GateSpec`, `Verdict`.
- **Gated by:** `g1.architecture`, `g1.runtime-deps`.
- **Ports from the PoC:** nothing (the PoC's `package.json` scripts inform the npm scripts).
- **Depends on:** nothing.

### 1.A Instruction set

- **Owns:** `src/foundation/isa/{thumb-table,arm-table,decode,encode,format,parse,assemble,roundtrip}.ts`,
  `src/foundation/asm/dialect.ts`, `src/api/isa.ts`, `test/unit/isa/**`, `test/golden/isa/**`,
  `test/helpers/{thumb,arm}.ts`, `test/local/poc-decoder-differential.test.ts`.
- **Public API (`romlift/isa`):** `decode(mode, word, addr)`, `encode(spec, fields)`,
  `format(insn, resolver)`, `parse(text, mode, addr, resolver)`, `assemble(parsed, addr)`,
  `roundTrips(insn, resolver)`, `specOf(id)`, `DIALECT` (`preamble(mode)`, `macrosInc`); D55 (h) adds
  `formatRaw`, `rawReason`, `RAW_REASONS` and the types `Assembled`, `ParsedInsn`, `ParsedCandidate`,
  `FieldKind`, `Dialect`.
- **Gated by:** unit tests per row; `decode∘encode` and "round-trips or raw" property tests; goldens;
  the differential test (the `Flow` kind of every Thumb halfword and of a seeded ARM sample equals the
  PoC's `thumb.ts`/`arm.ts` classification, where both define one).
- **Ports from the PoC:** nothing; `thumb.ts` and `arm.ts` (control-flow-only decoders) are replaced by
  the table and serve only as the differential reference.
- **Depends on:** 1.0.

### 1.B ROM, formats and utilities

- **Owns:** `src/foundation/rom/{rom,header,memory-map,codes}.ts`,
  `src/foundation/formats/{elf,gnu-map,canonical-json}.ts`, `src/foundation/util/{hex,sorted}.ts`,
  `src/shell/{hash,fs}.ts`, `src/api/{rom,formats}.ts`, `test/unit/{rom,formats,util,shell}/**`,
  `test/fixtures/formats/**` (a tiny self-authored ELF and map, with the script that builds them).
- **Public API:** `romFromBytes`, `u8`, `u16`, `u32`, `contains`, `parseHeader`, `parseElf`,
  `parseGnuMap`, `canonicalJson` (a stream of string chunks), `hex`, `sortedKeys`, `sortedEntries`;
  `romlift/node`: `sha1Of`, `sha256Stream`, `listDir`, `atomicWrite`.
- **Gated by:** unit tests; `g1.architecture` (no `node:*` in foundation).
- **Ports from the PoC:** `rom.ts` (rewritten pure, no parameter properties), `elf.ts` and `truth.ts`
  (into `formats/elf.ts`), `project.ts`'s `romHeader` (into `rom/header.ts`), `sha1Of` (into
  `shell/hash.ts`).
- **Depends on:** 1.0.

### 1.C Corpus, doctor and CLI

- **Owns:** `test/corpus/generate.ts`, `test/helpers/prng.ts`, `src/shell/toolchain/{binutils,doctor}.ts`,
  `src/cli/{main,args,registry,exit-codes}.ts`, `src/cli/commands/doctor.ts`,
  `src/cli/commands/lists/toolchain.ts`, `src/cli/reporters/{text,ndjson}.ts`, `src/api/toolchain.ts`,
  `.github/workflows/printer.yml`, `test/unit/cli/**`.
- **Public API:** `CommandSpec`, `ExitCode`, `main(argv, io)`; `romlift/node`: `runDoctor`,
  `assembleWithBinutils`.
- **Gated by:** `g1.thumb-roundtrip`, `g1.bl-sample`, `g1.arm-sample`, `g1.encoder-agrees`,
  `g1.context-corpus`, `g1.doctor`.
- **Ports from the PoC:** `cli.ts` argument handling (rewritten around `CommandSpec`).
- **Depends on:** 1.0; 1.A for real corpus content (the generator and comparator are built and tested
  on hand-written cases until 1.A merges).

### 1.D Bench harness

- **Owns:** `bench/src/{cli,dataset,dataset-check,vocabulary,score,run,gates,report,serve,provenance,digest,regression,doctor-real}.ts`,
  `bench/tools/export-poc.ts` (the `scored` mode), `bench/dataset/real/{klonoa,sa2,sa3,fe7j,pokeemerald}.json`
  (the PoC's lists, plus `elfSha256`, `family`, `buildNote`, `heldout: false`, `revealed: []`),
  `bench/baseline/{poc-2026-10-16.json,poc-source.json}`, `src/core/provenance/vocabulary.ts`,
  `src/api/vocabulary.ts`, `.github/workflows/provenance.yml`, `test/unit/bench/**`.
- **Public API:** `MISS_REASONS`, `ORIGINS`, `MissReason`, `Origin` (from `romlift`); bench-internal:
  `Dataset`, `ScoredRun`, `EXCEPTION_CATEGORIES`.
- **Gated by:** `g1.bench-harness`, `g1.dataset-elf`, `g1.provenance`; vocabulary and dataset structure
  unit tests.
- **Ports from the PoC:** `src/bench/{cli,dataset,report,run,serve,vocab}.ts`, `src/score.ts`
  (rewritten against the public API; `originId`/`missReasonId` prefix matching survives only inside the
  `scored` reader of PoC dumps).
- **Depends on:** 1.0; 1.B's `parseElf`, `parseGnuMap`, `canonicalJson` (types frozen in 1.0).

### 1.I Integration

- **Owns:** `test/mutation/phase1/**`, `bench/results.json`, `test/gates/phase.json`.
- **Does:** merges 1.A, 1.B, 1.C, 1.D in that order; writes the phase-1 mutation tests (an illegal
  import, a flipped corpus byte, a bad dataset row, a stale digest); runs export-poc on the five tuning
  ROMs; refreshes `results.json`; runs the exit commands; raises `landed` to 1; merges to `main` and pushes.
- **Gated by:** `g1.checks-fail` and every phase-1 gate.

### Phase 1 exit

```
npm ci
npm run typecheck
npm test
npm run corpus                                   # with the system arm-none-eabi-as
npm run bench -- doctor-real
npm run export-poc -- --mode scored               # spawns the PoC's own tsx (architecture §4.5)
npm run test:local                               # the decoder differential against the PoC
npm run bench -- run
npm run bench -- gates --require 1 --tier real         # before the ci tier (D54 i)
npm run bench -- gates --require 1 --tier ci
```

Thresholds: the corpus prints 100.00% of printed mnemonics round-tripping on Thumb, `bl` and ARM, both
alignments and every offset extreme agreeing, and a raw count per `RawReason`; `printer.yml` passes on apt
and Homebrew binutils; rescoring the PoC's dumps reproduces `poc-2026-10-16.json` row for row on all five
ROMs; the PoC's scaffold reproduces the SHA-1 on all five; all twelve `g1.*` gates `pass`.

---

## Phase 2: Analysis

Entry: phase 1 landed. Branch `phase/2-analysis`. Seven components: 2.0, then 2.A–2.E in parallel, then
2.I, which runs milestones M1–M7 (architecture §4.5).

### As executed (D56)

Phase 2 ran as thirteen components in three waves on the branch `phase-2`, each on its own flat branch
`phase-2-<component>` and worktree (D55 j); sections 2.0–2.I below still describe what the phase
delivers. D56 records each deviation and why; [phase-2.md](phase-2.md) records the milestones, their
numbers and the deviations of the milestone component. The lockstep gates of 2.A to 2.D were met by
milestone M1's run, whose evidence is committed in `bench/results.json`; the oracle that ran them was
deleted in the fix round of phase 2 (D59), so they are historical and `g2.poc-parity` checks the
evidence.

| Component | Wave | Takes from the sections below |
| --- | --- | --- |
| `p2-driver` | 1 | 2.0's `src` part (provenance, profile, the analysis types and contracts, `address-map`, `limits`, `codes`, `define-rule`, `rules/index.ts` and the eight empty family indexes, the barrels), 2.A's driver (`driver/**`, `pointers.ts`, `foundation/util/{interval-index,csr,min-heap}.ts`) plus `reading.ts`, `oracle.ts` (deleted in the fix round, D59) and `diagnose.ts`, and the walk skeleton of 2.B (`walk/{cursor,thumb,arm}.ts`); `test/helpers/analysis.ts` |
| `p2-poc-export` | 1 | 2.0's `parity` and `queries` modes of `bench/tools/export-poc.ts` (the log format `romlift-bench/poc-queries@1`), their readers `bench/src/{parity-view,poc-log}.ts` and `bench/baseline/poc-digests.json` |
| `p2-fixtures` | 1 | 2.E's synthetic fixtures (`bench/dataset/synthetic/**`, `fixtures.yml`, `test/helpers/fixtures.ts`) |
| `p2-heldout` | 1 | 2.E's sealed held-out datasets (`bench/dataset/real/{pokefirered,pokeruby,tmc}.json`), the seal tool `bench/tools/seal-dataset.ts` and the sealed classifiers and counts `bench/src/{classify,seal}.ts` |
| `p2-rules-walk-bl-claim` | 2 | 2.B's rules: `rules/{walk,bl,claim}/**` and their tests, on the walk skeleton of `p2-driver` |
| `p2-rules-seed-valid-accept` | 2 | 2.C: `rules/{seed,valid,accept}/**` and their tests |
| `p2-rules-gap-region` | 2 | 2.D: `rules/{gap,region}/**` and their tests; `test/helpers/dummy-profile.ts` |
| `p2-lockstep` | 2 | 2.0's `bench/src/{parity,lockstep}.ts` (`lockstep.ts` deleted in the fix round, D59) and `test/local/{poc-lockstep,poc-parity}.test.ts`, 2.A's codec (`core/analysis/codec.ts`, `src/api/analysis-codec.ts`) |
| `p2-bench` | 2 | the `bench run` rewrite (the bench scores romlift's own analysis; the scaffold family still reads the PoC's dumps until phase 3), 2.E's `core/analysis/explain.ts` (`src/api/analysis-explain.ts`) and `bench/src/{ablate,speed}.ts`; `bench run` on the sealed datasets, `--reveal` and `adopt` |
| `p2-commands` | 3 | 2.E's `core/workflow/{discover,explain}.ts`, `cli/commands/{analyze,explain}.ts`, `cli/commands/lists/analysis.ts`, `src/api/workflow-discover.ts`, `test/golden/explain/**` |
| `p2-fixture-coverage` | 3 | fixture coverage of every rule (`g2.rule-coverage`) |
| `p2-mutation-ci` | 3 | `test/mutation/phase2/**` (`g2.checks-fail`) and the phase-2 CI |
| `p2-milestones` | 3 | 2.I's milestones M1–M7 on the merged tree: the parity wiring and evidence, M2's fixes and `epoch-reuse`, `walk.table-by-register`, the ascending default, the extents and M4 rule fixes, the M5 dataset rewrite, M6, the deletion of `'poc-lifo'`, the sealed runs; `bench/baseline/{accepted-diffs,speed}.json`, `docs/phase-2.md`. The closing sequence (raising `test/gates/phase.json`, the closing real-tier run, provenance, the pull request) runs on `phase-2` after wave 3 merges, and only once `g2.held-out` passes (D53) |

### 2.0 Analysis interfaces, profile and lockstep harness (lead)

- **Owns:** `src/core/provenance/{rule-id,provenance,trail}.ts`, `src/core/profile/{types,registry,agbcc}.ts`
  (the PoC's numbers and every slot order, naming every rule id of architecture §4.1),
  `src/core/analysis/{types,address-map,limits,codes}.ts`, `src/core/analysis/rules/define-rule.ts`,
  `src/core/analysis/rules/index.ts` and the eight family `index.ts` files (empty records),
  `src/api/profile.ts`, the empty barrels `src/api/{analysis,internal-analysis}.ts` (passed to 2.A) and
  `src/api/workflow-discover.ts` (passed to 2.E),
  `cli/commands/lists/analysis.ts` (empty, passed to 2.E), `bench/src/{parity,lockstep}.ts`, the `parity` and `queries`
  modes of `bench/tools/export-poc.ts`, `bench/baseline/poc-digests.json`,
  `test/local/{poc-lockstep,poc-parity}.test.ts`.
- **Public API:** `RuleId`, `RuleMeta`, `Fact`, `Provenance`, `Rejection`, `TrailEvent`, `TrailSink`,
  `TrailLevel`, `CompilerProfile`, `Pipeline`, `ProfileId`, `PROFILES`, `profileById`, `AddressMap`,
  `addressMap`, `toRun`, `toLoad`, `AnalysisView`, `Candidate`, every rule contract, `Reading`,
  `FunctionFact`, `AnalysisResult`, `AnalysisOptions`, `Seed`, `OverrideFact`;
  `romlift/internal`: `AnalysisTuning`, `defineRule` (internal: rules run only from this repository's
  registry, D59), `RuleOracle` (deleted with the oracle once the lockstep evidence was committed, D59).
- **Gated by:** typecheck; unit tests of `address-map.ts` (identity) and of the oracle reader on a
  hand-written log.
- **Ports from the PoC:** the numbers of `analysis.ts` into `agbcc.ts`; nothing else.
- **Depends on:** phase 1.

### 2.A Driver and state

- **Owns:** `src/core/analysis/driver/{run,grow,fill-gaps,accept,settle,validity,epoch,worklist,confirm,view}.ts`,
  `src/core/analysis/{codec,pointers}.ts`, `src/foundation/util/{interval-index,csr,min-heap}.ts`,
  `test/unit/analysis/driver/**`.
- **Public API:** `analyze`, `encodeAnalysis`, `decodeAnalysis`; `romlift/internal`: `analyzeTuned`.
- **Gated by:** unit tests; lockstep with **every** rule family answered by the oracle: the driver alone,
  fed the PoC's recorded answers and readings, reproduces the PoC's acceptance sequence and parity digest
  on all five tuning ROMs; codec round-trip.
- **Ports from the PoC:** `run()`, `grow()`, `fillGaps()` (control flow), `accept()`, `settle()` (the
  fixpoint loop), `valid()` (optimistic memo, `neverValid`), `forgetCandidates()` (as epochs), `owner()`,
  the `dataRefs` index of the constructor (as `pointers.ts`).
- **Depends on:** 2.0.

### 2.B Walk, `bl` verdicts and claims

- **Owns:** `src/core/analysis/walk/{cursor,thumb,arm}.ts`, `src/core/analysis/rules/{walk,bl,claim}/**`
  (the family `index.ts` files created empty by 2.0 included), `test/unit/analysis/{walk,bl,claim}/**`.
- **Public API:** none beyond the registry entries (`WalkCursor`, `WalkStep` are frozen types).
- **Gated by:** a unit test per rule on hand-assembled bytes; lockstep with walk, `bl` and claim
  families real and the rest from the oracle, on all five tuning ROMs, with no divergence.
- **Ports from the PoC:** `analyzeThumb`, `analyzeArm`, the verdict ladder of `settle()`,
  `popsCallersFrame`, `claim()`, the `Func` getters (`codeEnd`, `end`, computed once per reading).
- **Depends on:** 2.0; 2.A for whole-driver runs (lockstep runs on 2.A's branch head once it exists).

### 2.C Seeds, validity and acceptance

- **Owns:** `src/core/analysis/rules/{seed,valid,accept}/**` (the family `index.ts` files created empty by
  2.0 included), `test/unit/analysis/{seed,valid,accept}/**`.
- **Public API:** none beyond the registry entries.
- **Gated by:** unit tests per rule; lockstep with seed, validity and accept families real.
- **Ports from the PoC:** the seeds of `run()`, `pointerCandidates()`, the `accept()` queue (calls,
  veneers, `adr`), `whyInvalid()` in its order, `dense()`, `looksLikePointerTable()`, `couldBeCode()`,
  `acceptable()`, `inPointerTable()`, `anchoredAtStart/End`, the tiny-candidate rule of
  `thumbCandidate()`.
- **Depends on:** 2.0; 2.A for whole-driver runs.

### 2.D Gaps and regions

- **Owns:** `src/core/analysis/rules/{gap,region}/**` (the family `index.ts` files created empty by 2.0
  included), `test/unit/analysis/{gap,region}/**`.
- **Public API:** none beyond the registry entries.
- **Gated by:** unit tests per rule; lockstep with gap and region families real.
- **Ports from the PoC:** `absorbBlock`/`absorbRun`, `holeHead`, `tryTiledHole`, `thumbCandidate`,
  `armAhead`, the Thumb/ARM comparison, the end-anchor loop, the backward prologue chain, the padding and
  pointer-word step, the `startup` getter, code-end classification.
- **Depends on:** 2.0; 2.A for whole-driver runs.

### 2.E Fixtures, commands and held-out datasets

- **Owns:** `bench/dataset/synthetic/<positive and negative fixtures>/**`, `.github/workflows/fixtures.yml`,
  `test/helpers/{fixtures,dummy-profile}.ts`, `src/core/analysis/explain.ts`,
  `src/core/workflow/{discover,explain}.ts`, `src/cli/commands/{analyze,explain}.ts`,
  `bench/src/{classify,seal,ablate,speed}.ts`, `bench/dataset/real/{pokefirered,pokeruby,tmc}.json`
  (created sealed: `heldout: true`, `revealed: []`, family set), `test/golden/explain/**`.
- **Public API:** `discover`, `explain` (returning `ExplainReport` with the phase-2 part only),
  `AnalysisExplanation`; CLI `analyze`, `explain`.
- **Gated by:** `g2.synthetic-analysis`, `g2.second-profile`, explain goldens, classifier unit tests
  (including the suppressed-split fixture that must classify as `glued`).
- **Ports from the PoC:** the `analyze` and `explain` command shapes of `cli.ts`; nothing of the
  classifiers exists in the PoC.
- **Depends on:** 2.0; 2.A–2.D for fixture outcomes (fixtures and expectations are authored first, from
  the ELFs).

### 2.I Integration and milestones

- **Owns:** `bench/baseline/{accepted-diffs.json,speed.json}`, `bench/results.json`,
  `test/mutation/phase2/**`, `test/gates/phase.json`, the dataset rewrites of M5, the
  `walk.table-by-register` rule (M3), the `resettle` stage if M6 needs it, and any driver or rule change
  a milestone requires (components have merged by then).
- **Does:** merges 2.A, 2.B, 2.C, 2.D, 2.E; then, in order: M1 parity (`g2.poc-parity`); M2 performance
  (`bench run --cpu-prof`, computed-once facts, re-measure with `bench speed`, `epoch-reuse` only if a ROM
  misses the budget); M3 register-tracked table jumps; M4 ascending order and the permutation test; M5 the
  unreviewed rows and the startup exclusion; M6 confirm equals discover; M7 sealed held-out runs. Each of
  M3, M4 and later rule changes is its own commit and passes `bench regression --base <previous
  milestone>` with no exemption. Deletes `'poc-lifo'`; marks `g2.poc-parity` historical.
- **Gated by:** every `g2.*` gate, `g2.checks-fail` included.

### Phase 2 exit

```
npm ci
npm run typecheck
npm test
npm run fixtures -- check
npm run export-poc -- --mode scored
npm run export-poc -- --mode parity
npm run export-poc -- --mode queries
npm run test:local
npm run bench -- doctor-real
npm run corpus
npm run bench -- run
npm run bench -- speed
npm run bench -- regression
npm run bench -- gates --require 2 --tier real
npm run bench -- gates --require 2 --tier ci
```

`npm run corpus` comes before `bench run` because the artifact's `printer` member is the corpus summary
while its inputs digest is current; without a fresh summary `bench run` keeps the previous member only
when it is still current, and otherwise refuses to write rather than drop it (D59 t). The real tier runs
before the ci tier (AGENTS.md).

Thresholds: on each tuning ROM, raw precision ≥ 99.7%, every miss in `labels` and every false entry in
`untyped`, raw true positives ≥ the PoC's, zero `unreviewed`, no agreeing extent lost and ≥ 99.9% of sized
functions agreeing, code end within 16 bytes; rows equal the PoC baseline except listed improvements;
confirm equals discover on every tuning ROM; `bench speed` ≤ 1.5 × `baseline/speed.json` per ROM; on the sealed
ROMs, at least two pass (raw precision ≥ 99.7%, raw recall ≥ 99.46%, zero `glued`, ≤ 11 label candidates,
extents ≥ 99.9%, code end ≤ 16 bytes), from two families, one of them absent from the tuning set
(architecture §8.4, D53); all seventeen
`g2.*` gates `pass` or `historical`. Since the owner's decision of 17 October 2026 (D60) the tuning set is
six ROMs (tmc revealed); every threshold above applies to all six except where the owner's answers of 18
October 2026 (D61) say otherwise, which is exactly this, each printed by its gate: tmc has no row in the
pinned PoC baseline, so its PoC reference is the pinned PoC's own run of it (`export-poc --mode scored`;
`poc.source` `dump`), and it is a benchmark row ("Keep tmc as 99.94%. It's a benchmark row that we can
improve later"): `g2.poc-parity` covers the five ROMs of the M1 evidence (tmc not applicable), and
`g2.baseline-rows` accepts tmc's rows that the dataset lists with a category, with tmc's tp 8,631 of 8,636
as a floor; `g2.confirm-equals-discover` accepts tmc's eight differences of Q3 and Q6 as a known limitation
and nothing else ("Build resettle, else accept": the resettle stage was measured and reverted; "Yes, cover
all 8"); both held-out
family conditions are waived for the sealed pokefirered and pokeruby and the tuning families of D60 only
("Waive both"); and the ELF code end ends an unsized function at the next `$d` or typed symbol on every
ROM ("Use $d for every ROM"). Every other threshold, and every threshold on the five original ROMs and the
sealed pair, is as above.

---

## Phase 3: Emission

Entry: phase 2 landed. Branch `phase/3-emission`. Seven components: 3.0, then 3.A–3.E in parallel, then
3.I. The seam is the committed canonical analysis of every fixture (`test/golden/analysis/*.json`), so
3.B–3.E build on it before 3.A's model is complete.

### As executed (D62)

Phase 3 runs as nine components in three waves on the branch `phase-3` (eight planned by D62 a, the ninth, `p3-fixture-goldens`, added in wave 3, D65 k), each on its own flat branch
`phase-3-<component>` and worktree (D56 h); sections 3.0–3.I below still describe what the phase delivers.
D62 records each deviation and why; [phase-3.md](phase-3.md) records the components, the measured numbers and
the closing gate. Every threshold of the phase applies to all six tuning ROMs (D60, D62 h). The owner's answers of
19 October 2026 (D68) moved the objdiff gate to phase 5 (`g5.objdiff`, 5.C), made `g3.large-rom` measure under the
`romlift` bin's heap cap (384 MiB by the answer to phase-3.md Q6, D69; 1,024 MiB by the answer to Q7, D72), accepted D64 d and the narrowed raw-printer parity (D65 l) as 3.B's gate, and put two
work items into phase 4; Q7's answer put a third there ("Carried from phase 3", below). Q8's answer (D73) re-ran the
closing list unchanged after a landing run failed `g2.speed` by 0.5 ms; it changes no gate, and the re-run passed every
command at `0784b4e`.

| Component | Wave | Takes from the sections below |
| --- | --- | --- |
| `p3-lead` | 1 | 3.0: the frozen types (`core/model/types.ts`, `core/emit/tree.ts`, `core/write-plan/types.ts`, `core/verify/report.ts`, `core/config/{schema,compilers}.ts`, `core/proposals/types.ts`, `core/layout/types.ts`), the writer registry and the eight empty writer files, the shared primitives `core/model/{item-table,resolver,paths}.ts` (D62 b) and `core/write-plan/{manifest,journal}.ts`, the empty `core/{model,verify,write-plan}/codes.ts`, the barrels, `cli/commands/lists/emission.ts`, `test/golden/analysis/**`, `test/helpers/model.ts`, the g3 gate files; then 3.I |
| `p3-asm-text` | 1 | 3.C's `foundation/asm/{statements,layout}.ts` and their tests (`parseStatements`, `layoutStatements`) |
| `p3-bench-inputs` | 1 | 3.E's inputs: `bench/tools/objdiff.version` and the objdiff-cli locator (D62 j), the reference objects of the tuning datasets, the 32 MiB synthetic image of `g3.large-rom` |
| `p3-model` | 2 | 3.A, with `config-from-discover.ts` at `core/workflow/` (D62 c) and the model codes; `src/api/{model,layout}.ts` |
| `p3-printer` | 2 | 3.B without `symbol-resolver.ts` (the resolver is `core/model/resolver.ts`, D62 b): `emit-tree.ts`, `print/**`, the header, crt0, function, orphan and module writers, `printChunk`; `src/api/{emit,internal-emit}.ts` |
| `p3-data-verify` | 2 | 3.C but `foundation/asm/**`: the data, ldscript and symbols writers, `verifyModel`, `checkEntry`, `checkPaths`, the verify codes, the mutation tests of the four self-checks (D62 g); `src/api/verify.ts` |
| `p3-write-plan` | 2 | 3.D's `plan-writes.ts`, the write-plan codes, `shell/project/{apply-writes,lock}.ts`, `shell/toolchain/link-check.ts`, the `plan-writes` mutation test; `src/api/{write-plan,project}.ts` |
| `p3-generate` | 3 | 3.D's `core/workflow/generate.ts` and the `model --json` and `verify` commands (`cli/commands/lists/emission.ts`), `src/api/workflow-generate.ts`, `bench/src/large-rom.ts`, `explain`'s phase-3 part (`item`, `chunk`) |
| `p3-bench-scaffold` | 3 | 3.E's `bench run --scaffold` with both printers, the readability and objdiff families, `bench speed`'s `generate` and `init` timings, the `bench large-rom` command |
| `p3-fixture-goldens` | 3 | 3.B's and 3.C's writer goldens (`test/golden/writers/**` and their test), 3.B's raw-printer PoC parity (`export-poc --mode raw`, `test/local/poc-raw-printer.test.ts`), `bench/tools/ci-digests.ts` `@2` (tree digests in CI), `test/local/emission-real.test.ts` (D65 k) |

### 3.0 Model, tree and write-plan interfaces (lead)

- **Owns:** `src/core/model/types.ts`, `src/core/emit/tree.ts`, `src/core/emit/writers/index.ts` and one
  file per phase-3 writer (each exporting a writer that yields nothing, filled by its owner),
  `src/core/write-plan/{types,manifest,journal}.ts`, `src/core/verify/report.ts`,
  `src/core/config/{schema,compilers}.ts` (types and zod schema without the phase-5 key `data_start`;
  `agbcc` and `old_agbcc`), `src/core/proposals/types.ts`, `src/core/layout/types.ts`,
  `test/golden/analysis/*.json`, `src/api/config-types.ts`, the empty barrels `src/api/{model,layout}.ts`
  (passed to 3.A), `src/api/emit.ts` (3.B), `src/api/verify.ts` (3.C), `src/api/write-plan.ts` (3.D),
  `cli/commands/lists/emission.ts` (passed to 3.D).
- **Public API:** `Model`, `ItemTable`, `ItemKind`, `Item`, `Chunk`, `Module`, `Label`, `ModelFunction`,
  `NameSource`, `ModelJsonHeader`, `ModelJsonChunk`, `FileEntry`, `TextEdit`, `DecompState`,
  `EmitContext`, `WriterId`, `WriteOp`, `WritePlanInputs`, `Manifest`, `VerifyReport`, `RomliftConfig`,
  `ModuleConfig`, `FunctionConfig`, `SymbolConfig`, `OverrideConfig`, `BuildCompiler`,
  `BUILD_COMPILERS`, `Proposal`, `ProposalSource`, `sourceKey`, `LibraryRegion`.
- **Gated by:** typecheck; type-level tests.
- **Ports from the PoC:** nothing.
- **Depends on:** phase 2.

### 3.A Model and layout

- **Owns:** `src/core/model/{items,chunks,modules,labels,names,symbols,model,codec,codes}.ts`,
  `src/core/layout/{types,borders,align,asm-only,entries,refs,tiling,infer-modules}.ts`,
  `src/core/workflow/config-from-discover.ts`, `test/unit/{model,layout}/**`,
  `test/golden/model/**`.
- **Public API:** `buildModel`, `itemAt`, `encodeModel`, `legalBorders`, `inferModules`,
  `configFromDiscover`.
- **Gated by:** unit tests (tiling invariant, borders legal, name scoping, case-folded file names, `runAt`
  plumbing as identity); golden models per fixture.
- **Ports from the PoC:** `tile()` and its border logic, the crt0 grouping, `chunkName`, the
  `main`/`main_2` cut as the starting point of `inferModules` (extended with the asm-only and size rules).
- **Depends on:** 3.0.

### 3.B Printer and code writers

- **Owns:** `src/core/emit/{symbol-resolver,emit-tree}.ts`, `src/core/emit/print/{insn,pool,table,data,raw}.ts`,
  `src/core/emit/writers/{header,crt0,function,orphan,module}.ts` (bodies), `test/golden/writers/{header,crt0,function,orphan,module}/**`.
- **Public API:** `emitTree`, `printChunk`, `resolverFor(model)`.
- **Gated by:** golden writer output per fixture; the raw printer reproduces the PoC's `rawLines` output
  on every fixture.
- **Ports from the PoC:** `rawLines` (as `print/raw.ts`); the macro names of the PoC's
  `include/macros.inc`.
- **Depends on:** 3.0; 1.A's `format`, `roundTrips` and `DIALECT`.

### 3.C Data and linker writers, self-checks

- **Owns:** `src/core/emit/writers/{data,ldscript,symbols}.ts` (bodies),
  `src/core/verify/{tiling,reencode,module-size,text-layout,paths,codes}.ts`,
  `src/foundation/asm/{statements,layout}.ts`, `test/golden/writers/{data,ldscript,symbols}/**`,
  `test/unit/{verify,asm}/**`.
- **Public API:** `verifyModel` (tiling, re-encode, module size), `checkEntry` (text layout),
  `checkPaths`, `parseStatements`, `layoutStatements`.
- **Gated by:** unit tests; `g3.self-check` and `g3.text-layout` on fixtures.
- **Ports from the PoC:** the linker-script and data emission of `writeGenerated`/`scaffold()`, rewritten.
- **Depends on:** 3.0; 1.A's `parse` and `assemble`.

### 3.D Write plan, shell and commands

- **Owns:** `src/core/write-plan/{plan-writes,codes}.ts`, `src/shell/project/{apply-writes,lock}.ts`,
  `src/shell/toolchain/link-check.ts`, `src/core/workflow/generate.ts` (phase-3 form: ROM plus the config
  of `configFromDiscover`), `src/cli/commands/{model,verify}.ts`, `test/unit/write-plan/**`,
  `test/unit/shell/project/**`.
- **Public API:** `planWrites`; `romlift/node`: `applyWrites`, `withProjectLock`, `linkCheck`; CLI `model
  --json`, `verify [--assemble] [--link] [--printer raw]`.
- **Gated by:** `planWrites` unit tests for every ownership policy; apply tests on a temp directory with a
  failure injected after the k-th op; `g3.tree-determinism`.
- **Ports from the PoC:** nothing; `writeGenerated`'s `rmSync` is replaced by the manifest.
- **Depends on:** 3.0; 3.A–3.C for whole runs.

### 3.E Bench emission families

- **Owns:** `bench/src/{readability,objdiff,large-rom}.ts` (and, from fix round 4, D70 b,
  `bench/src/{large-rom-bin,rss-probe,live-heap}.ts` and `test/local/large-rom-bin.test.ts`), `bench/tools/objdiff.version`,
  `test/helpers/large-rom.ts`, the `objectsDir`/`objectsDigest` fields of the five tuning datasets, the
  phase-3 extension of `bench/src/speed.ts` (`generate` and `init` timings) and of `bench/src/run.ts`
  (`--scaffold` with both printers), `test/unit/bench/emission/**`.
- **Public API:** bench-internal only.
- **Gated by:** unit tests; the misnamed-pool-word objdiff fixture test (the objdiff family is measured here and
  gated by `g5.objdiff` in phase 5, D68 a).
- **Ports from the PoC:** the `--scaffold` build step of `src/bench/run.ts`.
- **Depends on:** 3.0; 3.B–3.D for real runs.

### 3.I Integration

- **Owns:** `bench/results.json`, `bench/baseline/speed.json`, `test/mutation/phase3/**`,
  `test/gates/phase.json`.
- **Does:** merges 3.A, 3.C, 3.B, 3.D, 3.E; links the raw and readable printers on all fixtures and the
  five tuning ROMs; fixes printer issues found by the text-layout check; runs objdiff and the speed and
  memory budgets; writes the phase-3 mutation tests; refreshes the artifact; runs the exit commands.
- **Gated by:** every `g3.*` gate.

### Phase 3 exit

```
npm ci
npm run typecheck
npm test
npm run fixtures -- check
npm run test:local
npm run bench -- doctor-real
npm run bench -- run --scaffold
npm run bench -- speed
npm run bench -- regression
npm run bench -- gates --require 3 --tier ci
npm run bench -- gates --require 3 --tier real
```

Thresholds (every one over all six tuning ROMs since tmc's reveal, D60, D62 h): the four self-checks pass
on every fixture and all six tuning ROMs; the raw printer links to the SHA-1 on 6 of 6 tuning ROMs and on
every fixture; the readable printer on every fixture and on at least 3 of 6 tuning ROMs (target 6);
readability shares not lower than the first committed value on any ROM; the objdiff differences of every ROM
that links, sorted by the committed classifier, recorded as the phase's measurement (the gate is `g5.objdiff`,
D68 a); ≤ 3 s CPU analysis per tuning ROM, `generate` ≤ 10 s and `init`-equivalent ≤ 15 s on Emerald
(calibrated); `init` and `generate` on the 32 MiB synthetic ROM complete under the `romlift` bin's heap cap
(`--max-old-space-size=1024`, the owner's answer to Q7, which replaces Q6's 384, itself replacing Q2's 256) with peak
RSS below the budget set again from the recorded runs under that cap with a stated margin (1,536 MiB: the largest of
eight runs, 1,210.1 MiB, plus 25%, rounded up to a multiple of 64 MiB, D72 b), and the six tuning ROMs complete under
the same cap, their peak RSS recorded (D68 b, D69, D72); every command of the `romlift` bin completes on the synthetic
ROM under that cap (`test/local/large-rom-bin.test.ts`, D70 b) and, recorded, on the code-dense doubled ROM, whose
readable `verify` exit 3 is a phase-4 work item (D72 c); every phase-1 and phase-2 gate still passes.

---

## Phase 4: One shot

Entry: phase 3 landed. Branch `phase/4-one-shot`. Seven components: 4.0, then 4.A–4.E in parallel, then
4.I.

### As executed (D74)

Phase 4 runs as eleven components in three waves on the branch `phase-4`, each on its own flat branch
`phase-4-<component>` and worktree (D56 h); sections 4.0–4.I and "Carried from phase 3" below still describe what the
phase delivers. D74 records each deviation and why, and the contracts the lead froze (the workflow types, the scaffold
manifest and placeholders, the C-stub texts, the C build pipeline and object paths, modules.mk's variables, the C-data
ASSERT); [phase-4.md](phase-4.md) records the components, the measured numbers, the owner questions and the closing gate.
Every threshold of the phase applies to the six tuning ROMs (D60; the "five" below reads as six, D74 j).

| Component | Wave | Takes from the sections below |
| --- | --- | --- |
| `p4-lead` | 1 | 4.0: `core/workflow/types.ts`, `core/scaffold/vars.ts`, `templates/MANIFEST.json`, the C-stub constants of `foundation/asm/dialect.ts`, the empty `core/{config,reconcile}/codes.ts`, the barrels (`src/api/{config,config-files,scaffold,scaffold-files,reconcile,workflow-one-shot,one-shot-files}.ts` empty, `src/api/one-shot-types.ts` with the frozen types), `cli/commands/lists/{one-shot,scaffold}.ts`, the `core/verify` edge (D74 g), the g4 gate files aligned, D74, phase-4.md; then 4.I after each wave |
| `p4-emission-carried` | 1 | "Carried from phase 3": padding-only orphans folded into the next function (Q5 b), then the readable `adr` naming a function label (Q7) with its fixture |
| `p4-confirm-listed` | 1 | "Carried from phase 3": the confirm run no longer re-validates the functions configFromDiscover listed (Q5 c, moved from 4.D; scope: owner question Q1) |
| `p4-config` | 2 | 4.A, with `E_PROJECT_NOT_FOUND` in `src/shell/codes.ts` and `test/mutation/phase4/patch-planner.test.ts` |
| `p4-scaffold` | 2 | 4.B without `scaffold --diff`'s command (moved to `p4-workflows`): the templates but `MANIFEST.json`, `renderScaffold`, `readTemplates` |
| `p4-c-modules` | 2 | 4.C, plus configFromDiscover's kind flip to `c` (D62 c), the C units of the text-layout check and of `verify --assemble/--link`, `objectPath` for C modules |
| `p4-fixtures` | 2 | 4.E's fixtures `composite`, `multi-compiler`, `c-data` and the old_agbcc support of the fixture build |
| `p4-safety-minors` | 2 | 4.I's lock and journal mutation tests, and the carried minors architecture-r2-4, correctness-ci-1, correctness-r0-2, gate-honesty-r0-1 |
| `p4-workflows` | 3 | 4.D, `scaffold --diff`, and the project mode of `model`, `verify` and `explain`; the shell codes it raises |
| `p4-e2e` | 3 | 4.E's harness: `test/helpers/e2e.ts`, the TOML mutation property test, `packed.yml`, the fixtures workflow's init step |
| `p4-bench-init` | 3 | 4.E's bench part: `bench run --scaffold` through `init`, `setup.sh` and `make`; `init` and `generate` in `bench large-rom --bin` |

### 4.0 Workflow and scaffold interfaces (lead)

- **Owns:** `src/core/workflow/types.ts` (`InitInputs`, `InitPlan`, `GenerateInputs`, `GeneratePlan`,
  `AnalyzeUpdateInputs`, `AnalyzeUpdatePlan`), `src/core/scaffold/vars.ts`, `templates/MANIFEST.json` (the
  list of scaffold files and their paths), `src/shell/codes.ts`, the empty barrels `src/api/config.ts`
  (passed to 4.A), `src/api/scaffold.ts` (4.B), `src/api/reconcile.ts` (4.C), `src/api/workflow-one-shot.ts`
  (4.D), and the empty command lists `cli/commands/lists/scaffold.ts` (4.B) and
  `cli/commands/lists/one-shot.ts` (4.D).
- **Public API:** the types above, `ScaffoldVars`.
- **Gated by:** typecheck.
- **Ports from the PoC:** nothing.
- **Depends on:** phase 3.

### 4.A Config on disk

- **Owns:** `src/core/config/{keys,parse,serialize,patch,decomp-yaml,codes}.ts`,
  `src/shell/config/{load,save}.ts`, `src/shell/project/locate.ts`, `test/unit/config/**`,
  `test/golden/config/**`.
- **Public API:** `parseConfig`, `serializeConfig`, `planPatch`, `renderDecompYaml`; `romlift/node`:
  `loadConfig`, `saveConfig`, `locateProject`.
- **Gated by:** `g4.toml-canonical`; golden patch tests on real-shaped files; key-spelling and duplicate
  tests.
- **Ports from the PoC:** `project.ts` (`decompYamlText`, `findProject`, `romliftBlock`); `toml.ts` is
  replaced by smol-toml plus the zod schema.
- **Depends on:** 4.0.

### 4.B Scaffold and templates

- **Owns:** `templates/**` (except `MANIFEST.json`): `Makefile`, `setup.sh`, `include/**` (with
  `macros.inc` rendered from `DIALECT`), `AGENTS.md`, `build.yml`, `gitignore`, `README.md`,
  `compilers/{agbcc,old_agbcc}.mk`, `agbcc.json`; `src/core/scaffold/render.ts`,
  `src/shell/project/templates.ts`, `src/cli/commands/scaffold.ts`, `test/golden/scaffold/**`.
- **Public API:** `renderScaffold`; CLI `scaffold --diff`.
- **Gated by:** golden scaffold, including each of `setup.sh`'s five duties.
- **Ports from the PoC:** the Makefile and `include/macros.inc` written by `emit.ts`'s `scaffold()`,
  extended with agbcc, C stubs, `modules.mk` and the setup duties.
- **Depends on:** 4.0.

### 4.C C stubs, modules.mk and the C-data assertion

- **Owns:** `src/core/reconcile/{c-tokens,include-asm,text-edit,codes}.ts` (stub planning: add, and the
  empty-file case), `src/core/emit/writers/{c-stub,modules-mk}.ts`, the `ASSERT` section of
  `src/core/emit/writers/ldscript.ts`, `test/unit/reconcile/**`, `test/golden/writers/{c-stub,modules-mk}/**`.
- **Public API:** `tokenizeC`, `planIncludeAsm`.
- **Gated by:** goldens; `g4.c-data-fails-loud`; `g4.multi-compiler`.
- **Ports from the PoC:** nothing (the PoC has no C stubs).
- **Depends on:** 4.0.

### 4.D Workflows and commands

- **Owns:** the bodies of `src/core/workflow/{init,generate,analyze-update}.ts`,
  `src/shell/project/read-inputs.ts`, `src/shell/toolchain/npm.ts`, `src/cli/commands/{init,generate}.ts`,
  the `--update` branch of `src/cli/commands/analyze.ts`, `test/unit/workflow/**`.
- **Public API:** `init`, `generate`, `analyzeUpdate`; CLI `init`, `generate`, `analyze --update`.
- **Gated by:** `g4.generate-idempotent`, `g4.no-toml-write`, `g4.cli-contract`.
- **Ports from the PoC:** `generate.ts` and `cli.ts`'s `init` flow, without signatures and without
  writing the TOML from `generate`.
- **Depends on:** 4.0; 4.A, 4.B, 4.C for whole runs.

### 4.E End-to-end harness

- **Owns:** `bench/dataset/synthetic/{composite,multi-compiler,c-data}/**`, `.github/workflows/packed.yml`,
  the `init`/`setup.sh`/`make` step of `.github/workflows/fixtures.yml`, `test/helpers/e2e.ts`,
  `test/unit/workflow/toml-mutations.prop.test.ts`, the phase-4 extension of `bench/src/run.ts`
  (`--scaffold` through `init`).
- **Public API:** none.
- **Gated by:** the harness's own unit tests.
- **Ports from the PoC:** the scaffold-and-make loop of `src/bench/run.ts`.
- **Depends on:** 4.0; 4.A–4.D for whole runs.

### 4.I Integration

- **Owns:** `bench/results.json`, `test/mutation/phase4/**`, `test/gates/phase.json`.
- **Does:** merges 4.A, 4.B, 4.C, 4.D, 4.E; runs the plan's command on every fixture and the five tuning
  ROMs, from the source tree and from the packed tarball; runs the worktree check; writes the phase-4
  mutation tests (lock, journal, patch planner); runs the exit commands.
- **Gated by:** every `g4.*` gate.

### Carried from phase 3 (D68 e, the owner's answer to Q5: "Accept Q5a; fix Q5b, c in phase 4"; D72 c, Q7)

Three work items the owner put into phase 4 (two by Q5, one by Q7), each with a test that fails without it, and one
recorded limitation:

- **Padding-only orphans folded into the next function** (Q5 b, delivery-13). With the discover model most orphan
  chunks hold only the zero padding between two functions (`.align 2, 0`: pokeemerald 3,203 of 3,222 orphan files,
  tmc 2,289 of 2,320, fe7j 1,530 of 1,558, sa3 867 of 882, sa2 448 of 464, klonoa 64 of 87). The pad becomes part of
  the next function's chunk, whose `thumb_func_start` already emits it, so the files go and no byte changes. It
  changes the chunk model (`core/model/chunks.ts`, `planChunks`) and plan.md's reading of "No orphan bytes" (a pad
  belongs to the function after it); done before 4.C plans the `INCLUDE_ASM` stubs, so no orphan in a C module
  needs a stub of its own. Owner: 4.0 with 4.C. Measured by the writer goldens, `g3.link` and `g3.raw-link`.
- **The confirm run stops re-validating the functions discover listed** (Q5 c, delivery-4). `generate` over
  `init`'s config warns `W_LISTED_INVALID` on every tuning ROM (fe7j 5, klonoa 4, pokeemerald 6, sa2 4, sa3 4, tmc
  24) for functions romlift's own discover run listed, and phase 4's `init` then `generate` would print them to
  every user. The confirm run takes a function `configFromDiscover` listed without the valid.* rules (an analysis
  change in `core/analysis/driver/confirm.ts`), measured against g2's gates: `g2.confirm-equals-discover`,
  `g2.baseline-rows`, `g2.regression` and the analysis goldens unchanged, and no `W_LISTED_INVALID` on the tuning
  ROMs. Owner: 4.D.
- **Recorded release-1 limitation** (Q5 a, D65 a): a ROM whose size the last unit's section alignment does not
  divide is refused by the text-layout check, and nothing is written.
- **The readable printer's `adr` naming a function label** (D72 c, the owner's answer to Q7 of phase-3.md, "Raise
  cap to 1,024 MiB", which assigns it to phase 4). On a 32 MiB ROM of real code density (pokeemerald twice over,
  SHA-1 `fb17b88d…`, never committed) the readable printer names the target of two Thumb `adr`s of the second copy by
  a function label (`adr r6, sub_0906A708` at 0x0906A56C among them), which the text-layout check refuses as
  unencodable: `verify` exits 3 and nothing is written, while the raw printer's tree links to the SHA-1. The printer
  prints such an `adr` in a form `as` encodes to the ROM's halfword (or raw), with a fixture that fails without the
  fix; measured by the doubled ROM's readable `verify --assemble --link` linking to its SHA-1, `g3.link` and the
  writer goldens. Owner: 4.0.

The minors the review of fix round 2 carried (phase-3.md, "Review", fix round 3) stay with the code they touch:
architecture-r2-1 (TextLayoutIndex exported with its Maps, with the writer contract D66 d reopens), architecture-r2-4
(the case rename is not journalled), and phase-3.md's
known limitation that the TOML patcher must keep `label = true` on the startup code inside the cartridge entry's
extent (4.A).

The four minors of the review of phase 3's landing run (phase-3.md, "Review", the review of the landing run at
`ef2be76`) are carried here too: gate-honesty-r0-1 (`bench/src/families.ts`'s readability summary still says "objdiff
score 0", which is `g5.objdiff` since D68 a; text only), correctness-r0-1 (sa2's `g2.speed` sits at about 90 to 100%
of its limit at `main` itself; the owner is asked before phase 4's landing run whether to re-baseline or take the
median of more runs; answered on 20 October 2026, Q2 of phase-4.md, "Median of more runs", D76 b: `g2.speed` takes the
median of nine serial runs per ROM instead of five, with the limits and `bench/baseline/speed.json` unchanged; and,
by fix round 2 of phase 4, D77 f, `g3.speed-budget`'s 3 s analysis budget reads `budgetAnalysisCpuMs`, the median of
the first five of those nine runs, the measurement it made before D76 b), and correctness-r0-2 (a unit test of the built launcher's first line, and the `env -S`
requirement recorded as a known limitation); correctness-r0-3 was fixed in the record. The phase pull request's CI
found one more (correctness-ci-1, phase-3.md, "The closing gate", the phase pull request's CI): `exitQuietlyOnEpipe`
in `src/cli/main.ts` treats only EPIPE as a closed reader, and macOS can report ENOTCONN on a socket-pair stdout, which
made `test/unit/cli/process.test.ts`'s early-close test flaky on macOS; ENOTCONN is handled like EPIPE, with a test.

### Phase 4 exit

```
npm ci
npm run typecheck
npm test
npm run fixtures -- check
npm run build && npm pack                         # then packed.yml's steps locally
npm run test:local
npm run bench -- doctor-real
npm run bench -- run --scaffold
npm run bench -- regression
npm run bench -- gates --require 4 --tier ci
npm run bench -- gates --require 4 --tier real
```

Thresholds: in a directory holding only the ROM, `npx romlift init <rom> && ./setup.sh && make` ends at the
SHA-1 on every fixture and all five tuning ROMs, with no file edited, from the source tree and from the
installed tarball; `generate` right after `init` changes no file; the same holds in a fresh `git worktree`;
every seeded legal TOML edit still links; the composite fixture's illegal border fails with
`E_MODULE_BORDER`; every earlier gate still passes.

The owner's answers of 21 October 2026 (phase-4.md Q8 and Q9, D79): the 11 zero pads that end a `c` module right
after a function stay orphans ("Keep as orphans", a known limitation; `padding-orphans` pins the counts), and the
scaffold's `.gitignore` ignores the generated roots ("Gitignore, as R4 says"): a fresh clone or worktree builds
through setup.sh's duty 5, and `g4.worktree` requires that nothing generated is committed.

---

## Phase 5: Migration

**Skipped by the owner** (20 October 2026: "We don't need it. Skip phase 5", and "Keep rename and objdiff", D76 g).
Legacy import, the Klonoa migration tooling and the switch-over are dropped; rename and the reconciler, the `expected/`
and `objdiff.json` writers, the C data ranges and the objdiff gate move into phase 6, which records both decisions and
rewrites this plan. The sections below are the plan as written before that decision.

Entry: phase 4 landed. Branch `phase/5-migration`. Six components: 5.0, then 5.A–5.D in parallel, then
5.I, which also produces the Klonoa switch-over pull request.

### 5.0 Evidence and legacy interfaces (lead)

- **Owns:** `src/core/evidence/{facts,codes}.ts` (`entry` and `symbol` facts, `EvidenceSource`),
  `src/foundation/formats/types.ts` additions (legacy parser types), the `data_start` key in
  `src/core/config/schema.ts`, `bench/migration/klonoa.json` (`base: 693ccb7`; `switch` empty),
  the empty barrel `src/api/evidence.ts` (passed to 5.B), the empty command lists `cli/commands/lists/rename.ts` (5.A) and
  `cli/commands/lists/legacy.ts` (5.B);
  `src/api/reconcile.ts` passes from 4.C's ownership to 5.A.
- **Public API:** `EvidenceFact` (phase-5 kinds), `EvidenceSource`, `mergeEvidence` type.
- **Gated by:** typecheck.
- **Ports from the PoC:** nothing.
- **Depends on:** phase 4.

### 5.A Reconciler and rename

- **Owns:** `src/core/reconcile/rename-tokens.ts`, the move and remove cases of
  `src/core/reconcile/include-asm.ts`, the `edit` operations of `src/core/write-plan/plan-writes.ts`,
  `src/core/workflow/rename.ts`, `src/cli/commands/rename.ts`, the matchings split of
  `src/core/emit/writers/function.ts`, `test/golden/reconcile/**`.
- **Public API:** `planRename`, `rename`; CLI `rename`.
- **Gated by:** `g5.reconciler`, `g5.rename`.
- **Ports from the PoC:** nothing.
- **Depends on:** 5.0.

### 5.B Legacy import and evidence merge

- **Owns:** `src/foundation/formats/{luvdis-cfg,ldscript-symbols,thumb-aliases}.ts`,
  `src/core/legacy/{facts,renames-toml}.ts`, `src/core/evidence/merge.ts`,
  `src/shell/evidence/{read-elf,read-map,read-legacy}.ts`, `src/core/workflow/import-legacy.ts`,
  `src/cli/commands/import-legacy.ts`, the `--evidence` branch of `src/cli/commands/analyze.ts`,
  `test/unit/{legacy,evidence}/**`.
- **Public API:** `parseLuvdisCfg`, `parseLdscriptSymbols`, `parseThumbAliases`, `parseRenamesToml`,
  `mergeEvidence`, `importLegacy`; CLI `import-legacy [--adopt-boundaries]`, `analyze --evidence`.
- **Gated by:** `g5.evidence-merge`; unit tests on Klonoa-shaped legacy files written by hand.
- **Ports from the PoC:** nothing (the PoC has no legacy import).
- **Depends on:** 5.0.

### 5.C objdiff targets and C data ranges

- **Owns:** `src/core/emit/writers/{expected,objdiff}.ts`, the data-range handling in
  `src/core/model/modules.ts` and in `src/core/emit/writers/ldscript.ts` (replacing the phase-4
  assertion), `bench/dataset/synthetic/c-data/expect-ranges.json`, `test/golden/writers/{expected,objdiff}/**`.
- **Public API:** the two writers.
- **Gated by:** `g5.expected-bytes` (fixtures), `g5.c-data-ranges`, `g5.objdiff` (moved from phase 3 by the owner's
  answer to Q1 of phase-3.md, "Move gate to phase 5", D68 a: on every tuning ROM whose readable build links, every
  agreeing function scores 0 under objdiff-cli but `unnamed-target`, as D34 writes it unless the owner amends it
  then). The phase-3 classifier (`bench/src/objdiff-classes.ts`) and its carried minors (architecture-r2-2: one
  REL/RELA addend decoder with `foundation/formats/elf.ts` and the R_ARM_*/SHT_* constants in one place;
  architecture-r2-3: fixture tests for objdiffDifferences' sectionBase and baseField plumbing) come with it.
- **Ports from the PoC:** nothing.
- **Depends on:** 5.0.

### 5.D Klonoa migration tooling

- **Owns:** `bench/migration/{klonoa.sh,klonoa-import.json}`, `bench/src/migration.ts` (joins the
  import report with kleod's ELF; checks `.tainted` files for the diff report).
- **Public API:** none.
- **Gated by:** the tooling's unit tests on a synthetic legacy repository.
- **Ports from the PoC:** nothing.
- **Depends on:** 5.0; 5.A–5.C for the real run.

### 5.I Integration and the switch-over

- **Owns:** `bench/results.json`, the `switch` pin of `bench/migration/klonoa.json`,
  `test/gates/phase.json`; in the Klonoa repository, a feature branch (that repository's own policies
  apply: feature branch from `main`, `make compare` after each change).
- **Does:** merges 5.A, 5.B, 5.C, 5.D; runs `klonoa.sh` at `base`; in the Klonoa repository, on a feature
  branch, removes `generate_asm.py`, `generate_expected.py`, `generate_ldscript.py` and the Luvdis
  submodule, runs `romlift import-legacy` (keep mode) and `romlift generate`, checks `make` prints
  `klonoa-eod.gba: OK`, commits, opens the pull request, and pins its commit as `switch`; runs the exit
  commands.
- **Gated by:** every `g5.*` gate.

### Phase 5 exit

```
npm ci
npm run typecheck
npm test
npm run bench -- doctor-real
bash bench/migration/klonoa.sh                    # prints klonoa-eod.gba: OK
npm run bench -- run --scaffold
npm run bench -- regression
npm run bench -- gates --require 5 --tier ci
npm run bench -- gates --require 5 --tier real
```

Thresholds: at `693ccb7` the import report lists 282 legacy entries inside found functions, 1 failing
validation and unlisted discoveries of which 183 are ELF functions; the rehearsal and the `switch` commit
both build to `klonoa-eod.gba: OK` without the four legacy tools; every `expected/<module>.s` symbol equals
the ROM; objdiff 0 differences other than `unnamed-target` on every agreeing function of every tuning ROM that
links (`g5.objdiff`, D34, D68 a); every earlier gate still passes.

---

## Phase 6: Evidence

Entry: phase 4 landed (phase 5 is skipped, D76 g). Branch `phase/6-evidence`. Six components: 6.0, then 6.A–6.D in parallel, then 6.I.
Signature files stay local and gitignored unless the owner decides otherwise (D40). Since the owner skipped phase 5
(D76 g), phase 6 takes rename and the reconciler, the `expected/` and `objdiff.json` writers, the C data ranges and the
objdiff gate from phase 5, drops the gba-kit trace integration, records both decisions and rewrites this plan; its
entry is phase 4 landed.

### Carried from phase 4 (D76 g, h)

Each changes code without a defect behind it, and phase 6 reworks the same modules. Nothing here depends on
`g5.import-legacy`.

- **correctness-r0-5's remainder** (from phase 3, carried again; phase-4.md, "The carried minors"): pool.ts calls
  `moduleAt` once per address with labels; thread the relocated-module list through `wordText`, `labelForWord` and
  their callers with the matchings split.
- **The C-data ASSERT's text** (done in fix round 3, D78 c): the ldscript's message and the scaffold's `AGENTS.md`
  name no phase ("romlift does not place C data yet"); phase 6's data ranges replace the ASSERT.
- **architecture-r1-2**: delete the aliases of `BASEROM_FILE` (`BASEROM_PATH`, `SCAFFOLD_ROM_FILE`, `TARGET`, the
  decomp-yaml re-export) and import it and the file-name constants from `foundation/util/project-files.ts`; keep every
  default spelling and its parser in one module and remove one of `functionName` and `defaultFunctionName`.
- **architecture-r1-3**: core/layout owns the whole legal-start rule (for example `isLegalStart(layout, addr)` beside
  `borders`), `core/model/modules.ts` and `describeBorders` use it, `planModules` takes only `BorderRule`, and
  architecture §6.2's "legalBorders … all use it" sentence is updated.
- **architecture-r1-4**: pass the module's compiler into `stubUnitAssembly`/`stubAssemblyText` and use
  `buildCompilerOf(module.compiler).banner`, an invariant error when unknown, as `moduleCompile` does; or drop the
  field and keep one documented constant without the `?? ''`.
- **architecture-r1-6** (widened by architecture-a2-8): there are three `readAgbccPin`, the shell's public one
  (`src/shell/project/templates.ts`, exported through `src/api/scaffold-files.ts`), `bench/src/scaffold.ts`'s and
  `test/helpers/e2e.ts`'s; the bench and the e2e helper both call the shell's, and one pin-stamp check replaces
  `agbccCacheCurrent` (bench) and e2e's `stalePrebuilt` (or one function with a stated policy for an unstamped
  prebuilt).
- **architecture-a2-6** (fix round 4, D80 d): which files `init` owns (romlift.toml, decomp.yaml, the ROM) is spelled
  in the shell (`initTexts`, `initDigests` in `shell/project/write-project.ts`), not in core's plan as D75 j's split
  says; `core/workflow/init.ts` should return them as `[path, text]` pairs in `InitPlan` and the shell only write and
  hash them. It changes the frozen `InitPlan` (D74 c) with no defect behind it, and phase 6's rename reworks init's
  plan.
- **architecture-r1-7's remainder**: move `initDirVerdict`/`replacedProblems` tests to
  `test/unit/workflow/init.test.ts` and the project-plan tests to `test/unit/write-plan/project-plan.test.ts`
  (`test/unit/workflow/c-stubs.test.ts` landed in fix round 2, D77).
- **architecture-r1-2, also**: `src/shell/project/locate.ts` re-exports `DECOMP_YAML_NAMES`, and
  `shell/project/write-project.ts` takes the three file names from three modules; one import from
  `foundation/util/project-files.ts` each (architecture-a0-10).
- **architecture-r1-3, also** (architecture-a0-4): `legalBorders` has no caller in `src`; the model uses `codeLayout`
  with its own `isLegalStart` and data-start rule, and `analyze --update --write` never checks the patched config's
  borders. Either it checks the patched config with `planModules` before it offers `--write`, or the limitation
  recorded in phase-4.md stays (a newer discover's unlisted function whose extent covers a `c` module start is added,
  and `generate` then refuses the patched TOML with `E_MODULE_BORDER`).
- **architecture-r1-3, and the gate oracle** (architecture-a1-5): `g4.toml-mutations` and
  `test/unit/workflow/toml-mutations.prop.test.ts` pick their legal moves and splits from `legalBorders(rom,
  analysis)` over the discover run, while `generate` decides legality with `codeLayout` over the confirm run plus the
  data-start clause of D75 a. With core/layout's single legal-start predicate, the gate and the property test use it
  over the confirm run of init's config, and so also mutate a start in the data-start range D75 a made legal.
- **The remaining "phase 5" comments**: code comments that name phase 5 for work phase 6 now does were pointed to
  phase 6 in fix round 2 (D77 i), and the product text in fix round 3 (D78 c). The `g5.*` gate files keep their ids,
  `phase: 5` and headers until phase 6 renames, renumbers or drops them (D76 g; `g4.cli-contract`'s recipes for the
  dropped `import-legacy` and `trace` were removed in fix round 3, D78 g).
- **architecture-a1-4** was fixed in fix round 3 (D78 f): `includeAsmDir`, `includedChunkFile`, `stubName` and
  `core/model/paths.ts`'s `nonmatchingDir` re-export are gone; `stubNameOf` and `INCLUDE_DIR` live in
  `foundation/util/project-files.ts`. `NONMATCHINGS_ROOT` stays exported once, from `api/one-shot-types.ts`.
- **architecture-r1-8's remainder**: remove `checkEntry` from `core/verify/text-layout.ts` (thirty text-layout tests
  call it; a one-entry `checkEntries` adds stream-level diagnostics, so the tests need a helper of their own).
- **correctness-b0-3's remainder** (fix round 5, D81 c): `[[overrides]]` without `runs_at` are applied by no
  analysis rule; phase 4 warns `W_OVERRIDE_IGNORED` for each one that changes nothing (a known limitation). Phase 6
  makes a `data` override claim its span and suppress code there, and a `code` override seed `seed.override` at its
  start (the rule exists; no seed of it is built), and, with the owner's leave since it changes a gate, makes
  `g4.toml-mutations`' add-override edit one that changes the model (today it covers a found function exactly, a
  no-op that now warns). Nothing here depends on `g5.import-legacy`.
- **correctness-b0-4's gate case** (fix round 5, D81 c): `E_FUNCTION_MISALIGNED` is tested by unit and CLI tests;
  adding an odd `[functions]` key to `g4.toml-mutations`' illegal edits changes a gate, which the owner has not
  authorised in phase 4. Since fix round 6 the config raises it (D82 d).
- **Code whose only producers the owner dropped** (fix round 6, architecture-b1-8; D76 g): the rule
  `seed.evidence-hint` (`src/core/analysis/rules/seed/evidence-hint.ts`, ordered in `src/core/profile/agbcc.ts`, its
  rule id in `analysis/types.ts` `Seed['rule']` and `codec.ts`) has no seed producer now that the trace integration
  is dropped; the `ProposalSource` variants `{kind: 'legacy'}` and `{kind: 'evidence', id: 'trace'}`
  (`src/core/proposals/types.ts`) and their `sourceKey` spellings (`legacy`, `evidence:trace`) have none now that legacy
  import is dropped; `shell/evidence/read-trace.ts` and `foundation/formats/trace-json.ts` serve only the trace.
  Phase 6's plan rewrite keeps each (a new producer) or deletes it with its tests, codec spelling and architecture
  entries; `seed.override` is carried above with the override semantics.
- **architecture-b2-9** (fix round 7, D83 f): `core/reconcile/include-asm.ts` (about 1,050 lines) holds the C scanner,
  the "C defines it" rule, include resolution and fragments, the header insertion and the planner. Split the scanner
  and the definition rule (`scanC`, `conditionalsOf`, `compiledDefinitions`, `CFileScan`, `CDefinition`) into
  `core/reconcile/c-scan.ts` beside `c-tokens.ts`, and update architecture §2's `core/reconcile` list. Carried: a pure
  move of about 500 lines with every importer and test, no defect behind it, and phase 6's `rename-tokens.ts` adds the
  next reader of the scanner, so the split lands with it.
- **architecture-b2-8's remainder** (fix round 7, D83 e): the analysis keeps its own alignment bit tests
  (`rules/valid/in-rom-unclaimed.ts`, `walk/thumb.ts`, `walk/arm.ts`, `rules/gap/arm-scan.ts`, `rules/seed/ram-copy.ts`,
  `core/model/labels.ts`); route them through `insnAligned` (in-rom-unclaimed taking the entry's mode). Carried: it
  changes analysis rules, whose goldens and `bench regression` must be re-measured, with no defect behind it; the
  docstring now names only the two readers it has (D83 e amends D82 d).
- **architecture-b2-11's remainder** (fix round 7, D83 d): the disk snapshot (`WritePlanInputs.disk`,
  `ProjectWriteState`) is still typed `string | 'absent'`, which TypeScript widens to `string`; type it with a closed
  union, as `EditedFileState` is. The absence rule itself is one since fix round 7 (`digestOf`, ENOENT and ENOTDIR,
  read by the snapshot and by `applyWrites`' check). Carried: a type change across the write plan with no defect behind it.
- **correctness-b2-3's remainder** (fix round 7, D83 d): `modules.mk` records only `romlift.toml`'s SHA-1, so a pull that
  changes the romlift version `package.json` pins leaves a tree the old version generated, which neither `make` nor
  `setup.sh` notices; the scaffold's `AGENTS.md` and `README.md` say to run `./setup.sh` and then `npx romlift
  generate` (a known limitation, phase-4.md). With romlift published (Q5), record the version in `modules.mk`
  (`ROMLIFT_VERSION`) and have duty 5 regenerate when it differs from the installed one.
- **architecture-r1-2, also** (architecture-b2-7, b2-12): fix round 7 removed `core/model/paths.ts`'s `isCSource`
  re-export; the internal layers import `C_SOURCE_DIR`, `isCSource` and `cSourceOf` from
  `foundation/util/project-files.ts`, and only the public `api/` modules re-export project-files spellings
  (`isCSource`, `nonmatchingDir`, `INCLUDE_ASM_HEADER_PATH`, `NONMATCHINGS_ROOT`; fix round 8, architecture-c0-4). The
  other aliases of r1-2 stay carried as written above.

### 6.0 Signature and trace interfaces (lead)

- **Owns:** `src/core/signatures/{schema,spec}.ts`, `src/core/signatures/rules/index.ts` (empty record),
  the trace fact kinds in `src/core/evidence/facts.ts`, the `signature` part of `ExplainReport` in
  `src/core/workflow/explain.ts` (the type only), the empty barrels `src/api/signatures-build.ts` (passed to
  6.A), `src/api/signatures-match.ts` (6.B), `src/api/trace.ts` (6.C), and the empty command lists
  `cli/commands/lists/{signatures-build,signatures-match,trace}.ts` (passed likewise).
- **Public API:** `SignatureFile`, `LibraryVersion`, `MemberId`, `SignatureFunction`, `SignatureTable`,
  `SignatureSpec`, `SignaturePlacement`; trace `EvidenceFact` kinds.
- **Gated by:** typecheck.
- **Ports from the PoC:** the schema-2 types of `signatures/build.ts`, as the starting point of schema 3.
- **Depends on:** phase 4 (phase 5 is skipped, D76 g).

### 6.A Signature builder and specs

- **Owns:** `src/core/signatures/{extract,codes}.ts`, `src/shell/signatures/{build-from-references,locate}.ts`,
  `src/cli/commands/signatures-build.ts`, `signatures/specs/*.json` (m4a, libagbsyscall, libgcc,
  agb_flash, siirtc, librfu, with reviewed names), `bench/dataset/synthetic/library/**`,
  `bench/tools/convert-poc-signatures.ts`, `test/unit/signatures/build/**`.
- **Public API:** `extractSignatures`; `romlift/node`: `buildSignatures`, `locateSignatures`; CLI
  `signatures build <spec>`.
- **Gated by:** `g6.signatures-rebuild`, `g6.no-heldout-references`.
- **Ports from the PoC:** `signatures/build.ts` (masking, reference merging), its specs.
- **Depends on:** 6.0.

### 6.B Matcher and placement rules

- **Owns:** `src/core/signatures/{match,resolve,policy,propose}.ts`, `src/core/signatures/rules/**` (the
  `index.ts` created empty by 6.0 included), `src/cli/commands/signatures-match.ts`, `bench/src/signatures.ts`
  (judged, held-out counts, leave-one-reference-out), `test/unit/signatures/match/**`.
- **Public API:** `matchSignatures`, `resolvePlacements`, `proposeFromSignatures`; CLI `signatures <rom>`.
- **Gated by:** unit tests per placement rule; `g6.signatures-judged`, `g6.signatures-heldout`,
  `g6.signatures-loo`.
- **Ports from the PoC:** `signatures/apply.ts` (`fits`, `wordDiffs`, `applyVersion`, the overlap
  resolution), minus `applyOverlay`, which becomes proposals.
- **Depends on:** 6.0; 6.A for built files.

### 6.C Trace and code run from RAM

**Dropped in part by D76 g, pending phase 6's rewrite of this plan:** the owner dropped the gba-kit trace integration,
so `src/shell/trace/gba-kit.ts`, `runTrace`, the CLI `trace` and the gba-kit pull request below are not built, and
nothing in the plan waits on them; what reads a trace file and maps code run from RAM is phase 6's to re-plan.

- **Owns:** `src/foundation/formats/trace-json.ts`, `src/shell/evidence/read-trace.ts`,
  `src/shell/trace/gba-kit.ts`, `src/cli/commands/trace.ts`, the non-identity `AddressMap` path in
  `src/core/analysis/address-map.ts` and the walk cursor's run-space targets, the `runs_at` emission of
  `src/core/emit/writers/ldscript.ts`, the RAM-copy fixture's phase-6 expectations, and, in the gba-kit
  repository, the pull request that turns the tracing code into a supported trace API.
- **Public API:** `parseTrace`; `romlift/node`: `runTrace`; CLI `trace`.
- **Gated by:** `g6.ram-code-mapped`, `g6.evidence-conflict`.
- **Ports from the PoC:** nothing (the plan's 150 lines of tracing code live in gba-kit sessions).
- **Depends on:** 6.0.

### 6.D Proposals plumbing and full explain

- **Owns:** the signature and evidence proposal steps of `src/core/workflow/{init,analyze-update}.ts`,
  the `LibraryRegion` wiring into `src/core/layout/infer-modules.ts`, the `signature` part of
  `src/core/workflow/explain.ts` (read from `from`), `test/golden/explain/sig/**` (from the library
  fixture only).
- **Public API:** none new; `init` and `analyze --update` gain signature and evidence proposals.
- **Gated by:** `g6.explain-coverage`.
- **Ports from the PoC:** the overlay-to-TOML path of `generate.ts`/`emit.ts`, rewritten as proposals
  written by `init` and `analyze --update` only.
- **Depends on:** 6.0; 6.A–6.C for whole runs.

### 6.I Integration

- **Owns:** `bench/results.json`, `test/gates/phase.json`.
- **Does:** merges 6.A, 6.B, 6.C, 6.D; builds every signature file locally from the specs and compares it
  with the PoC's converted files; runs the judged, held-out and leave-one-out runs; records a Klonoa
  trace and checks the `0x0804F318 → 0x03000388` mapping; runs every gate of every phase; runs the exit
  commands.
- **Gated by:** every `g6.*` gate and every earlier gate.

### Phase 6 exit

```
npm ci
npm run typecheck
npm test
npm run fixtures -- check
for s in signatures/specs/*.json; do npx romlift signatures build "$s"; done
npm run test:local
npm run bench -- doctor-real
npm run bench -- run --scaffold
npm run bench -- regression
npm run bench -- gates --require 6 --tier ci
npm run bench -- gates --require 6 --tier real
```

Thresholds: signature placements meet the PoC's table as a floor (Klonoa: 94 m4a functions, 6 syscall
wrappers, 20 libgcc routines, 10 tables, and the other four ROMs' rows), every placement at an ELF `FUNC`
or a listed untyped address, every proposed `size` equal to the ELF size, every name on a reference ROM
equal to that reference's symbol, leave-one-out adding or moving no placement; no spec names a sealed
dataset; the Klonoa trace maps `0x0804F318` to `0x03000388` and the RAM-copy fixture links; every rule id
appears in an explain golden; `npm pack --dry-run` lists no built signature file; every gate of phases 1
to 6 passes.

---

## Component count

| Phase | Components | Parallel |
| --- | --- | --- |
| 1 Decoder | 6 (1.0, 1.A–1.D, 1.I) | 4 |
| 2 Analysis | 7 (2.0, 2.A–2.E, 2.I) | 5 |
| 3 Emission | 7 (3.0, 3.A–3.E, 3.I) | 5 |
| 4 One shot | 7 (4.0, 4.A–4.E, 4.I) | 5 |
| 5 Migration | 6 (5.0, 5.A–5.D, 5.I) | 4 |
| 6 Evidence | 6 (6.0, 6.A–6.D, 6.I) | 4 |
| Total | 39 | 27 |
