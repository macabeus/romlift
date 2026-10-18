# Phase 3: Emission

The record of phase 3 (roadmap "Phase 3", architecture §3.4, §5, §6, §8.4, §9.4, D14 to D17, D19 to D21,
D34, D41, D42, D44 to D47, D49, D62). It is kept by the phase lead: the components as they merge, every
deviation from the roadmap, the measured numbers, the owner questions and the closing gate. Every number is
measured on the owner's machine with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. The tuning set is six ROMs (fe7j, klonoa,
pokeemerald, sa2, sa3, tmc; D60), and every phase-3 threshold applies to all six (D62 h); the held-out ROMs
(pokefirered, pokeruby) run sealed and report counts only (D25).

## Components

Three waves on the branch `phase-3`, each component on its flat branch `phase-3-<component>` (roadmap.md,
"As executed (D62)").

| Component | Wave | Branch | Status | Delivered |
| --- | --- | --- | --- | --- |
| `p3-lead` | 1 | `phase-3-lead` | merged (`3f0b341`) | the frozen types, the shared primitives (item table, resolver, paths, manifest and journal codecs), the writer registry, the empty codes files and barrels, the analysis goldens, the model test helper, the g3 gate files aligned, D62 |
| `p3-asm-text` | 1 | `phase-3-asm-text` | merged (`aa2e7cc`) | `foundation/asm/{statements,layout}.ts` |
| `p3-bench-inputs` | 1 | `phase-3-bench-inputs` | merged (`1c758c3`) | objdiff-cli version and locator, reference objects, the large-ROM image |
| `p3-model` | 2 | `phase-3-model` | merged (`8b67323`) | `buildModel`, `encodeModel`, `legalBorders`, `inferModules`, `configFromDiscover` |
| `p3-printer` | 2 | `phase-3-printer` | merged (`51634b9`) | `emitTree`, `printChunk`, the header, crt0, function, orphan and module writers |
| `p3-data-verify` | 2 | `phase-3-data-verify` | merged (`42eabbb`) | the data, ldscript and symbols writers, `verifyModel`, `checkEntry`, `checkEntries`, `checkPaths` |
| `p3-write-plan` | 2 | `phase-3-write-plan` | merged (`27138d2`) | `planWrites`, `applyWrites`, `withProjectLock`, `linkCheck`, `assembleCheck` |
| `p3-generate` | 3 | | | `generate` (phase-3 form), `model --json`, `verify`, `explain`'s item and chunk, `bench/src/large-rom.ts` |
| `p3-bench-scaffold` | 3 | | | `bench run --scaffold` (both printers), readability, objdiff, `bench speed` emission timings, `bench large-rom` |

### p3-lead (wave 1)

- Frozen types: `core/model/types.ts` (with the public `ModelJsonHeader`, `ModelJsonChunk` and the item
  codes), `core/emit/tree.ts` (with the writer contract and the stream order), `core/write-plan/types.ts`,
  `core/verify/report.ts`, `core/config/{schema,compilers}.ts`, `core/proposals/types.ts`,
  `core/layout/types.ts`.
- Shared primitives, implemented and unit-tested: `core/model/item-table.ts`, `core/model/resolver.ts`,
  `core/model/paths.ts`, `core/write-plan/{manifest,journal}.ts`, `sourceKey`, `validateConfig`,
  `combineReports`, `addPrintStats`.
- The eight phase-3 writer files, each yielding nothing until its owner fills it, and their registry.
- Empty `core/{model,verify,write-plan}/codes.ts`, unioned into `core/diagnostic-codes.ts`.
- Barrels: `src/api/{config-types,model,layout,emit,internal-emit,verify,write-plan,project,workflow-generate}.ts`
  and `cli/commands/lists/emission.ts` (empty).
- `test/golden/analysis/<fixture>.json` for the 47 committed fixtures, `test/helpers/model.ts`.
- The g3 gate files aligned to the frozen API (needs lists, the `verify --json` check ids, six tuning ROMs in
  the comments); no threshold changed.

### p3-asm-text (wave 1)

- `foundation/asm/statements.ts`: `parseStatements(text, { includes })` parses the directive subset romlift
  emits into `Statement`s (`label`, `mode`, `align`, `data`, `inst`, `insn`, `incbin`, `include`, `symbol`,
  each with its `line`); errors are values. `foundation/asm/layout.ts`: `layoutStatements` lays them out to
  bytes, labels and aligns the way GNU as and ld place them (checked against binutils 2.45.1). Not re-exported
  by a barrel; wave 2's `core/verify` imports them directly.
- Points wave 2 relies on: `inst` carries its `directive` and accepts `.inst.w` (the raw Thumb bl pair
  `formatRaw` prints; `word` is first halfword | second << 16); a switch from Thumb to ARM pads to a word
  with zeros, so an ARM chunk's padding is emitted by the preamble's `.arm` and `aligns` lists those pads
  beside every `.align` (p3-data-verify matches a padding item to the line that emitted it); an `.align`
  without a fill byte that pads is refused, because the text alone cannot tell which no-op GNU as fills.

### p3-bench-inputs (wave 1)

- `bench/src/objects.ts` and `objectsDir`/`objectsDigest` on the six tuning datasets, checked by
  `doctor-real` (`<rom>.objects-linked`); `bench/src/objdiff-cli.ts` with the pinned
  `bench/tools/objdiff.version` (3.7.2) and the self-authored `test/fixtures/objdiff/`; the deterministic
  32 MiB synthetic ROM (`bench/src/large-rom-image.ts`, re-exported by `test/helpers/large-rom.ts`, SHA-1
  `b846b9453414ce93afc5e8fd559eaac582dc570e`). The measurements are in benchmark-roms.md.
- klonoa's reference objects come from the clone `kleod-5b25cd6/` (benchmark-roms.md, "Reference objects").

### Wave 2 (merged in order: model, printer, data-verify, write-plan; no textual conflict)

- `p3-model` (`fa50010`, `012508e`, `b904c3e`): `core/layout/{borders,infer-modules}.ts`,
  `core/workflow/config-from-discover.ts`, `core/model/{items,chunks,modules,labels,names,symbols,model,codec,codes}.ts`,
  the model codes, 47 model goldens (`test/golden/model/<fixture>.ndjson`). `legalBorders`, `inferModules` and
  `configFromDiscover` take the ROM and no profile (D63 a).
- `p3-printer` (`927834c`): `core/emit/emit-tree.ts`, `core/emit/print/{insn,pool,table,data,raw,chunk}.ts`, the
  header, crt0, function, orphan and module writers; `printChunk` takes a `Printer` or an `EmitContext`; chunk
  files start with `.thumb`/`.arm`, unit files with the preamble (D63 e); `printRawRange` in `romlift/internal`.
- `p3-data-verify` (`11e0831`): the data, ldscript and symbols writers; `verifyModel` (tiling, re-encode, module
  size), `checkEntry`, `checkEntries`, `checkPaths`/`pathsCheck`, the five verify codes; the mutation tests
  `test/mutation/phase3/{tiling,reencode,module-size,text-layout}.test.ts`.
- `p3-write-plan` (`52033f1`, `9eab1a4`): `planWrites`, the write-plan codes, `applyWrites`, `withProjectLock`,
  `readDiskState`/`readManifest`/`readJournal`, `linkCheck` and `assembleCheck` in `romlift/node`, the mutation
  test `test/mutation/phase3/plan-writes.test.ts`; `WritePlanInputs.journal` and `.romlift` (D63 e).

### Wave-2 integration (D63)

Linking the merged components found what each component alone could not: the readable printer's tree did
not assemble on 2 of 47 fixtures (`adr-label-and-data`, `arm-pools-in-front`: a PC-relative load or `adr` of a
label in another module) or on any tuning ROM (a `local` label inside an item: the m4a mixer's `adr r0, X + 1`
on five ROMs, an `adr` naming a `bl`'s second halfword on tmc), with every self-check green. Fixed on the
integration commit: no PC-relative load or `adr` crosses a legal border (D63 b), the data start moves past the
code's PC-relative words (D63 c, tmc only: 0x080B2A30 → 0x080B2A70), a `local` label only where an item can start
(D63 d); `test/gates/g4.toml-mutations.test.ts` aligned to `legalBorders(rom, analysis)`; architecture §5, §6.2
updated; `test/unit/emit/fixtures-round-trip.test.ts` added (D63 f). Two model goldens changed
(`adr-label-and-data`, `arm-pools-in-front`), no other.

Measured on the integrated tree (Node 24.15, binutils 2.45.1; a scratch script in one process per ROM:
`discover`, `configFromDiscover`, `buildModel`, `verifyModel`, `emitTree`, `checkEntries`, then `linkCheck` on
the written tree; wall times):

| Target | Model checks | Text layout + paths | Readable link | Raw link | discover | buildModel | Modules |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 47 fixtures | 47 ok | 94 ok | 47 SHA-1 | 47 SHA-1 | | | |
| klonoa | ok | ok | SHA-1 | SHA-1 | 335 ms | 159 ms | 28 |
| sa2 | ok | ok | SHA-1 | SHA-1 | 626 ms | 235 ms | 22 |
| sa3 | ok | ok | SHA-1 | SHA-1 | 981 ms | 335 ms | 25 |
| fe7j | ok | ok | SHA-1 | SHA-1 | 875 ms | 347 ms | 57 |
| pokeemerald | ok | ok | SHA-1 | SHA-1 | 1,726 ms | 713 ms | 43 |
| tmc | ok | ok | SHA-1 | SHA-1 | 1,140 ms | 310 ms | 40 |

Before the fix: readable link 45 of 47 fixtures and 0 of 6 tuning ROMs; raw link 47 and 6. No model error on
any tuning ROM's own config after it (before (c), (b) alone gave tmc `E_MODULE_BORDER` on its data module).
These are not the gate runs: `g3.*` stay `pending` until wave 3 exports `generate`, `verify` and the bench
families; the closing gate measures them.

## Deviations from the roadmap

Recorded in D62: eight components in three waves instead of 3.0, 3.A–3.E, 3.I; the resolver, item table and
paths in `core/model`, no `core/emit/symbol-resolver.ts`; `config-from-discover.ts` in `core/workflow`;
`EmitContext.printer`, `PrintStats`, `PrintedChunk`, the `Writer` contract; `WritePlanInputs.retained` and
`WritePlan`; `ProposalSource` `'layout'` and `sourceKey` undefined for unpersisted sources; `checkEntry` checks
one entry; `itemAt`'s run offset; no `dataStart` before phase 5; the phase-3 mutation tests owned by the
checkers' components; `g3.text-layout` requires the `paths` check too; every threshold over six tuning ROMs.
The component branches are `phase-3-<component>`, flat, because Git cannot hold `phase-3/<component>` beside
`phase-3` (D56 h).

## Measured numbers

Filled in by the integrator from the closing run: per tuning ROM the self-checks, the raw and readable
links, the readability shares and their floors (`bench/baseline/readability.json`), objdiff, the speed
budgets and the large-ROM peak RSS; per fixture the same checks and links.

## Owner questions

None open. Every owner decision of architecture §12 is built with its documented safe default (D62 i).

## The closing gate

The whole list in a fresh worktree (`git worktree add --detach`: no `node_modules`, no `bench/.local`) at the
closing commit, every command from the worktree root with the environment above, the real tier before the
ci tier, `test/gates/phase.json` raised to `{ "landed": 3 }` before the real-tier run (D55 j):

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | | |
| `npm run typecheck` | | |
| `npm run lint` | | |
| `npm test` | | |
| `npm run fixtures -- check` | | |
| `npm run bench -- doctor-real` | | |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | | |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | | |
| `npm run corpus` | | |
| `npm run bench -- run --scaffold` | | |
| `npm run bench -- speed` | | |
| `npm run bench -- large-rom --json` | | |
| `npm run bench -- regression` | | |
| `npm run bench -- dataset-check` | | |
| `npm run bench -- gates --require 3 --tier real` | | |
| `npm run bench -- gates --require 3 --tier ci` | | |
| `npm run bench -- provenance` | | |
| `npm run bench -- stale-check` | | |

## Known limitations

- The text-layout check (`checkEntry`, `checkEntries`) passed every tree `as` refused in the wave-2 integration
  (D63): it does not check that a symbol an instruction names is defined in the tree or `symbols.ld`, nor that a
  PC-relative reference stays inside its object. The model rules of D63 b to d remove the cases measured; until
  the check covers them, only `linkCheck`/`assembleCheck` (`verify --assemble --link`, `g3.link`) and the
  fixture round-trip test catch a new one. For wave 3's fix rounds; no gate changes.
- `p3-model` measured `buildModel` on pokeemerald at about 1 s of process CPU on a cold start, above the brief's
  "well under 1 s" (no gate threshold; `g3.speed-budget` measures `generate` as a whole in wave 3). Warm, after
  `discover` in the same process, it is 713 ms wall (table above).
- `p3-model` saw one `npm test` failure once in six runs and did not capture which test; it did not recur in
  its five reruns or in the integration runs.
- docs/benchmark-roms.md already gives tmc's ELF (`tmc/tmc.elf`) and map (`tmc/build/USA/tmc.map`); nothing
  there says tmc has no ELF (checked at integration).

- Until the integrator regenerates `bench/results.json` at closing, `g1.provenance` and `bench stale-check`
  fail on every phase-3 commit that changes a source (the source digest moves); this is expected.
- The analysis goldens (`test/golden/analysis/*.json`) are single-line canonical JSON, as `encodeAnalysis`
  writes them; a rule change rewrites them with `UPDATE_GOLDEN=1`.
- Measured in wave 1, a risk for `g3.large-rom` (peak RSS < 512 MiB, unchanged): the analysis alone
  (`discover` analyze, its own `node --conditions=source` process, Node 24.15) on the 32 MiB synthetic ROM
  finds 3,639 functions, raises `W_READING_BUDGET` once and peaks at 1,097,408 KiB RSS (1,071.7 MiB), 45.9 s
  CPU; it does not complete under `--max-old-space-size=320`. The gate measures `init` and `generate`; until
  wave 3 runs it, nothing is waived. If it still fails after the fix rounds, it is recorded here with the
  numbers and the phase does not land.
- Carried from phase 2 (phase-2.md, "Carried into phase 3"): the cartridge entry's extent covers the header
  (correctness-6), to be bounded with the header's emission; a two-instruction ARM leaf after ARM code is read
  as Thumb on tmc (its bytes print either way).
