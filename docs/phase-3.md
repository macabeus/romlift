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
| `p3-generate` | 3 | `phase-3-generate` | merged (`2c0c7c9`) | `generate` (phase-3 form), `model --json`, `verify`, `explain`'s item and chunk, `bench/src/large-rom.ts` |
| `p3-bench-scaffold` | 3 | `phase-3-bench-scaffold` | merged (`340c95a`) | `bench run --scaffold` (both printers), readability, objdiff, `bench speed` emission timings, `bench large-rom` |
| `p3-fixture-goldens` | 3 | `phase-3-fixture-goldens` | merged (`f726652`) | the writer goldens, `export-poc --mode raw` and the raw printer's PoC parity, the six-ROM emission test, the tree digests in CI, the emission fixes of wave 3 |
| closing fix round | lead | `phase-3` | committed (`c5d42cf`, `962fbb8`, `34a77cd`, `682da72`) | the confirm-mode startup fix, `[symbols]` outside the ROM as labels, the objdiff base's RAM names, the write and analysis speed and memory changes, the readability floors (D64) |

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

### p3-fixture-goldens (wave 3)

Branch `phase-3-fixture-goldens` (the brief's `phase-3/p3-fixture-goldens` cannot exist beside the branch
`phase-3`, D56 h), worktree `romlift-wt/phase-3-p3-fixture-goldens`, cut from `phase-3` at `e1615c7`.

- **Writer goldens** (`g3.golden-writers`, roadmap 3.B/3.C): `test/golden/writers/<writer>/<fixture>.txt` for
  the eight phase-3 writers on the 47 fixtures (376 files), one shared test `writers.test.ts`; each golden is
  the writer's files on the discover-mode model (agbcc profile, `configFromDiscover`, `buildModel`, readable
  printer, empty `DecompState`) in the stream order restricted to that writer, each under a `==> <path>
  (<ownership>, <writer>) <==` line, `(no files)` where the writer yields none (orphan on 4 fixtures, data on
  27). Not gated: `raw-printer/<fixture>.txt`, the whole raw tree. `UPDATE_GOLDEN=1` rewrites them and removes
  stale ones. Reviewed by eye for §5: start macros by mode, 2-mod-4 entry and scope; `.align 2, 0` before
  pools; far pools in the module of their load; jump tables `.4byte` to local labels; ARM blocks after `bx pc`
  with `.arm`/`.thumb` and their inner labels typed; data notes (`@ dead`, `@ mixer hole`); one deviation found
  and fixed (the zero halfword before a pool, below).
- **`export-poc --mode raw`** (roadmap 3.B gate): the PoC's own tsx runs its analysis and `writeGenerated()`
  for each committed fixture into `bench/.local/poc/raw/<fixture>/`, and dumps its `tile()` chunks (span,
  name, kind, mode, module, labels) and its claim kind per byte; the parent cuts each chunk's body lines out of
  the written file into `raw.json` beside the tree. `test/local/poc-raw-printer.test.ts` feeds
  `printRawRange` (romlift/internal) the PoC's spans, labels and pool/table words and requires the PoC's lines.
- **`test/local/emission-real.test.ts`**: per tuning ROM the discover model, `verifyModel`, the text-layout
  and paths pass of both printers' streams, and `linkCheck` of both trees, all required.
- **CI** (D30, `g3.tree-determinism` "Linux and macOS agree"): `bench/tools/ci-digests.ts` writes
  `romlift-bench/ci-digests@2`, the tree digest per fixture (the gate's: sha256 over path, NUL, content, NUL in
  stream order) beside the analysis digest; `ci.yml`'s varied-environment `cmp` and the final job's `--compare
  --expect 4` cover both.
- **Fixes**, each its own commit with a test that fails without it:
  - `cf4f937` model: free zero bytes from a non-word address up to a pool word or table entry at the next word
    boundary, inside a code chunk and with no label inside, are a padding item (`.align 2, 0`, D16), not data
    noted `dead`. Measured before: 11,614 such halfwords on pokeemerald, 3,400 on tmc, 2,446 on sa2; ten
    fixture model goldens change (one item each).
  - `ad38efa` verify: `checkReencode` runs the printing rule through `printingCache` (the model's, built afresh
    per check); `layoutStatements` memoises instruction sizes and the words of texts that name no symbol
    (`LayoutMemo`, shared per model by the text-layout check). pokeemerald: `verifyModel` 1,815 → 447 ms, the
    readable text-layout check 3,230 → 1,931 ms.
  - `a76da9a` text-layout: a PC-relative load or `adr` naming a label of another module fails
    (`LayoutInput.sameObject`), and only labels a printer can place resolve (at an item start or inside a data
    item), closing the wave-2 limitation that the check passed trees `as` refused.

#### Interface changes (for the integrator)

- `foundation/asm/layout.ts`: `LayoutInput` gains two optional members, `memo?: LayoutMemo` and
  `sameObject?(name): boolean`; `LayoutMemo` and `layoutMemo()` are exported. Existing callers are unchanged
  (absent: a memo of the layout's own, every name in the object). Not re-exported by `romlift`.
- `bench/tools/ci-digests.ts`: schema `romlift-bench/ci-digests@2` with `trees`; `fixtureDigests` and
  `treeDigest` exported beside `fixtureDigest`.
- `bench/tools/export-poc.ts`: mode `raw`, with `rawFromChild`, `pocChunkFile`, `pocChunkLines`, `pocRawDump`,
  `pocRawDir`, `POC_RAW_SCHEMA`; the child takes `<fixture> raw <rom path> <out dir>`. AGENTS.md's command table
  lists `--mode raw` (written by `p3-generate`, which owned AGENTS.md in wave 3).

#### Fixture tier (47 committed fixtures)

| Check | Result |
| --- | --- |
| model self-checks (`verifyModel`: tiling, re-encode, module size) | 47 of 47 ok |
| text layout and paths (`checkEntries`), readable and raw streams | 94 of 94 ok |
| readable tree `linkCheck` | 47 of 47 reproduce the fixture SHA-1 |
| raw tree `linkCheck` | 47 of 47 reproduce the fixture SHA-1 |
| writer goldens (`g3.golden-writers`, ci) | pass: 8 writers x 47 fixtures |
| tree determinism (`g3.tree-determinism`, ci) | pass: 47 trees identical across cwd, project path, TZ and locale |
| raw printer against the PoC's `rawLines` (`poc-raw-printer`) | 47 of 47 fixtures, every chunk's lines equal |

(`test/unit/emit/fixtures-round-trip.test.ts` and the gate files run the first four and the last three; binutils
2.45.1.)

#### Tuning ROMs (`ROMLIFT_REQUIRE_LOCAL=1 node --conditions=source --test test/local/emission-real.test.ts`)

Node 24.15, binutils 2.45.1, one process per ROM after the previous one; wall times, the link times include
writing the tree to a temporary directory and vary with the disk:

| ROM | Model checks | Text layout + paths (raw, readable) | Raw link | Readable link | Items | Raw-insn | Modules | Files | Analysis | Model | Emit + check readable | Link readable |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | ok | ok, ok | SHA-1 | SHA-1 | 351,531 | 2 | 57 | 9,346 | 911 ms | 371 ms | 1,035 ms | 9,743 ms |
| klonoa | ok | ok, ok | SHA-1 | SHA-1 | 151,725 | 2 | 28 | 668 | 271 ms | 138 ms | 357 ms | 1,075 ms |
| pokeemerald | ok | ok, ok | SHA-1 | SHA-1 | 874,915 | 2 | 43 | 19,121 | 1,709 ms | 731 ms | 2,577 ms | 20,080 ms |
| sa2 | ok | ok, ok | SHA-1 | SHA-1 | 284,528 | 2 | 22 | 3,380 | 539 ms | 194 ms | 705 ms | 4,108 ms |
| sa3 | ok | ok, ok | SHA-1 | SHA-1 | 387,973 | 2 | 25 | 5,602 | 908 ms | 274 ms | 965 ms | 5,990 ms |
| tmc | ok | ok, ok | SHA-1 | SHA-1 | 289,051 | 4 | 40 | 10,970 | 1,084 ms | 264 ms | 900 ms | 8,863 ms |

Raw link six of six (`g3.raw-link`), readable link six of six (`g3.link`, floor three). The raw-insn items are the
m4a mixer's `adr r0, X + 1` (D63 d) on every ROM, and on tmc also the two halfwords of the ARM leaf read as Thumb
(Known limitations). pokeemerald in one process: analysis 1,869 ms, model 764 ms, `verifyModel` 475 ms, readable
emit 653 ms and text-layout check 2,196 ms, raw emit 479 ms and check 866 ms.

### Wave-3 integration

Merged in order `phase-3-generate` (`2c0c7c9`), `phase-3-bench-scaffold` (`340c95a`), `phase-3-fixture-goldens`
(`f726652`), each with `--no-ff`; no textual conflict, and no file is changed by two of the three branches.
Made consistent on the integration commit:

- Two bench modules exported the same names with different shapes: `bench/src/emission-run.ts`
  (`p3-generate`: `EmissionRunner` `{prepare, generate, init}` and `ROMLIFT_EMISSION`, used by `bench speed` and
  `bench/src/large-rom.ts`) and `bench/src/scaffold.ts` (`p3-bench-scaffold`: `{readability, scaffold}`, used by
  `bench run`). The scaffold side is renamed `EmissionFamilies` and `ROMLIFT_FAMILIES` (`run.ts`
  `RunOptions.emission`, `cli.ts`, `test/unit/bench/harness.ts`, `emission/scaffold.test.ts`); behaviour unchanged.
- `bench/src/run.ts`'s `LargeRomReport` (the parsed member and volatile timings) is renamed `MemoryFamilyRun`, so
  it no longer shares its name with `large-rom.ts`'s `LargeRomReport` (the script's printed line); the "missing"
  error no longer says the script is still to be written. A new test in `test/unit/bench/emission/run.test.ts`
  ties both sides of the `romlift/bench-large-rom@1` contract: the schema and script path of `run.ts` equal
  `large-rom.ts`'s, and a `LargeRomReport` as the script prints it parses into the member, its `detail` volatile.
- AGENTS.md's `ROMLIFT_OBJDIFF` row gives `findObjdiff`'s real order (the repository's, then the main
  checkout's `bench/.local/objdiff-target` build, then `PATH`, then `$ROMLIFT_BENCH_ROOT/objdiff`).
- `assembleWithBinutils`'s added `object` (`p3-bench-scaffold`, `061c4db`) and `LayoutInput.memo`/`sameObject`
  (`p3-fixture-goldens`) are additive; every caller typechecks unchanged.

On the integrated tree `npm run typecheck` (exit 0), `npm run lint` (21 of 21) and `npm test` (1,874 tests:
1,872 pass, 0 fail, 2 todo) pass. The two `todo` tests stay as `p3-generate` delivered them:
`test/unit/cli/verify.test.ts` ("verify exits 0 on every fixture …") and
`test/unit/workflow/generate.test.ts` ("on every fixture the report is ok …"). Both fail on every fixture and both printers with `E_PATH_CASE_COLLISION` ("the stream emits
asm/crt0.s twice", `paths` check failed, exit 3), and the confirm run differs from the discover run: the
confirm analysis over `configFromDiscover`'s config accepts the startup code as origin `call`, the startup
region shrinks, and the module and crt0 writers both emit `asm/crt0.s` (`p3-generate`'s commit `168af18`).
The fixture-tier and tuning-ROM links above are on the discover-mode model, which `generate` does not use, so
until this is fixed every `generate`/`verify`/`init` run, and the g3 gates built on them (`g3.speed-budget`,
`g3.large-rom`, the `verify` contract), fail. Not fixed at integration: the defect is in the model/analysis
components, for the fix round (fixed there: `c5d42cf`, D64 a).

The components also reported, not re-measured at integration: `p3-generate`, that the speed and memory budgets
fail for causes outside it; `p3-bench-scaffold`, that `g3.readability` fails only because
`bench/baseline/readability.json` is not written yet (the lead writes it with `--write-readability-floor`), and
that `g3.objdiff` fails on every tuning ROM, mostly because of an emission rule only the owner can change (its
candidate owner question Q1; to be written under "Owner questions" with the measured facts once the closing
run measures it).

### Closing fix round (D64)

The closing gate list, first run at `52ad363` in the main checkout, failed on: the two `todo` tests of wave 3
(every `generate`, `verify` and `init` over `configFromDiscover`'s config ended in `E_PATH_CASE_COLLISION`);
`g3.objdiff` on all six tuning ROMs; `g3.speed-budget` (pokeemerald `generate` 22,339 ms and `init` 26,936 ms
CPU against 9,400 and 14,100 ms calibrated); `g3.large-rom` (`init` 1,845.7 MiB, `generate` 1,366.3 MiB peak
RSS against 512 MiB); `g3.readability` (no floor file). Each fix is its own commit with a test that fails
without it:

- `c5d42cf` **confirm equals discover on the startup code** (D64 a). `configFromDiscover` labels every entry
  inside another found extent with nothing clipped (`coveredEntries`), so the confirm run no longer cuts the
  cartridge entry at the startup code and accepts it as origin `call`; `isLabelEntry` keeps the header clip
  where the model and `codeLayout` place chunks. On all 47 fixtures the confirm run's functions, extents and
  startup region equal discover's; the two `todo` tests pass (no `todo` left in `npm test`); `verify --link`
  exits 0 with the SHA-1 on every fixture and both printers.
- `962fbb8` **a `[symbols]` entry outside the ROM names its pool words** (D64 b, c): global data labels no file
  places, defined by `symbols.ld` (architecture §5's `@ =gFoo`); the objdiff base names the RAM symbols an ELF
  section defines and leaves out absolute ones. objdiff differences fe7j 1,296 → 256, klonoa 4,560 → 320,
  pokeemerald 45,414 → 16,543, sa2 8,392 → 1,518, sa3 7,174 → 609, tmc 6,241 → 1,252.
- `34a77cd` **emission speed and analysis memory** (D64 d, e): generated files are written without an `fsync`,
  an absent one created in place; compact instruction lookups in readings; numeric rejection keys; a native
  dead-run scan; the layout memo keyed by slot and text; table-driven `hex()`. Result-neutral: the goldens, PoC
  parity, lockstep and `epoch-reuse` are unchanged. pokeemerald `generate` 22,339 → 8,069 ms, `init`
  26,936 → 9,968 ms CPU (bench speed); large ROM 1,845.7 → 1,081.0 to 1,122.5 MiB (`init`), 1,366.3 → 1,019.0
  to 1,359.3 MiB (`generate`), still above the budget.
- `682da72` **the first readability floors** (`bench/baseline/readability.json`, D62 a, D64 f), written by
  `run --scaffold --write-readability-floor` at `34a77cd` (its commit message names `acdf44c`, the same tree
  before its message was amended).

## Deviations from the roadmap

Recorded in D62: eight components in three waves instead of 3.0, 3.A–3.E, 3.I; the resolver, item table and
paths in `core/model`, no `core/emit/symbol-resolver.ts`; `config-from-discover.ts` in `core/workflow`;
`EmitContext.printer`, `PrintStats`, `PrintedChunk`, the `Writer` contract; `WritePlanInputs.retained` and
`WritePlan`; `ProposalSource` `'layout'` and `sourceKey` undefined for unpersisted sources; `checkEntry` checks
one entry; `itemAt`'s run offset; no `dataStart` before phase 5; the phase-3 mutation tests owned by the
checkers' components; `g3.text-layout` requires the `paths` check too; every threshold over six tuning ROMs.
The component branches are `phase-3-<component>`, flat, because Git cannot hold `phase-3/<component>` beside
`phase-3` (D56 h).

Wave 3, `p3-fixture-goldens`: the raw printer's PoC parity (roadmap 3.B's gate) is a local test
(`test/local/poc-raw-printer.test.ts`, on the dumps of `export-poc --mode raw`), not a gate file, as the other
PoC evidence of phase 2 is; it feeds the PoC's own spans, labels and word kinds to `printRawRange`, so it
proves the ported `rawLines`, not that romlift's chunks equal the PoC's tiling (they differ where romlift's
model does: modules, D63 borders, the padding of `cf4f937`). The ci-digests file's schema moved to `@2` (one
CI run writes and compares it, so no reader of `@1` remains).

Closing fix round (D64): `configFromDiscover` writes `label = true` on the startup code inside the cartridge
entry's extent, and a label entry only that extent covers still starts a chunk (a). `[symbols]` outside the ROM
became model labels (b), which architecture §5 described and the model lacked. architecture §6.4's "each op
through a temporary file and a rename" now flushes only the journal, the manifest, edits and scaffold files,
and creates an absent generated file in place (d). The closing list ran in the main checkout, not in a fresh
worktree, with `test/gates/phase.json` left at `{ "landed": 2 }`: the phase does not land (two gates fail,
below), so the marker is not raised; the docs commit of this record came after the run, so the artifact
records `682da72` with the documentation as the only uncommitted change (the source digest, which
`provenance` and `stale-check` compare, covers no document).

## Measured numbers

The closing run (`682da72`, Node 24.15, binutils 2.45.1, objdiff-cli 3.7.2). Fixtures: 47 of 47 pass the model
self-checks, the text-layout and paths checks of both printers, and link to their SHA-1 with both printers;
47 writer goldens per writer; 47 trees identical across cwd, project path, TZ and locale.

| ROM | Self-checks | Raw link | Readable link | Readability (mnemonic / branch / pool, = floor) | Analysis CPU | objdiff scored | objdiff differences (gated + unnamed-target) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | ok | SHA-1 | SHA-1 | 99.999% / 100% / 100% | 1,152 ms | 1,471 | 201 + 55 |
| klonoa | ok | SHA-1 | SHA-1 | 99.999% / 100% / 100% | 245 ms | 485 | 320 + 0 |
| pokeemerald | ok | SHA-1 | SHA-1 | 100.000% / 100% / 100% | 2,075 ms | 15,850 | 13,785 + 2,758 |
| sa2 | ok | SHA-1 | SHA-1 | 99.999% / 100% / 100% | 749 ms | 2,887 | 1,375 + 143 |
| sa3 | ok | SHA-1 | SHA-1 | 99.999% / 100% / 100% | 1,126 ms | 4,305 | 565 + 44 |
| tmc | ok | SHA-1 | SHA-1 | 99.999% / 99.998% / 100% | 1,483 ms | 8,388 | 895 + 357 |

Speed (`bench speed`, calibration ratio 0.968; the gate's own run measured 1.035): pokeemerald `generate`
8,069 ms and `init` 9,968 ms CPU (budgets 9,680 and 14,520 ms at that ratio; the gate's run 8,116/10,355 and
9,674/15,532 ms); analysis 245 (klonoa) to 2,075 ms (pokeemerald), every ROM under its `g2.speed` limit.
`generate` and its write on the other ROMs: fe7j 3,578, klonoa 1,054, sa2 2,340, sa3 3,147, tmc 3,703 ms.

Memory (32 MiB synthetic ROM, SHA-1 `b846b945…`, 3,639 functions, 5,682 files): `init` 1,081.0 MiB and
`generate` 1,359.3 MiB peak RSS in `run --scaffold`'s memory family, 1,122.5 and 1,019.0 MiB in
`g3.large-rom`'s run; the same tree digest `9d9c915d…` both times. Measured on `discover` alone: after a full
collection the live heap is 136 MiB and external memory 89 MiB, while the old space peaks at 300 to 400 MiB
during the gap scan; capped with `--max-old-space-size=256` the run completes at 595 to 684 MiB peak RSS, and
fails under 200 MiB. The run-to-run spread (1,019 to 1,495 MiB) is V8 sizing its heap to the machine.

## Owner questions

Every owner decision of architecture §12 is built with its documented safe default (D62 i). Two gates fail after
the fix round, and making either pass needs a gate or emission change the owner has not authorised, so the phase
does not land until he answers.

### Q1. `g3.objdiff`: the remaining differences are naming and comparison artefacts

Facts. D34 gates every objdiff difference but `unnamed-target`. After D64 b and c, every remaining one, classified
by the reference's and the base's text (`missing-symbol` and `tool` are functions not compared at all):

| Class | fe7j | klonoa | pokeemerald | sa2 | sa3 | tmc |
| --- | --- | --- | --- | --- | --- | --- |
| `resolved-call`: a `bl` the reference's `as` resolved inside its object, which the base, assembled one function per file, relocates against the same callee | 8 | 0 | 11,776 | 1,016 | 65 | 323 |
| `instruction`: the same, to a static callee the ELF names more than once (`bl 0xc5c` against `bl sub_08031138-0x4`) | 0 | 0 | 210 | 115 | 65 | 0 |
| `relocation`: another name for the target (a union such as tmc's `gMenu`/`gChooseFileState`, aliases such as `GetMonData3`/`GetMonData2`, static names used twice; 230 of them the classifier could not pair by address) | 13 | 1 | 484 | 41 | 19 | 361 |
| `relocation`: the reference names `sym + addend`, the base the label at that address | 12 | 2 | 60 | 11 | 20 | 22 |
| `missing-relocation`: the reference names `sym + addend` (an address inside a RAM or ROM object), the base a plain value | 130 | 166 | 765 | 46 | 99 | 188 |
| `missing-symbol`: no reference object defines the name (libgcc, libc and archive members linked from outside `objectsDir`) | 26 | 21 | 453 | 127 | 237 | 1 |
| `tool`: objdiff-cli 3.7.2 refuses the reference object (klonoa `src/code_0804B254.o`, "Invalid instruction size 1") | 0 | 130 | 0 | 0 | 0 | 0 |
| `instruction`: a trailing zero halfword the ELF size counts and the base's chunk leaves to the next `.align` | 1 | 0 | 0 | 6 | 39 | 0 |
| `instruction`: other (a `.word` constant the ELF names, such as `sTalkText`; a `bl` to code run from RAM; one `b` printed as `.hword`) | 10 | 0 | 33 | 11 | 19 | 0 |
| `assemble`: a far pool in another chunk, which one function assembled alone cannot reach (and fe7j's `internal_relocation not fixed up`) | 1 | 0 | 4 | 2 | 2 | 0 |
| total gated | 201 | 320 | 13,785 | 1,375 | 565 | 895 |
| `unnamed-target` (reported, not gated) | 55 | 0 | 2,758 | 143 | 44 | 357 |

Every readable tree links to its ROM's SHA-1 (`g3.link` 6 of 6), so none of these changes a byte of the build.

Options.

- (a) Keep D34 as written (the default; phase 3 stays open). Closing it needs: the base assembled per reference
  object, every function of that object in one file, so calls resolve as in the reference; the printer emitting
  `sym + addend` for a word inside a sized symbol (an emission rule, with sizes in `[symbols]`); names chosen per
  reference object for aliases and statics; the archive members as reference objects; an objdiff-cli that reads
  klonoa's `code_0804B254.o`; and the padding, far-pool and remaining-instruction shapes fixed one by one.
- (b) Amend D34: report, not gate, the differences that link to the same word (a resolved call to the same
  callee, two names of one address, `sym + addend` against a label or plain value equal to the same address) and
  list the functions objdiff cannot compare (`missing-symbol`, `tool`) by count. Measured under (b), the gated
  remainder is the last three rows: fe7j 12, klonoa 0, pokeemerald 37, sa2 19, sa3 60, tmc 0, which would still be
  fixed before the phase lands.
- (c) Move `g3.objdiff` to phase 5, where the `expected/` objects and objdiff targets are built (D34 rejected it
  once), with these numbers recorded as the phase-3 measurement.

### Q2. `g3.large-rom`: peak RSS twice the 512 MiB budget

Facts. Measured above: `init` 1,081 to 1,122 MiB, `generate` 1,019 to 1,359 MiB (from 1,846 and 1,366 MiB before
D64 e). The live set after the analysis is about 225 MiB (136 MiB heap, 89 MiB external), but V8 lets the heap grow
to 300 to 400 MiB of live data plus garbage during the gap scan of a 32 MiB image; a 256 MiB heap cap still peaks
at 595 to 684 MiB RSS. The 32 MiB image is synthetic: no tuning ROM is above 16 MiB.

Options.

- (a) Keep 512 MiB (the default; phase 3 stays open). It needs further structural work: readings' instruction
  spans as typed arrays (a public `Reading` type change), fewer candidate readings held per epoch, the pointer
  index and the rejection details out of the heap, and a heap cap set by the `romlift` launcher.
- (b) Raise the budget to a measured value with margin (for example 1,536 MiB), keeping the ratchet; D42 rejected
  1 GiB budgets as hiding leaks.
- (c) Measure the gate under a fixed heap cap (`--max-old-space-size=256`, which the `romlift` bin would also
  pass), so it measures the live set rather than V8's sizing, and set the budget from that measurement (595 to 684
  MiB today).

## The closing gate

Run at `682da72` in the main checkout (`/Users/macabeus/ApenasMeu/decompiler/romlift`), every command from the
repository root in this order, the environment above, `test/gates/phase.json` at `{ "landed": 2 }`:

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,879 tests, 1,879 pass, 0 fail, 0 todo |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, equal to `bench/baseline/poc-digests.json` |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 74 tests, 74 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every ROM, ELF, object directory, PoC file and tool ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.2 s |
| `npm run bench -- run --scaffold` | 0 | six rows written (table above), raw and readable SHA-1 on all six, sealed pair pass |
| `npm run bench -- speed` | 0 | every ROM ok, pokeemerald `generate` 8,069 ms, `init` 9,968 ms |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | **1** | every gate of phase ≤ 3 pass or historical except **`g3.objdiff` fail** (Q1); g4 to g6 pending |
| `npm run bench -- gates --require 3 --tier ci` | **1** | every gate of phase ≤ 3 pass except **`g3.large-rom` fail** (Q2: `init` 1,122.5 MiB, `generate` 1,019.0 MiB) |
| `npm run bench -- provenance` | 0 | source digest, gate record (12 real-tier gates of phase ≤ 2), families, rows ok |
| `npm run bench -- stale-check` | 0 | the artifact is current, source digest `b6295625…` |

Real tier, phase ≤ 3: `g1.bench-harness`, `g1.dataset-elf`, `g2.baseline-rows`, `g2.code-end`,
`g2.confirm-equals-discover` (tmc's eight recorded functions, D61 e), `g2.determinism`, `g2.entries`,
`g2.extents`, `g2.held-out` (both waivers of D60/D61 b printed), `g2.no-unreviewed`, `g2.speed`, `g3.link`,
`g3.raw-link`, `g3.readability`, `g3.self-check`, `g3.speed-budget`, `g3.text-layout`, `g3.tree-determinism`
pass; `g2.poc-parity` historical; `g3.objdiff` fail. Ci tier, phase ≤ 3: every `g1`, `g2` and `g3` gate passes
but `g3.large-rom`. The phase is not merged, and the branch is not pushed for its pull request, until Q1 and Q2
are answered.

## Known limitations

- Resolved in the closing fix round (D64 a): the confirm-mode startup defect of the wave-3 integration; the two
  tests that were `todo` for it pass.
- `g3.objdiff` and `g3.large-rom` fail (Q1, Q2).
- A user config that removes `label = true` from the startup code inside the cartridge entry's extent brings back
  the confirm-mode startup region of four bytes; if its startup module is still named `crt0`, the paths check
  reports `asm/crt0.s` twice (`E_PATH_CASE_COLLISION`), correctly, and nothing is written. Phase 4's TOML
  patcher should keep that label.
- Generated files are no longer flushed to disk before their rename (D64 d); a crash can leave one short, and
  the next run rewrites it.
- Resolved in wave 3 (`a76da9a`): the text-layout check passed every tree `as` refused in the wave-2
  integration (D63). It now refuses a PC-relative load or `adr` naming a label of another module and resolves
  only labels a printer can place (at an item start or inside a data item), so a name the tree never defines is
  an undefined symbol. Still not modelled: anything `as` or `ld` refuses for a reason the layouter has no rule
  for; `linkCheck` stays the final proof.
- `p3-model` measured `buildModel` on pokeemerald at about 1 s of process CPU on a cold start, above the brief's
  "well under 1 s" (no gate threshold; `g3.speed-budget` measures `generate` as a whole in wave 3). Warm, after
  `discover` in the same process, it is 713 ms wall (table above).
- `p3-model` saw one `npm test` failure once in six runs and did not capture which test; it did not recur in
  its five reruns or in the integration runs.
- docs/benchmark-roms.md already gives tmc's ELF (`tmc/tmc.elf`) and map (`tmc/build/USA/tmc.map`); nothing
  there says tmc has no ELF (checked at integration and again at closing; all three held-out builds reproduce
  their SHA-1s, as it says).

- `bench/results.json` was regenerated by the closing run at `682da72` (with its gate record, `g3.objdiff`
  failing); `provenance` and `stale-check` pass on it. A later source change moves the source digest again.
- The analysis goldens (`test/golden/analysis/*.json`) are single-line canonical JSON, as `encodeAnalysis`
  writes them; a rule change rewrites them with `UPDATE_GOLDEN=1`.
- Measured in wave 1, a risk for `g3.large-rom` (peak RSS < 512 MiB, unchanged): the analysis alone
  (`discover` analyze, its own `node --conditions=source` process, Node 24.15) on the 32 MiB synthetic ROM
  finds 3,639 functions, raises `W_READING_BUDGET` once and peaks at 1,097,408 KiB RSS (1,071.7 MiB), 45.9 s
  CPU; it does not complete under `--max-old-space-size=320`. The gate measures `init` and `generate`; until
  wave 3 runs it, nothing is waived. It still fails after the fix round: the numbers are under "Measured
  numbers" and the question is Q2; the phase does not land.
- Carried from phase 2 (phase-2.md, "Carried into phase 3"):
  - **The cartridge entry's extent over the header (correctness-6): resolved by the header chunk.** The
    analysis still gives the entry function at 0x08000000 an extent past the header (0x08000000..0x080000F4 on
    the fixtures; its `b` is read before the startup code is a function); the model never lets it reach a file: `planChunks`
    cuts [0x08000000, 0x080000C0) into the one `header` chunk of `rom_header` (core/model/chunks.ts), the
    startup chunk starts at 0x080000C0 in `crt0`, and the header writer prints the header's bytes as `.byte`
    lines under `rom_header` with the entry's label (`.type sub_08000000, %function`, ARM) at its first byte, as
    the writer goldens of all 47 fixtures show. Inside the header chunk the model keeps the entry's `b` as an
    `arm.b` insn item (0x08000000, 4 bytes; the re-encode check passes it) and the other 188 bytes as one data
    item; both printers print the whole chunk as the PoC's `.byte` lines (`headerBody`), so the readability
    family does not count that one instruction. Printing it `b sub_080000C0` (an ARM branch relocates across
    objects) would be a readability gain on every ROM; not done, the header writer's form is the PoC's.
  - **The two-instruction ARM leaf read as Thumb on tmc** (`arm_sub_080B1FE4`: `ldrb r6, [r4, #21]; bx lr`):
    the scaffold prints a 4-byte Thumb function `sub_080B1FE4` (`str r5, [r2]` and `.inst.n 0xE5D4 @ b
    0x080B1B92 (no-roundtrip)`, 2 of tmc's 4 raw-insn items) and the ARM `bx lr` word as `.4byte 0xE12FFF1E` at
    the head of the orphan `unk_080B1FE8`; both trees link to the SHA-1. In our object `sub_080B1FE4` is a
    Thumb symbol of 4 bytes (objdump: `str r5, [r2, #0]; b.n`). objdiff-cli 3.7.2 shows nothing for it: it
    refuses tmc's reference object `build/USA/asm/src/intr.o` ("Unsupported ARM implicit relocation
    Elf(40)": the object has 52 `R_ARM_V4BX` relocations), so no function of `intr.o` can be diffed. For
    `p3-bench-scaffold`'s objdiff family and the integrator; the mode itself is an analysis matter (phase 2's
    ARM gap scan needs three instructions).
  - **code-quality-r1-6's optional part** (one field set for the four scoping records of `test/gates`): not
    done; the files are outside this component's ownership, and the phase-2 disposition says renaming them
    changes no verdict. Still open at closing (no gate depends on it).
- Readability note, no rule broken: 2-byte (or 1- to 3-byte) zero padding between two functions is an orphan
  chunk of its own (`unk_<ADDR>.s` holding `.align 2, 0`), as the PoC's `tile()` made a gap chunk of it (66 of
  the PoC's 97 gap chunks on the fixtures are under 4 bytes) and as plan.md's "No orphan bytes" rule asks. With
  the discover model, padding-only orphans of all orphans: pokeemerald 3,203 of 3,222, tmc 2,289 of 2,320, fe7j
  1,530 of 1,558, sa3 867 of 882, sa2 448 of 464, klonoa 64 of 87.
  The next function's `thumb_func_start` already emits `.align 2, 0`, so folding the pad into it would remove
  the files without changing a byte; that changes the chunk model and the plan's rule, so it is left as is.
