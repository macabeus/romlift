# Phase 3: Emission

The record of phase 3 (roadmap "Phase 3", architecture §3.4, §5, §6, §8.4, §9.4, D14 to D17, D19 to D21,
D34, D41, D42, D44 to D47, D49, D62). It is kept by the phase lead: the components as they merge, every
deviation from the roadmap, the measured numbers, the owner questions and the closing gate. Every number is
measured on the owner's machine with `ROMLIFT_BENCH_ROOT=/Users/macabeus/ApenasMeu/decompiler` and
`ROMLIFT_POC=/Users/macabeus/ApenasMeu/decompiler/romlift-poc`. The tuning set is six ROMs (fe7j, klonoa,
pokeemerald, sa2, sa3, tmc; D60), and every phase-3 threshold applies to all six (D62 h); the held-out ROMs
(pokefirered, pokeruby) run sealed and report counts only (D25).

**Verdict (after the owner's answer to Q7, D72).** The owner answered Q7 on 19 October 2026, "Raise cap to 1,024 MiB"
(option b), and every answer, Q1 to Q7, is applied exactly ("The owner's answers", below): `g3.objdiff` is `g5.objdiff`,
a phase-5 gate; the `romlift` bin and `g3.large-rom` run Node with `--max-old-space-size=1024` (Q7's answer, replacing
Q6's 384, which replaced Q2's 256), and the gate's budget is 1,536 MiB, set again from the eight runs of the synthetic
image recorded under that cap (largest peak 1,210.1 MiB) plus D69 b's margin of 25%, rounded up to a multiple of 64 MiB;
D64 d, the narrowed raw-printer parity and the alignment refusal are accepted; padding-only orphans, the confirm run's
re-validation and the readable printer's `adr` naming a function label are phase-4 work items. Under the 1,024 MiB cap
every bin command form and both of the gate's workflow children complete on the 32 MiB synthetic image and on the six
tuning ROMs (Node 24.15, macOS), and every bin command form completes on the code-dense doubled ROM (pokeemerald twice
over, `fb17b88d…`): its raw printer's tree links to its SHA-1, and its four readable `verify` forms exit 3 on the
text-layout check (two `adr` lines), which by the owner's answer is a recorded known limitation of phase 3 and a
phase-4 work item, not a failure ("Measured numbers", the owner's answer to Q7). No dense ROM is added to the gate. The
landing procedure runs with `test/gates/phase.json` at `{ "landed": 3 }`: the whole closing list in a fresh worktree
("The closing gate", the owner's answer to Q7). The branch is not merged or pushed.

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
| review fix round 1 | lead | `phase-3` | committed (`089ff8d` to `5f7267f`, then the docs and artifact commits) | the review's blocker and majors (D65), the minors, Q3 to Q5; section "Review" |
| review fix round 2 | lead | `phase-3` | committed (`ac9934c` to `1ac3527`, then the docs and artifact commits) | the second review's two majors and fifteen minors (D66), the checked objdiff classifier; section "Review", fix round 2 |
| review fix round 4 | lead | `phase-3` | committed (`0bb3d75` to `e8869c0`, the docs commit `81210eb`, then the artifact commit) | the review of `d744f5d`: the bin's commands under the 384 MiB cap, `bench large-rom --bin` and its local test, the recorded headroom (D70); section "Review", fix round 4 |
| review fix round 5 | lead | `phase-3` | committed (`fa4f71b`, `88cede1`, the docs commit `71143d4`, then the artifact commit) | the review of `16d1280`: the bin's live heap and four more command forms, `analyze`'s streamed text table, the doubled ROM and owner question Q7, the budget's basis (D71); section "Review", fix round 5 |
| the owner's answer to Q7 | lead | `phase-3` | committed (`1443c2c`, `745505f`, then the docs commit and the artifact commit) | the 1,024 MiB cap of the bin and `g3.large-rom`, the budget set again at 1,536 MiB, the runs under the cap, the readable `adr` defect to phase 4 (D72) |

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

## The owner's answers (D68, D69, D72)

Bruno Macabeus answered Q1 to Q5 on 19 October 2026, Q6 (raised by applying Q2) the same day, and Q7 (raised by fix
round 5's doubled ROM under Q6's cap) the same day. The chosen options,
verbatim, and what was done:

| Question | Chosen option | Applied |
| --- | --- | --- |
| Q1 `g3.objdiff` | "Move gate to phase 5" | `test/gates/g5.objdiff.test.ts` (`bd495c8`), its check unchanged: g3.objdiff moves to phase 5 (where the `expected/` objects and objdiff targets are built); phase 3 records the classified counts as its measurement (Q1's table); the committed classifier stays; in phase 5 the gate applies as D34 writes it unless the owner amends it then |
| Q2 `g3.large-rom` | "Measure under a heap cap" | `72a0f63`: the romlift bin launcher (`src/cli/main.ts`'s first line, `#!/usr/bin/env -S node --max-old-space-size=256`, kept in `dist/cli/main.js`) and the gate (every child of `bench large-rom`) run Node with --max-old-space-size=256; the gate requires both runs to exit 0 under the cap and report it. The budget is to be set from the runs under the cap with a stated margin; the six tuning ROMs are measured under the same cap and recorded, and all complete. The 32 MiB synthetic ROM does not complete under it in any run, so no budget can be set from it: Q6, whose answer replaces the 256 MiB by 384 MiB (below) |
| Q3 D64 d | "Accept, don't flush generated" | generated files are not flushed; the journal, manifest, user edits, scaffold and C stubs stay flushed (architecture §6.4); `g3.speed-budget` unchanged |
| Q4 raw-printer parity | "Accept" | the narrowed raw-printer PoC parity (D65 l, `test/local/poc-raw-printer.test.ts`) is 3.B's gate |
| Q5 limitations | "Accept Q5a; fix Q5b, c in phase 4" | (a) the alignment refusal is a recorded release-1 limitation; (b) padding-only orphans folded into the next function and (c) confirm no longer re-validating the functions discover listed (measured against g2's gates) are phase-4 work items in roadmap.md ("Carried from phase 3") |
| Q6 `g3.large-rom` under the cap (D69) | "384 MiB for bin and gate" | `05fd406`: the romlift bin launcher (`#!/usr/bin/env -S node --max-old-space-size=384`) and g3.large-rom (every child of `bench large-rom`; the gate requires the 384 MiB cap in each run's report) both use --max-old-space-size=384, replacing Q2's 256. `a206ac1`: the budget is set from the recorded runs under the 384 MiB cap plus a stated margin, 866.5 MiB (the largest) plus 25%, rounded up to a multiple of 64 MiB: 1,088 MiB. The synthetic ROM completes under the cap in every run of the bench's `init` and `generate` workflow children, and the six tuning ROMs are re-measured under 384 MiB and recorded ("Measured numbers"). The bin's own `verify`, `model` and `analyze --json` did not complete on the synthetic ROM under the cap until fix round 4 (D70): the review of `d744f5d` found them out of memory, which this row did not measure. A code-dense 32 MiB ROM (pokeemerald twice over) does not complete under the cap: Q7, whose answer replaces the 384 MiB by 1,024 MiB (below) |
| Q7 the code-dense 32 MiB ROM (D72) | "Raise cap to 1,024 MiB" (option b) | `1443c2c`: the romlift bin launcher (`#!/usr/bin/env -S node --max-old-space-size=1024`) and g3.large-rom (every child of `bench large-rom`; the gate requires the 1,024 MiB cap in each run's report) both use --max-old-space-size=1024, replacing Q6's 384. `745505f`: g3.large-rom's peak-RSS budget is set again from recorded runs under the 1,024 MiB cap plus a stated margin: eight runs of the synthetic image, the largest peak 1,210.1 MiB (`generate`), plus 25%, rounded up to a multiple of 64 MiB: 1,536 MiB. The synthetic image and the six tuning ROMs are re-measured under 1,024 MiB and recorded, all complete; the doubled ROM (`fb17b88d…`, never committed) completes every bin command form of `bench large-rom --bin --rom` under the cap, its numbers recorded ("Measured numbers"); its readable `verify` exits 3 on the text-layout check's two `adr` lines naming a function label (`adr r6, sub_0906A708`), a phase-4 work item the owner assigned (roadmap.md, phase 4, "Carried from phase 3"), recorded as a known limitation, not a failure; the raw printer links to its SHA-1. No dense ROM is added to the gate (not authorised) |

These are the only gate changes he authorised. With Q7's answer the minors carried from the review of `16d1280` were
looked at again (D72 f): gate-honesty-r1-3's remainder (the phase pull request's CI numbers) waits for that pull
request; correctness-r0-5's remainder (pool.ts), architecture-r2-1 and r2-4 stay carried into phase 4, and none is a
change of a fix's size. Earlier, the minors carried from the last review were taken where cheap:
architecture-r2-9 has its unit test (`5ae1c1c`); r2-5 is fixed (`0483164`, D69 c); r2-2 and r2-3 (the classifier) go
with `g5.objdiff` to phase 5; r2-1 stays carried into phase 4 ("Review", fix round 3).

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

### The owner's answer to Q7 (`1443c2c`)

Memory under the 1,024 MiB heap cap of Q7's answer (Node 24.15, macOS, 64 GiB; every child and every bin command under
`--max-old-space-size=1024`; peak RSS from `process.resourceUsage().maxRSS`, live heap the largest heap V8 found used
after a full mark-compact, `bench/src/live-heap.ts`). Two streams ran side by side, each process alone in its own
resident set.

**The synthetic image, `g3.large-rom`'s children** (`node --conditions=source bench/src/large-rom.ts --json`, eight runs
at `1443c2c`; every child exits 0 under the 1,024 MiB cap and writes the tree `9d9c915d…`). Peak RSS / live heap:

| Run | `init` peak RSS / live heap | `generate` peak RSS / live heap |
| --- | --- | --- |
| 1 | 1,040.6 / 301.4 MiB | 1,008.8 / 295.9 MiB |
| 2 | 964.1 / 316.6 MiB | 1,192.0 / 335.6 MiB |
| 3 | 1,036.9 / 295.9 MiB | 979.6 / 295.6 MiB |
| 4 | 975.4 / 295.9 MiB | 994.6 / 296.6 MiB |
| 5 | 986.5 / 296.5 MiB | 1,007.6 / 287.7 MiB |
| 6 | 1,031.3 / 296.9 MiB | 1,088.7 / 294.6 MiB |
| 7 | 1,016.8 / 298.5 MiB | 1,210.1 / 348.9 MiB |
| 8 | 997.2 / 329.1 MiB | 959.2 / 297.2 MiB |
| minimum to maximum | 964.1 to 1,040.6 / 295.9 to 329.1 MiB | 959.2 to 1,210.1 / 287.7 to 348.9 MiB |

The budget (D72 b): the largest recorded peak, 1,210.1 MiB, plus 25% (1,512.6 MiB), rounded up to a multiple of 64
MiB: **1,536 MiB** (`745505f`), replacing 1,088 MiB. Against the runs under 384 MiB (`init` 814.0 to 945.5 MiB) the
peak RSS rose by about 150 to 350 MiB, the live heap did not: V8 sizes its heap to the cap and collects later.

**The bin's twelve command forms** (`--bin --json`, the synthetic image; `--bin --json --rom <the doubled ROM>`), one run
each at `1443c2c`. Peak RSS / live heap in MiB:

| Command | synthetic image (`b846b945…`) | doubled ROM (`fb17b88d…`) |
| --- | --- | --- |
| `analyze` | 953.7 / 299.1 | 1,055.5 / 387.7 |
| `analyze --json` | 940.0 / 336.1 | 951.6 / 365.4 |
| `explain` | 1,019.7 / 355.6 | 1,151.8 / 415.8 |
| `explain --json` | 1,043.5 / 422.6 | 1,173.2 / 431.9 |
| `model` | 1,080.6 / 318.9 | 1,030.4 / 371.8 |
| `model --json` | 963.2 / 332.7 | 1,140.6 / 396.8 |
| `verify --json` | 1,057.1 / 312.6 | 1,313.2 / 757.2, exit 3 (text-layout) |
| `verify --assemble` | 1,101.8 / 303.8 | 1,313.8 / 736.4, exit 3 (text-layout) |
| `verify --assemble --json` | 1,102.5 / 353.4 | 1,338.5 / 749.4, exit 3 (text-layout) |
| `verify --assemble --link --json` | 1,134.5 / 395.1, links `b846b945…` | 1,344.7 / 741.0, exit 3 (text-layout) |
| `verify --printer raw --assemble --json` | 1,217.6 / 395.2 | 1,376.0 / 922.7 |
| `verify --printer raw --link --json` | 1,179.9 / 303.9, links `b846b945…` | 1,356.1 / 922.7, links `fb17b88d…` |

On the synthetic image every form exits 0 with an ok summary: 940.0 to 1,217.6 MiB peak RSS, live heap 299.1 to 422.6
MiB, about 601 MiB under the old space at the largest. On the doubled ROM no form aborts: the six `analyze`, `explain`
and `model` forms and the raw printer's two `verify` forms exit 0 (the raw `--link` linking `fb17b88d…`), and the four
readable `verify` forms exit 3, each on the text-layout check alone (by hand, `verify --json`: tiling, re-encode,
module-size and paths ok; text-layout "asm/nonmatchings/asm_0906A270/sub_0906A518.s line 50: cannot encode `adr r6,
sub_0906A708` at 0x0906A56C (operand out of range or unencodable) (2 problems in all)"). By the owner's answer that exit
3 is a known limitation and a phase-4 work item; `bench large-rom --bin --rom` exits 1 on that ROM for it. The largest
live heap there is the raw `verify`'s, 922.7 MiB: about 101 MiB (10%) under the old space. `bench large-rom --json
--rom <the doubled ROM>`: `init` exits 3 at 1,339.2 MiB (live 729.2 MiB) and `generate` exits 3 at 1,304.0 MiB (746.4
MiB), the same text-layout check, nothing written.

**The six tuning ROMs** (`--json --rom <ROM>`, the gate's children, and `--bin --json --rom <ROM>`, the twelve bin
forms; one run each at `1443c2c`). Every run exits 0, every bin `--link` links the ROM's SHA-1 and every child writes
the tree digest it wrote under 256 and 384 MiB. Peak RSS / live heap in MiB:

| ROM | `init` | `generate` | Tree digest | bin, 12 forms: peak RSS | bin: live heap |
| --- | --- | --- | --- | --- | --- |
| fe7j | 544.9 / 101.6 | 521.1 / 98.8 | `ad2ee4a2…` | 436.9 to 521.8 | 65.2 to 83.4 |
| klonoa | 332.9 / 33.0 | 313.1 / 31.9 | `917a55c7…` | 212.7 to 370.9 | 28.3 to 54.2 |
| pokeemerald | 750.8 / 191.4 | 734.2 / 189.4 | `13f71c43…` | 531.4 to 847.5 | 131.9 to 231.0 |
| sa2 | 439.4 / 63.1 | 492.0 / 88.2 | `116b1bb3…` | 399.2 to 478.3 | 46.1 to 144.4 |
| sa3 | 520.5 / 99.2 | 532.3 / 114.0 | `4390a358…` | 426.8 to 542.3 | 66.8 to 109.2 |
| tmc | 521.0 / 102.2 | 471.2 / 76.9 | `cfcd95a9…` | 442.4 to 544.7 | 80.5 to 103.9 |


Peak RSS 313.1 to 750.8 MiB (children) and 212.7 to 847.5 MiB (bin), pokeemerald the largest; live heap at most 231.0 MiB.

### Fix round 5 (`88cede1`)

**The bin's twelve command forms on the synthetic image, with the live heap.** `node --conditions=source
bench/src/large-rom.ts --bin --json` (each command its own process with the launcher's `--max-old-space-size=384`; peak
RSS and the largest heap live after a full mark-compact from `bench/src/rss-probe.ts`). macOS (64 GiB) runs Node 24.15
and 22.18.0 (the official darwin-arm64 build); Linux runs the `node:22.18.0-bookworm-slim` and `node:24-bookworm-slim`
images (arm64, OrbStack, binutils 2.40) over `git archive` of the commit, after `npm ci`. Every `--json` run that
completes ends in an ok summary and each `--link` run links `b846b945…`. Peak RSS / live heap in MiB; "abort" is V8's
out-of-memory abort:

| Command | macOS 24 `fa4f71b` 1 | macOS 24 `fa4f71b` 2 | macOS 24 `88cede1` | macOS 22 `fa4f71b` | macOS 22 `88cede1` | Linux 24 `fa4f71b` | Linux 24 `88cede1` | Linux 22 `fa4f71b` | Linux 22 `88cede1` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `analyze` | 829.9 / 345.7 | 835.8 / 346.5 | 793.8 / 300.8 | abort | 718.9 / 299.8 | 760.8 / 345.8 | 707.5 / 292.1 | abort | 627.2 / 293.8 |
| `analyze --json` | 759.7 / 319.5 | 780.2 / 295.8 | 814.5 / 341.2 | 716.8 / 291.8 | 730.0 / 296.5 | 701.1 / 297.4 | 708.5 / 337.8 | 643.3 / 300.8 | 628.1 / 296.5 |
| `explain` | 755.5 / 293.4 | 770.7 / 316.2 | 817.8 / 293.7 | 743.6 / 295.7 | 734.5 / 301.2 | 697.0 / 328.1 | 703.0 / 283.4 | 662.7 / 294.8 | 665.2 / 293.8 |
| `explain --json` | 755.3 / 287.3 | 782.2 / 301.7 | 797.8 / 302.7 | 720.3 / 297.9 | 737.8 / 295.4 | 704.2 / 297.9 | 712.0 / 319.3 | 670.9 / 302.3 | 663.6 / 304.1 |
| `model` | 814.3 / 351.8 | 775.8 / 321.7 | 844.6 / 368.8 | 793.8 / 327.8 | 774.0 / 321.7 | 742.1 / 361.8 | 749.1 / 376.5 | 697.5 / 330.0 | 732.1 / 321.8 |
| `model --json` | 844.3 / 375.5 | 816.4 / 357.4 | 878.9 / 340.4 | 729.3 / 332.8 | 753.3 / 330.1 | 758.4 / 321.4 | 727.1 / 331.9 | 672.9 / 326.3 | 657.3 / 331.1 |
| `verify --json` | 772.9 / 337.5 | 818.6 / 340.2 | 867.9 / 362.6 | 739.6 / 328.4 | 700.2 / 329.4 | 709.0 / 322.5 | 738.9 / 325.1 | 654.3 / 325.5 | 665.2 / 328.7 |
| `verify --assemble` | 819.5 / 367.3 | 817.4 / 334.1 | 822.8 / 377.5 | 844.2 / 327.4 | 868.2 / 331.2 | 799.8 / 377.4 | 787.9 / 338.4 | 730.9 / 330.1 | 731.2 / 330.7 |
| `verify --assemble --json` | 825.8 / 357.8 | 801.8 / 326.6 | 859.8 / 371.0 | 781.0 / 331.8 | 821.6 / 329.7 | 781.9 / 335.0 | 780.9 / 370.0 | 792.4 / 332.6 | 806.9 / 330.9 |
| `verify --assemble --link --json` | 809.3 / 346.8 | 846.5 / 337.7 | 843.1 / 368.3 | 733.1 / 330.2 | 847.4 / 330.1 | 791.6 / 324.0 | 766.7 / 351.5 | 839.6 / 325.7 | 836.2 / 325.8 |
| `verify --printer raw --assemble --json` | 842.3 / 335.6 | 825.4 / 339.6 | 916.4 / 343.8 | 793.5 / 329.5 | 774.2 / 328.6 | 815.2 / 345.4 | 846.0 / 337.3 | 698.5 / 328.8 | 692.8 / 326.9 |
| `verify --printer raw --link --json` | 839.7 / 363.3 | 830.4 / 326.4 | 912.9 / 341.3 | 769.1 / 330.7 | 813.2 / 330.6 | 838.3 / 321.1 | 861.2 / 341.1 | 687.0 / 326.9 | 693.2 / 329.7 |

At `88cede1` every command completes on all four platforms: peak RSS 627.2 to 916.4 MiB, live heap 283.4 to 377.5 MiB.
The largest live heap, 377.5 MiB (`verify --assemble`, macOS Node 24) and 377.4 MiB (the same on Linux at `fa4f71b`),
leaves about 6.5 MiB (2%) of the 384 MiB old space. At `fa4f71b` the text `analyze` aborted under Node 22.18 on both
systems; by hand on macOS under the cap (`--import bench/src/rss-probe.ts`), 2 of 5 more Node 22.18 runs aborted and
three completed at 319.7 to 335.2 MiB live. After `88cede1` (the streamed table), six runs each on Node 22.18 and
24.15: all exit 0, 291.1 to 299.1 MiB live, 707.3 to 787.4 MiB peak RSS; its output is byte-identical to `fa4f71b`'s
(klonoa, pokeemerald, the synthetic image).

**The six tuning ROMs, the same twelve forms** (`--bin --rom <ROM>`, Node 24.15, macOS, `fa4f71b`; every run exit 0,
ok summaries, each `--link` linking the ROM's SHA-1). Peak RSS / live heap in MiB:

| ROM | `analyze` | `analyze --json` | `explain` | `explain --json` | `model` | `model --json` | `verify --json` | `verify --assemble` | `verify --assemble --json` | `verify --assemble --link --json` | `verify --printer raw --assemble --json` | `verify --printer raw --link --json` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fe7j | 414.4 / 65.1 | 414.1 / 65.1 | 450.7 / 75.1 | 447.5 / 76.6 | 494.7 / 103.0 | 505.6 / 95.6 | 489.5 / 91.3 | 505.9 / 96.7 | 500.6 / 93.5 | 527.7 / 104.7 | 501.7 / 96.9 | 500.0 / 92.2 |
| klonoa | 240.3 / 25.9 | 236.1 / 24.3 | 305.7 / 33.3 | 295.9 / 31.9 | 316.4 / 31.1 | 344.3 / 25.5 | 324.2 / 30.9 | 323.3 / 52.2 | 320.2 / 25.8 | 319.3 / 25.8 | 310.6 / 25.9 | 314.6 / 30.4 |
| pokeemerald | 568.3 / 182.0 | 577.7 / 164.9 | 601.2 / 175.9 | 596.8 / 179.4 | 603.1 / 166.0 | 666.1 / 165.3 | 638.9 / 165.8 | 669.8 / 187.1 | 669.1 / 195.9 | 679.2 / 167.3 | 660.6 / 149.1 | 654.7 / 168.2 |
| sa2 | 399.2 / 72.4 | 398.2 / 72.1 | 425.3 / 69.2 | 430.5 / 70.5 | 418.6 / 71.5 | 508.0 / 118.5 | 447.0 / 73.7 | 447.2 / 76.6 | 440.7 / 71.8 | 470.3 / 85.4 | 455.3 / 74.5 | 450.9 / 72.3 |
| sa3 | 416.1 / 65.9 | 413.1 / 60.6 | 426.6 / 62.1 | 422.1 / 65.4 | 471.7 / 89.9 | 542.9 / 165.6 | 476.4 / 88.3 | 488.7 / 91.8 | 499.5 / 106.0 | 492.3 / 98.2 | 501.3 / 102.8 | 476.6 / 85.7 |
| tmc | 412.6 / 65.9 | 416.6 / 66.8 | 489.0 / 103.5 | 486.5 / 100.9 | 492.5 / 101.6 | 503.5 / 97.7 | 495.3 / 94.3 | 506.8 / 95.3 | 513.1 / 94.9 | 529.8 / 99.8 | 497.6 / 99.3 | 508.3 / 95.9 |

Peak RSS 236.1 to 679.2 MiB, live heap at most 195.9 MiB (pokeemerald). The text `analyze` of a tuning ROM held at
most 182.0 MiB live before `88cede1`, so its streaming was not re-measured there.

**The gate's children on Node 22.18 and on Linux** (`node --conditions=source bench/src/large-rom.ts --json`, the
synthetic image; every run exit 0 under the 384 MiB cap, tree `9d9c915d…`). Peak RSS / live heap in MiB:

| Platform | Runs | `init` | `generate` |
| --- | --- | --- | --- |
| macOS, Node 22.18.0, `fa4f71b` | 2 | 729.5 to 751.2 / 319.5 to 326.3 | 674.1 to 704.1 / 321.6 to 323.4 |
| Linux, Node 22.18.0, `fa4f71b` and `88cede1` | 6 | 617.2 to 678.2 / 315.2 to 332.5 | 615.7 to 643.1 / 321.3 to 329.4 |
| Linux, Node 24, `fa4f71b` and `88cede1` | 6 | 744.6 to 764.9 / 315.3 to 329.7 | 752.7 to 782.5 / 329.4 to 354.6 |

All are under the 1,088 MiB budget. The phase pull request's CI (ubuntu-latest and macos-latest, Node 22.18 and 24)
has not run, since nothing is pushed; its `g3.large-rom` numbers are to be recorded here when it does (D71 g).

**The doubled ROM** (`pokeemerald.gba` twice, SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`, 32 MiB; Node 24.15,
macOS). `--bin --rom` at `fa4f71b`: all twelve forms abort under the cap. `bench large-rom --rom` at `fa4f71b`: `init`
aborts, `generate` has no config. Each command by hand (`node --conditions=source [--max-old-space-size=N] --trace-gc
src/cli/main.ts …` at `16d1280`, whose analysis, model and verify this round does not change; the largest heap after
a mark-compact, and peak RSS from `/usr/bin/time -l`):

| Command | no cap | 768 MiB | 1,024 MiB |
| --- | --- | --- | --- |
| `analyze` | exit 0; 421.2 MiB live, 1,045.3 MiB RSS | exit 0; 337.9, 947.1 | exit 0; 350.8, 938.8 |
| `analyze --json` | exit 0; 422.1, 987.7 | exit 0; 394.4, 984.8 | exit 0; 388.2, 1,001.2 |
| `model` | exit 0; 422.4, 1,090.4 | | |
| `model --json` | exit 0; 419.8, 1,550.2 | exit 0; 483.2, 1,088.3 | exit 0; 486.2, 1,213.8 |
| `verify --json` | exit 3; 720.7, 1,464.9 | abort | exit 3; 756.9, 1,345.3 |
| `verify --assemble --link --json` | exit 3; 720.9, 1,462.5 | abort | exit 3; 757.0, 1,336.7 |
| `verify --printer raw --link --json` | exit 0, links `fb17b88d…`; 708.7, 1,971.3 | abort | exit 0, links; 922.7, 1,346.5 |
| `verify --printer raw --assemble --json` | exit 0; 646.5, 1,992.2 | abort | exit 0; 922.7, 1,349.0 |

The discover analysis: 29,084 functions, 152,412 rejections, `W_READING_BUDGET` once; the model 1,461,873 items, 34,657
chunks, 521 modules; the tree 35,174 files. The readable `verify` exits 3 on text-layout ("Known limitations"). The
heap snapshots of Q7's facts were taken with `--heapsnapshot-near-heap-limit` under 360 MiB (`analyze`) and 560 MiB
(`verify --json`).

### Fix round 4 (`e8869c0`)

**The bin's commands under the 384 MiB cap.** `node --conditions=source bench/src/large-rom.ts --bin [--rom <ROM>]`
(Node 24.15, macOS, 64 GiB): each command its own process from source with the launcher's Node options
(`--max-old-space-size=384`), peak RSS from `bench/src/rss-probe.ts`; every run exits 0, every `--json` run ends in
an ok summary and each `--link` run links the ROM's SHA-1. Peak RSS in MiB:

| ROM | `analyze` | `analyze --json` | `explain --json` | `model` | `model --json` | `verify --json` | `verify --assemble --link` | `verify --printer raw --link` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| synthetic 32 MiB | 808.2 | 765.3 | 768.2 | 811.8 | 785.6 | 805.7 | 782.1 | 811.7 |
| fe7j | 407.0 | 406.9 | 495.9 | 493.4 | 511.3 | 475.3 | 522.5 | 507.4 |
| klonoa | 238.8 | 247.8 | 302.3 | 313.1 | 341.8 | 323.1 | 319.2 | 312.5 |
| pokeemerald | 540.2 | 563.5 | 602.0 | 622.8 | 697.4 | 639.4 | 639.4 | 643.5 |
| sa2 | 394.9 | 397.0 | 425.3 | 427.7 | 522.5 | 474.2 | 431.8 | 422.3 |
| sa3 | 417.6 | 406.6 | 417.8 | 469.8 | 530.4 | 487.2 | 490.2 | 500.3 |
| tmc | 411.3 | 415.9 | 482.8 | 478.8 | 500.9 | 491.3 | 517.3 | 495.2 |

At `d744f5d` the same runs on the synthetic ROM: `analyze` exit 0, `explain --json` exit 0, and `analyze --json`,
`model`, `model --json`, `verify --json`, `verify --assemble --link --json` and `verify --printer raw --link --json`
abort with V8's out-of-memory report (exit 134; the review measured the same). Before the fix, one at a time by hand
under the cap (`/usr/bin/time -l`): `verify --json` 892.5 MiB and out of memory; after `0bb3d75`, 819.1 MiB and exit
0; after `47c3b62`, `analyze --json` 757.6 MiB and exit 0, and into a pipe whose reader sleeps 90 s before reading,
868.4 MiB, exit 0, the same 114,383,843 bytes. The outputs of `analyze --json`, `model --json`, `verify --json` and
`verify --assemble --link --json` under the cap are byte-identical to `d744f5d`'s without a cap.

**The gate's children, with the live heap.** `node --conditions=source bench/src/large-rom.ts --json` at `e8869c0`'s
tree, three runs on the synthetic ROM (every run exit 0, tree `9d9c915d…`), and once per tuning ROM (`--rom`, every
tree digest as recorded below); `peakLiveHeapMiB` is the largest heap V8 found live after a full mark-compact:

| Run | `init` peak RSS | `init` live heap | `generate` peak RSS | `generate` live heap |
| --- | --- | --- | --- | --- |
| synthetic 1 | 814.0 | 318.8 | 785.4 | 349.2 |
| synthetic 2 | 838.9 | 334.9 | 771.7 | 333.2 |
| synthetic 3 | 840.9 | 351.6 | 765.6 | 330.4 |
| synthetic, the closing list's `run --scaffold` at `81210eb` | 864.0 | 314.5 | 788.7 | 353.0 |
| fe7j | 480.2 | 75.8 | 490.6 | 88.6 |
| klonoa | 332.8 | 36.7 | 311.4 | 34.6 |
| pokeemerald | 635.4 | 153.5 | 646.5 | 158.8 |
| sa2 | 445.3 | 82.7 | 464.8 | 84.3 |
| sa3 | 512.4 | 112.0 | 443.6 | 62.1 |
| tmc | 507.3 | 102.5 | 486.9 | 88.5 |

**The record of the synthetic ROM's runs under 384 MiB, restated (gate-honesty-r0-2).** Besides the nine runs
recorded at `05fd406` and `739d665` (`init` 817.2 to 866.5 MiB, `generate` 789.3 to 837.9 MiB), the review of
`d744f5d` recorded four more: a fresh clone's `run --scaffold` (`init` 945.5, `generate` 827.1 MiB), a hand run in
the main checkout (918.75, 804.48), the review's gate run (844.1, 836.8) and a fresh worktree's `bench large-rom`
(853.8, 820.8); with the three above and the closing list's two at `81210eb` (`run --scaffold` 864.0 and 788.7 MiB,
the gate 840.4 and 772.3 MiB), eighteen runs: **`init` 814.0 to 945.5 MiB, `generate` 765.6 to 837.9 MiB**.
The budget, 1,088 MiB, was the largest peak then recorded (866.5 MiB) plus 25%; it is **15.1%** above the largest
recorded now (945.5 MiB), and 29.8% above the largest `generate`. It is not raised (D70 c). What meets its limit
first is the old space, not the RSS: the live heap after a full GC reaches 353.0 MiB of the 384 MiB cap (about 31 MiB,
8%, of headroom; the review's `--trace-gc` run saw 326.2 MB), while RSS stays at least 140 MiB under the budget. A
live peak past about 355 MiB is the regression signal (D70 d; replaced in fix round 5 by the bin's recorded maximum,
D71 b).

### The owner's answer to Q6 (`05fd406`)

Memory under the 384 MiB heap cap of Q6's answer (Node 24.15, macOS, 64 GiB, `node --conditions=source
bench/src/large-rom.ts --json [--rom <ROM>]`, both children under `--max-old-space-size=384`, run one after the other;
peak RSS from `process.resourceUsage().maxRSS` of each child). The 32 MiB synthetic ROM (SHA-1 `b846b945…`), five runs
at `05fd406`, and the two hand runs under 384 MiB at `5ae1c1c` (below); every run exits 0 and writes the tree digest
`9d9c915d…`:

| Run | `init` peak RSS | `generate` peak RSS |
| --- | --- | --- |
| by hand at `5ae1c1c` (each child alone) | 866.5 MiB | 801.4 MiB |
| 1 | 856.1 MiB | 789.3 MiB |
| 2 | 817.2 MiB | 800.9 MiB |
| 3 | 851.9 MiB | 837.9 MiB |
| 4 | 840.7 MiB | 825.4 MiB |
| 5 | 854.9 MiB | 794.8 MiB |
| minimum to maximum | 817.2 to 866.5 MiB | 789.3 to 837.9 MiB |

The budget (D69 b): the largest recorded peak, 866.5 MiB, plus a 25% margin (1,083.1 MiB), rounded up to a multiple of
64 MiB: **1,088 MiB**, against which the gate's own runs are judged (the closing list below records them).

The six tuning ROMs re-measured under 384 MiB, two runs each at `05fd406`; every run exits 0 and writes the same tree
digest both times, equal to the digest under 256 MiB:

| ROM | Size | `init` peak RSS | `generate` peak RSS | Tree digest |
| --- | --- | --- | --- | --- |
| fe7j | 16 MiB | 451.8, 448.5 MiB | 483.3, 476.9 MiB | `ad2ee4a2…` |
| klonoa | 4 MiB | 331.5, 328.2 MiB | 310.6, 311.5 MiB | `917a55c7…` |
| pokeemerald | 16 MiB | 667.8, 653.2 MiB | 652.8, 639.4 MiB | `13f71c43…` |
| sa2 | 16 MiB | 470.1, 477.7 MiB | 462.8, 458.1 MiB | `116b1bb3…` |
| sa3 | 16 MiB | 518.3, 514.8 MiB | 439.8, 449.2 MiB | `4390a358…` |
| tmc | 16 MiB | 503.8, 502.4 MiB | 483.8, 479.5 MiB | `cfcd95a9…` |

### The owner's answers (`5ae1c1c`)

Memory under the heap cap of Q2's answer (Node 24.15, macOS, `bench large-rom`; each command its own process, peak
RSS from `process.resourceUsage().maxRSS`). The six tuning ROMs, `npm run bench -- large-rom --json --rom <ROM>` (both
children under `--max-old-space-size=256`), two runs each; every run exits 0 and writes the same tree digest both
times:

| ROM | Size | `init` peak RSS | `generate` peak RSS | Tree digest |
| --- | --- | --- | --- | --- |
| fe7j | 16 MiB | 482.1, 492.9 MiB | 469.4, 475.9 MiB | `ad2ee4a2…` |
| klonoa | 4 MiB | 329.9, 327.2 MiB | 310.9, 309.5 MiB | `917a55c7…` |
| pokeemerald | 16 MiB | 566.8, 565.6 MiB | 584.5, 560.6 MiB | `13f71c43…` |
| sa2 | 16 MiB | 439.9, 440.3 MiB | 449.7, 427.6 MiB | `116b1bb3…` |
| sa3 | 16 MiB | 484.3, 483.8 MiB | 442.7, 438.8 MiB | `4390a358…` |
| tmc | 16 MiB | 477.1, 472.5 MiB | 459.3, 484.7 MiB | `cfcd95a9…` |

The 32 MiB synthetic ROM (SHA-1 `b846b945…`), `npm run bench -- large-rom --json`, two runs at `5ae1c1c` and the
gate's own run in the closing list below: `init` ends every time in `FATAL ERROR: Reached heap limit Allocation
failed - JavaScript heap out of memory` (exit 128, the child killed by SIGABRT), so `generate` has no config. The
same children by hand (`node --conditions=source --max-old-space-size=<cap> bench/src/large-rom.ts --child
init|generate …`, `generate` over a config an uncapped `init` wrote):

| Old-space cap | `init` | `generate` |
| --- | --- | --- |
| 256 MiB (the bin's) | out of memory | out of memory |
| 320 MiB | out of memory | out of memory |
| 384 MiB | exit 0, 866.5 MiB peak RSS | exit 0, 801.4 MiB |
| 512 MiB | exit 0, 1,002.0 MiB | exit 0, 956.7 MiB |
| none (V8's default) | 1,014.4 to 1,273.5 MiB (Q2's table) | 1,019.0 to 1,493.2 MiB |

Every completed run writes the tree digest `9d9c915d…`, as before. Where the old space goes, from a heap snapshot
V8 wrote at the 256 MiB limit during `init`'s discover analysis (`--heapsnapshot-near-heap-limit`): about 250 MiB
live, of which the candidate readings of the epoch (37,141 readings: 949,154 `{addr, len}` instruction objects of 40
bytes, each `addr` a 16-byte heap number, about 20 lists per reading, 4.1 MiB of them empty arrays) and the
rejections (319,653 records of 88 bytes, a 14 MiB map table, and their `detail` strings as 765,594 concatenated
strings) are most; the validity memo's map table is 14 MiB and the harvest's `earlier` set 10 MiB. The ROM image and
the claim kinds (32 MiB each) are external memory, outside the old space. The closing round's statement that
`discover` alone completes under `--max-old-space-size=256` at 595 to 684 MiB (above, and Q2's option (c)) does not
reproduce: it fails at `682da72` too, measured the same way.

### Fix round 3 (`5acf06a`)

Node 24.15, binutils 2.45.1, objdiff-cli 3.7.2. Fixtures: 47 of 47 pass the model self-checks, the text-layout and
paths checks of both printers and link to their SHA-1 with both printers; the writer, model and analysis goldens and
the 47 trees' digests are unchanged (no fixture or tuning ROM has a branch the interworking rule prints raw, and no
module name the new checks refuse). Every tuning ROM: self-checks ok, raw and readable link to the SHA-1,
readability at its floor, analysis rows unchanged (`bench regression` against `c5cc0b1`: no regression). The objdiff
totals per kind equal fix round 2's, so Q1's table stands.

| ROM | objdiff scored | gated (D34) | `unnamed-target` | `generate` + write CPU | `init` CPU |
| --- | --- | --- | --- | --- | --- |
| fe7j | 1,471 | 200 | 55 | 3,486 ms | 4,484 ms |
| klonoa | 485 | 320 | 0 | 1,056 ms | 1,312 ms |
| pokeemerald | 15,850 | 13,788 | 2,758 | 7,976 ms | 10,230 ms |
| sa2 | 2,887 | 1,374 | 143 | 2,319 ms | 3,073 ms |
| sa3 | 4,305 | 564 | 44 | 3,030 ms | 4,228 ms |
| tmc | 8,388 | 895 | 357 | 3,636 ms | 4,986 ms |

(`bench speed`, calibration ratio 0.945; `g3.speed-budget`'s own run: ratio 0.944, pokeemerald `generate` 7,860 of
9,441 ms, `init` 10,269 of 14,162 ms.) Large ROM: `init` 1,141.7 and `generate` 1,455.1 MiB (`run --scaffold`),
1,144.3 and 1,025.6 MiB (`g3.large-rom`), the same tree digest `9d9c915d…`.

### Fix round 2 (`11c49fe`)

Node 24.15, binutils 2.45.1, objdiff-cli 3.7.2. Fixtures: 47 of 47 pass the model self-checks, the text-layout and
paths checks of both printers and link to their SHA-1 with both printers; the writer, model and analysis goldens
and the 47 trees' digests are unchanged (no fix of this round changes an emitted byte). Every tuning ROM: self-checks
ok, raw and readable link to the SHA-1, readability at its floor, analysis rows unchanged (`bench regression`
against `c5cc0b1`: no regression). The objdiff totals per kind are fix round 1's; their classes are Q1's table.

| ROM | objdiff scored | gated (D34) | `unnamed-target` | gated under Q1 option (b) | `generate` + write CPU | `init` CPU |
| --- | --- | --- | --- | --- | --- | --- |
| fe7j | 1,471 | 200 | 55 | 9 | 3,596 ms | 4,761 ms |
| klonoa | 485 | 320 | 0 | 3 | 1,082 ms | 1,310 ms |
| pokeemerald | 15,850 | 13,788 | 2,758 | 18 | 7,890 ms | 10,226 ms |
| sa2 | 2,887 | 1,374 | 143 | 7 | 2,389 ms | 3,048 ms |
| sa3 | 4,305 | 564 | 44 | 51 | 3,110 ms | 4,115 ms |
| tmc | 8,388 | 895 | 357 | 22 | 3,563 ms | 4,909 ms |

(`bench speed`, calibration ratio 0.945; `g3.speed-budget`'s own run: ratio 0.944, pokeemerald `generate` 7,823 of
9,439 ms, `init` 10,337 of 14,158 ms.) Large ROM: `init` 1,055.5 and `generate` 1,372.9 MiB (`run --scaffold`),
1,258.1 and 1,129.9 MiB (`g3.large-rom`), the same tree digest `9d9c915d…`.

### Fix round 1 (`29b3563`)

Node 24.15, binutils 2.45.1, objdiff-cli 3.7.2. Fixtures: 47 of 47 pass the model self-checks, the text-layout and
paths checks of both printers and link to their SHA-1 with both printers; the writer goldens and the 47 trees'
determinism are unchanged. Every tuning ROM: self-checks ok, raw and readable link to the SHA-1, readability
99.999% to 100% (at its floor, as before), analysis rows unchanged (`bench regression` against `c5cc0b1`: no
regression).

| ROM | objdiff scored | gated (D34) | `unnamed-target` | gated under Q1 option (b) | `generate` + write CPU | `init` CPU |
| --- | --- | --- | --- | --- | --- | --- |
| fe7j | 1,471 | 200 | 55 | 9 | 3,625 ms | 4,832 ms |
| klonoa | 485 | 320 | 0 | 3 | 1,070 ms | 1,332 ms |
| pokeemerald | 15,850 | 13,788 | 2,758 | 18 | 8,209 ms | 10,690 ms |
| sa2 | 2,887 | 1,374 | 143 | 7 | 2,396 ms | 3,101 ms |
| sa3 | 4,305 | 564 | 44 | 51 | 3,204 ms | 4,330 ms |
| tmc | 8,388 | 895 | 357 | 21 | 3,725 ms | 5,197 ms |

(`bench speed`, calibration ratio 0.976; `g3.speed-budget`'s own run: ratio 1.029, pokeemerald `generate` 8,002 of
10,291 ms, `init` 10,522 of 15,436 ms.) The objdiff totals moved from the closing round's 201 / 320 / 13,785 / 1,375 /
565 / 895: the bases that did not assemble are compared now, and resolved `b`s count as `resolved-call` (D65 i).
Large ROM: `init` 1,079.6 and `generate` 1,091.9 MiB (`run --scaffold`), 1,089.7 and 1,121.3 MiB (`g3.large-rom`).

### Closing round (`682da72`)

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

Every owner decision of architecture §12 is built with its documented safe default (D62 i). Two gates failed after
fix rounds 1, 2 and 3 (`g3.objdiff`, `g3.large-rom`), and three limitations or gate narrowings were made without the owner's
words (Q3 to Q5). **The owner answered Q1 to Q5 on 19 October 2026** (D68; each answer under its question).
Applying Q2's answer raised Q6, which he answered the same day (D69). The review of `16d1280` found a 32 MiB ROM
of real code density that does not complete under Q6's cap: Q7 (D71), **which he answered the same day** (D72).

### Q1. `g3.objdiff`: almost every remaining difference links to the same word

**Answered on 19 October 2026: "Move gate to phase 5"** (D68 a). g3.objdiff moves to phase 5 (where the `expected/`
objects and objdiff targets are built); phase 3 records the classified counts below as its measurement; the
committed classifier stays. In phase 5 the gate applies as D34 writes it unless the owner amends it then.

Facts. D34 gates every objdiff difference but `unnamed-target`. After D64 b and c and fix round 1 (D65 i: every base
assembles, a resolved `b` or ARM `bl` pairs like a `bl`), each difference sorted by the committed classifier
(`node --conditions=source bench/tools/objdiff-classes.ts`, `bench/src/objdiff-classes.ts` and its test). Since fix
round 2 (D66 g, architecture-r1-1) a class that says both sides link to the same word is given only when that is
checked: the word (or branch target) each side links to is computed from the reference ELF's addresses and Thumb
bits, the reference relocation's addend read from the reference object, and the base's addend or plain value read
from the base object; a difference whose facts are missing would be `unverified` and stay gated. This table is the
tool's output at fix round 2 (at the classifier commit `1ac3527`, all six tuning ROMs, 1 min 56 s). Every readable tree links to
its ROM's SHA-1 (`g3.link` 6 of 6), so none of these changes a byte of the build.

| Class | fe7j | klonoa | pokeemerald | sa2 | sa3 | tmc |
| --- | --- | --- | --- | --- | --- | --- |
| `resolved-call`: a `bl` or `b` the reference's `as` resolved inside its object, which the base, assembled one function per file, relocates against the same function (the offset checked) | 8 | 0 | 11,798 | 1,019 | 68 | 323 |
| `static-callee`: the same, to a callee the reference object names otherwise; the reference's target (its section's linked start plus the offset) is an address the ELF gives the base's callee | 0 | 0 | 208 | 113 | 63 | 0 |
| `value-named`: `.word <value>` against `.word <name>` where the name links to that value, Thumb bit included | 9 | 0 | 14 | 11 | 19 | 0 |
| `alias`: two names of one address, both sides with their addends linking to the same word (tmc's `gMenu`/`gChooseFileState`, `GetMonData3`/`GetMonData2`, statics named twice) | 13 | 0 | 472 | 36 | 16 | 360 |
| `symbol-addend`: the reference's `sym + addend` links to the word the base's label does, and that label lies inside the symbol's ELF size | 5 | 0 | 60 | 15 | 11 | 1 |
| `value-for-symbol`: the reference relocates against `sym + addend`, the base holds a plain value, and the two are the same word (R_ARM_ABS32) or the same branch target (R_ARM_THM_CALL) | 130 | 166 | 765 | 46 | 99 | 188 |
| `unverified`: one of the shapes above whose addend, plain value or entry is unknown | 0 | 0 | 0 | 0 | 0 | 0 |
| `missing-symbol`: no reference object defines the name (libgcc, libc, archive members linked from outside `objectsDir`) | 26 | 21 | 453 | 127 | 237 | 1 |
| `tool`: objdiff-cli 3.7.2 refuses the reference object (klonoa `src/code_0804B254.o`, "Invalid instruction size 1") | 0 | 130 | 0 | 0 | 0 | 0 |
| `trailing-pad`: a zero halfword after the last instruction that the ELF's size counts and the base leaves to the next `.align` | 1 | 0 | 0 | 6 | 39 | 0 |
| `relocation-other`: two words that differ, or one word reached through a label outside the symbol's ELF size or a name with no size (`gCryTable + n`, `gHUD` against `gUnk_0200AF34`) | 7 | 3 | 12 | 1 | 12 | 22 |
| `instruction-other`: fe7j PutUnkSprite's dead `b` after a `b`, printed `@ dead` (D16); pokeemerald GameCubeMultiBoot_HandleSerialInterrupt's three `lsrs; bcc` pairs the analysis claims as data | 1 | 0 | 6 | 0 | 0 | 0 |
| `assemble`, `score` | 0 | 0 | 0 | 0 | 0 | 0 |
| total gated (D34) | 200 | 320 | 13,788 | 1,374 | 564 | 895 |
| `unnamed-target` (reported, not gated) | 55 | 0 | 2,758 | 143 | 44 | 357 |
| gated under option (b): `unverified`, `trailing-pad`, `relocation-other`, `instruction-other`, `assemble`, `score` | 9 | 3 | 18 | 7 | 51 | 22 |

The check moved one difference: a tmc pair of names of one address whose two sides do not link to the same word
(the fix-round-1 classifier, which compared addresses only, called it `alias`); it is `relocation-other` now and
gated under every option. Every other count equals fix round 1's.

Measured for `trailing-pad`: the ELF counts the zero halfword after a function ending at 2 mod 4 in 46 functions and
leaves it out in 7,008 with the same bytes (sa3 39 of 778, sa2 6 of 447, fe7j 1 of 313, pokeemerald 0 of 3,202,
klonoa 0 of 45, tmc 0 of 2,269), so no emission rule over the bytes can follow the reference: folding the pad into
the function would swap 46 differences for 7,008.

Options.

- (a) Keep D34 as written (the default; phase 3 stays open). Closing it needs: the base assembled per reference
  object, every function of that object in one file, so calls resolve as in the reference; the printer emitting
  `sym + addend` for a word inside a sized symbol (an emission rule, with sizes in `[symbols]`); names chosen per
  reference object for aliases and statics; the archive members as reference objects; an objdiff-cli that reads
  klonoa's `code_0804B254.o`; and the reference's symbol sizes for the trailing pads, which the bytes do not carry.
- (b) Amend D34: report, not gate, the differences whose two sides are checked to link to the same word (the
  `resolved-call`, `static-callee`, `value-named`, `alias`, `symbol-addend` and `value-for-symbol` classes) and list
  the functions objdiff cannot compare (`missing-symbol`, `tool`) by count. The gated remainder is the last row (110
  differences; 46 of them trailing pads, which need the owner's word on the reference's sizes, 7 instructions that
  are an analysis or D16 matter, and 57 relocations whose words differ or that pass outside a symbol's size).
- (c) Move `g3.objdiff` to phase 5, where the `expected/` objects and objdiff targets are built (D34 rejected it
  once), with these numbers recorded as the phase-3 measurement.

### Q2. `g3.large-rom`: peak RSS about twice the 512 MiB budget, and the 16 MiB tuning ROMs above it too

**Answered on 19 October 2026: "Measure under a heap cap"** (D68 b). The romlift bin launcher and the gate run Node
with --max-old-space-size=256; the gate measures peak RSS under that cap and its budget is set from that measurement
with a stated margin; the 16 MiB tuning ROMs are measured under the same cap and recorded (they must complete under
it). They do; the synthetic ROM does not, which is Q6.

Facts. Every recorded run of the 32 MiB synthetic ROM (SHA-1 `b846b945…`, 3,639 functions) since D64 e, per command
(peak RSS of the command's own process):

| Run | `init` | `generate` |
| --- | --- | --- |
| `run --scaffold` memory family at `682da72` | 1,081.0 MiB | 1,359.3 MiB |
| `g3.large-rom` at `682da72` | 1,122.5 MiB | 1,019.0 MiB |
| the review's `gates --tier ci` at `9b3f244` | 1,273.5 MiB | 1,349.2 MiB |
| the review's second `gates --tier ci` at `9b3f244` | 1,106.4 MiB | 1,056.1 MiB |
| fix round 1, `run --scaffold` memory family at `29b3563` | 1,079.6 MiB | 1,091.9 MiB |
| fix round 1, `g3.large-rom` (`gates --tier ci`) at `29b3563` | 1,089.7 MiB | 1,121.3 MiB |
| fix round 1, `bench large-rom` alone at `29b3563` (one scratch change: every file flushed; RSS is not the write's) | 1,021.6 MiB | 1,082.5 MiB |
| the second review's `run --scaffold` memory family at `e048247` | 1,127.7 MiB | 1,415.2 MiB |
| the second review's `gates --require 3 --tier ci` at `e048247` | 1,014.4 MiB | 1,098.5 MiB |
| fix round 2, `run --scaffold` memory family at `11c49fe` | 1,055.5 MiB | 1,372.9 MiB |
| fix round 2, `g3.large-rom` (`gates --tier ci`) at `11c49fe` | 1,258.1 MiB | 1,129.9 MiB |
| the third review's `run --scaffold` memory family at `e0815d9` | 1,190.9 MiB | 1,134.1 MiB |
| the third review's `gates --require 3 --tier ci` at `e0815d9` | 1,172.2 MiB | 1,493.2 MiB |
| fix round 3, `run --scaffold` memory family at `5acf06a` | 1,141.7 MiB | 1,455.1 MiB |
| fix round 3, `g3.large-rom` (`gates --tier ci`) at `5acf06a` | 1,144.3 MiB | 1,025.6 MiB |
| minimum to maximum of these runs | 1,014.4 to 1,273.5 MiB | 1,019.0 to 1,493.2 MiB |

The spread is V8 sizing its heap to the machine and the moment, with the same source and the same tree digest
(`9d9c915d…`) every time; it is not bounded by the recorded runs, and a later run can exceed every one of them (the
review's 1,415.2 MiB exceeded fix round 1's stated maximum, delivery-r1-1, and the third review's 1,493.2 MiB exceeded
that, delivery-r2-1).

Before D64 e: 1,845.7 (`init`) and 1,366.3 MiB (`generate`). The "1,019 to 1,495 MiB" spread the closing round
quoted has no recorded run behind its 1,495 MiB and is withdrawn. The live set after the analysis is about 225 MiB
(136 MiB heap, 89 MiB external), but V8 lets the heap grow to 300 to 400 MiB of live data plus garbage during the
gap scan; a 256 MiB heap cap still peaks at 595 to 684 MiB RSS.

The tuning ROMs, at most 16 MiB, are above 512 MiB too (fix round 1, `/usr/bin/time -l`, one process each, Node
24.15; `verify` without `--assemble`/`--link` is generate's check pass without the write):

| ROM | `model --json` | `verify` | `verify --link` |
| --- | --- | --- | --- |
| fe7j | 594 MiB | 539 MiB | |
| klonoa | 348 MiB | 366 MiB | |
| pokeemerald | 940 MiB | 1,001 MiB | 1,085 MiB |
| sa2 | 615 MiB | 649 MiB | |
| sa3 | 605 MiB | 610 MiB | |
| tmc | 575 MiB | 593 MiB | |

Options.

- (a) Keep 512 MiB (the default; phase 3 stays open). It needs further structural work: readings' instruction
  spans as typed arrays (a public `Reading` type change), fewer candidate readings held per epoch, the pointer
  index and the rejection details out of the heap, and a heap cap set by the `romlift` launcher; and it has to
  bring the 16 MiB tuning ROMs (0.35 to 1.1 GiB today) down too, since a user's ROM of that size runs the same
  code.
- (b) Raise the budget to a measured value with margin, keeping the ratchet. No recorded run sets the bound: every
  review round has exceeded the previous maximum (1,415.2 MiB at `e048247`, then 1,493.2 MiB, `generate` at
  `e0815d9`). Sized against today's largest with a 25% margin, rounded up to 128 MiB, it would be at least 1,920
  MiB, and a later run can still exceed it; D42 rejected 1 GiB budgets as hiding leaks. Under it pokeemerald's
  1.0 to 1.1 GiB would pass; the gate measures only the synthetic ROM.
- (c) Measure the gate under a fixed heap cap (`--max-old-space-size=256`, which the `romlift` bin would also
  pass), so it measures the live set rather than V8's sizing, and set the budget from that measurement (595 to 684
  MiB today on the synthetic ROM); the 16 MiB ROMs would run under the same cap, which has not been measured on
  them.

### Q3. D64 d: generated files written without a flush, and `g3.speed-budget`

**Answered on 19 October 2026: "Accept, don't flush generated"** (D68 c). Generated files are not flushed; the
journal, manifest, user edits, scaffold and C stubs stay flushed; `g3.speed-budget` unchanged.

Facts. D64 d replaced architecture §6.4's "each op through a temporary file and a rename" (each file flushed) by: the
journal, the manifest, edits and scaffold and c-stub files flushed; generated files renamed into place without an
`fsync`, an absent one created in place. A crash can leave a generated file short; the next run's snapshot sees its
sha1 differ and rewrites it, the journal naming it owned. The owner has not authorised this limitation in his own
words. Measured on pokeemerald (`npm run bench -- speed --only pokeemerald`, fix round 1, calibration ratio
0.967, budgets 10 s and 15 s times the ratio: 9,665 and 14,498 ms):

| Write | `generate` and its write | `init` |
| --- | --- | --- |
| D64 d (generated files unflushed) | 8,360 ms CPU | 10,422 ms CPU |
| every file flushed (a scratch build, `durableOp` true for every op) | 23,997 ms CPU | 23,929 ms CPU |

`g3.speed-budget` passes with D64 d; with every file flushed it fails (`generate` 23,997 against 9,665 ms, `init` 23,929 against 14,498 ms): the
flushes alone cost about 15.6 s of CPU on pokeemerald's 19,121 files, mostly system time in `fsync`, so the gate's
pass depends on the answer.

Options.

- (a) Restore the flush of every file (the architecture as first written) and find the CPU elsewhere (about 14.3 s of `generate`'s CPU would have to be found elsewhere, more than the whole unflushed run).
- (b) Accept D64 d: generated files are rebuilt by the next run after a crash; edits, scaffold files, the journal
  and the manifest stay flushed.
- (c) Keep the flush and change `g3.speed-budget`'s budgets (a gate change).

### Q4. The raw printer's PoC parity ran narrowed (roadmap 3.B)

**Answered on 19 October 2026: "Accept"** (D68 d). The narrowed raw-printer PoC parity (D65 l) is 3.B's gate.

Facts. Roadmap 3.B's gate reads "the raw printer reproduces the PoC's `rawLines` output on every fixture". The
local test `test/local/poc-raw-printer.test.ts` feeds `printRawRange` the PoC's own chunk spans, labels and pool and
table words (from `export-poc --mode raw`) and requires the PoC's lines on all 47 fixtures: it proves the ported
`rawLines`, not that romlift's raw tree equals the PoC's, which it does not wherever romlift's model differs (modules,
the D63 borders, the padding of `cf4f937`). The narrowing is recorded in D65 l; the owner has not authorised it.

Options.

- (a) Accept the narrowed parity as 3.B's gate (D65 l), the raw trees' links (`g3.raw-link`, 6 of 6 and 47 of 47)
  covering the rest.
- (b) Require the raw tree to equal the PoC's tree file for file on every fixture: it fails today on every fixture
  whose model differs, by design (D63), so this would need a list of accepted differences.

### Q5. Limitations carried into phase 4

**Answered on 19 October 2026: "Accept Q5a; fix Q5b, c in phase 4"** (D68 e). (a) The alignment refusal is a
recorded release-1 limitation; (b) padding-only orphans are folded into the next function and (c) confirm stops
re-validating functions discover listed (measured against g2's gates): both are phase-4 work items, in roadmap.md's
phase 4 ("Carried from phase 3").

Facts. Each is measured and recorded under "Known limitations"; none breaks a gate today, and none is authorised in
the owner's words.

- (a) **A ROM whose size the last unit's section alignment does not divide is refused** (D65 a): verify exits 3
  with E_SELF_CHECK_TEXT, nothing is written. A 2 mod 4 cut with a data module last still links. To make every size
  link the tree would need a last unit of alignment 1 (a data file opening in ARM state with no instruction) or a
  trimming step after objcopy.
- (b) **Padding-only orphans** (delivery-13): with the discover model, 3,203 of pokeemerald's 3,222 orphan files
  hold only `.align 2, 0` (tmc 2,289 of 2,320, fe7j 1,530 of 1,558, sa3 867 of 882, sa2 448 of 464, klonoa 64 of 87).
  Phase 4 would give each orphan in a C module its own INCLUDE_ASM stub. Folding the pad into the next function's
  `thumb_func_start` (which emits it already) removes the files without changing a byte, but changes the chunk model
  and plan.md's reading of "No orphan bytes".
- (c) **The generate path warns on every tuning ROM** (delivery-4): `W_LISTED_INVALID` for functions romlift's own
  discover run listed (fe7j 5, klonoa 4, pokeemerald 6, sa2 4, sa3 4, tmc 24, by rule: valid.dense, valid.in-rom-
  unclaimed, valid.returns-or-prologue, and on tmc valid.no-claimed-code and valid.balanced-stack), plus sa3's 4
  `W_WALK_LIMIT` and tmc's `W_UNLISTED_FUNCTION` (0x080B1A28, seed.ram-copy). Phase 4's `init` then `generate`
  prints them to every user. Confirm still equals discover on functions and extents.

Options: (i) accept each as a recorded limitation of release 1; (ii) fix (a) or (b) in phase 4 before 4.C plans the
stubs; (iii) for (c), make the confirm run not re-validate the functions configFromDiscover listed (an analysis
change, measured against g2's gates).

### Q6. `g3.large-rom` under the heap cap: the 32 MiB synthetic ROM does not complete under 256 MiB

**Answered on 19 October 2026: "384 MiB for bin and gate"** (D69). The romlift bin launcher and g3.large-rom both use
--max-old-space-size=384 (this replaces Q2's 256); every ROM size up to 32 MiB must complete under it; the gate's
peak-RSS budget is set from the recorded runs under the 384 MiB cap plus a stated margin; the 16 MiB tuning ROMs are
re-measured under 384 and recorded. Applied: `05fd406` (the cap), `a206ac1` (the budget, 1,088 MiB: the largest
recorded peak, 866.5 MiB, plus 25%, rounded up to a multiple of 64 MiB); the runs are under "Measured numbers".

Facts. Q2's answer, "Measure under a heap cap", runs the bin and the gate with `--max-old-space-size=256` and sets
the budget from the measurement under the cap. Q2's option (c) said the synthetic ROM's discover run completes under
that cap at 595 to 684 MiB; it does not, at `5ae1c1c` or at `682da72`. Measured ("Measured numbers", the owner's
answers): under 256 MiB (and 320 MiB) both `init` and `generate` on the synthetic ROM end in V8's out-of-memory
abort; under 384 MiB they complete at 866.5 and 801.4 MiB peak RSS; the six tuning ROMs, 4 to 16 MiB, all complete
under 256 MiB at 309 to 585 MiB. The live old space during the discover analysis reaches about 300 MiB on the
synthetic ROM (250 MiB live at the 256 MiB limit and still growing), most of it candidate readings held for the epoch
(D13, bounded by `epochReadingBytes`, 256 MiB by the reading-size estimate) and rejections. `g3.large-rom` fails:
`init: exited 128 under the 256 MiB heap cap (no report: FATAL ERROR: Reached heap limit …)`. No budget was set,
since no run under the cap completed; the gate keeps D42's 512 MiB.

Options.

- (a) Keep the 256 MiB cap and make the synthetic ROM fit (phase 3 stays open): the analysis must hold about 100 MiB
  less at its peak. Candidates, each to be measured, none of them changing a result: shared empty lists in every
  reading (measured: about 16 MiB less, not enough alone), instruction spans stored as typed arrays rather than
  `{addr, len}` objects (a public `Reading` type change), rejection details kept flat or built on demand, the
  validity memo and the harvest set as typed arrays outside the heap. Lowering the reading budget
  (`epochReadingBytes`) also bounds it but changes when readings are walked again, so it is an analysis change to
  be measured against g2's gates (pokeemerald holds 208 MB by the estimate in one epoch).
- (b) Raise the cap the bin and the gate pass to a measured value that holds the synthetic ROM (384 MiB completes;
  320 MiB does not), and set the budget from the runs under it with a stated margin (866.5 and 801.4 MiB measured
  under 384 MiB).
- (c) Keep 256 MiB for the bin, and run the gate on the synthetic ROM under a larger cap (or none), its budget from
  those runs: the gate then no longer measures what a user's run under the bin holds on a 32 MiB ROM.

### Q7. A code-dense 32 MiB ROM does not complete under the 384 MiB cap

**Answered on 19 October 2026: "Raise cap to 1,024 MiB"** (option b, D72). The romlift bin launcher and g3.large-rom both
use --max-old-space-size=1024 (this replaces Q6's 384); g3.large-rom's peak-RSS budget is set again from recorded runs
under the 1,024 MiB cap plus a stated margin; the synthetic image and the six tuning ROMs are re-measured under 1,024
and recorded; the doubled ROM must complete every bin command form of bench large-rom --bin --rom under the cap, and
its numbers are recorded. Its readable verify failing the text-layout check on the two adr lines that name a function
label (adr r6, sub_0906A708) is a phase-4 work item the owner assigned, so in phase 3 that exit 3 is recorded as a
known limitation, not a failure; the raw printer must link to its SHA-1. Adding a dense ROM to the gate itself is not
authorised. Applied: `1443c2c` (the cap), `745505f` (the budget, 1,536 MiB); the runs are under "Measured numbers".

Facts (as raised, under the 384 MiB cap). Q6's answer says "every ROM size up to 32 MiB must complete under it". Every
ROM the record measured, but one, completes: the 32 MiB synthetic image of `g3.large-rom` (Node 24.15 and 22.18,
macOS and Linux) and the six tuning ROMs (4 and 16 MiB; Node 24.15, macOS) ("Measured numbers", fix round 5). The synthetic image is code-sparse:
fixture code tiled with seeded data, 3,639 functions and 11,718 instructions. The review of `16d1280` (correctness-r1-1)
built a 32 MiB ROM of real code density, `pokeemerald.gba` twice over (SHA-1 `fb17b88d…`, never committed; "the doubled
ROM"), and the bin fails on it.

Facts (Node 24.15, macOS; the doubled ROM, built the same way, every number measured in this round):

- Under the bin's cap, every one of the twelve commands `bench large-rom --bin --rom` runs ends in V8's out-of-memory
  abort, `analyze` included (`fa4f71b`); so does `bench large-rom --rom`'s `init` (its `generate` then has no config).
- Without a cap (the analysis is `16d1280`'s; this round changed only the bench and `analyze`'s text output):
  `analyze` finds 29,084 functions and 152,412 rejections and raises `W_READING_BUDGET`; the model has 1,461,873 items,
  34,657 chunks and 521 modules; the tree has 35,174 files. The largest heap live after a full mark-compact (`--trace-gc`)
  is 421 MiB for `analyze`, 420 MiB for `model --json`, 721 MiB for `verify --json` and 709 MiB for `verify --printer
  raw --link --json`; peak RSS 1.0 to 2.0 GiB.
- Under larger caps: at 768 MiB `analyze`, `analyze --json` and `model --json` complete and every `verify` form aborts;
  at 1,024 MiB every command completes. The readable `verify` then exits 3: its text-layout check fails on two `adr`
  lines of the second copy (`cannot encode \`adr r6, sub_0906A708\` at 0x0906A56C`), a printer defect no tuning ROM shows
  ("Known limitations"); the raw printer's tree links to `fb17b88d…`.
- Where the memory goes, from heap snapshots at the limit. The analysis (360 MiB cap, 424 MiB in the snapshot): 2.30
  million `{addr, len}` instruction spans of the readings, 87.8 MiB, with 35.1 MiB of boxed `addr` numbers (16 bytes
  each), and 1.1 million arrays, 97 MiB with their elements. `verify` (560 MiB cap, 613 MiB): the tree's text, 153 MiB of
  strings, and the text-layout check's parsed statements (1.73 million `{kind, value}` operands, 92 MiB with their
  numbers; 432,000 data statements, 23 MiB) and 117 MiB of array elements; the check holds every file's text and
  statements at once.
- The synthetic image itself has little headroom: the largest live heap of a bin command is 377.5 MiB on macOS
  and 377.4 MiB on Linux (`verify --assemble`, Node 24), of the 384 MiB old space. `analyze`'s text form
  aborted on it under Node 22.18 until this round streamed its table (`88cede1`).
- No tuning or held-out ROM is 32 MiB; the largest function count among the six is pokeemerald's, 15,856 (16 MiB).

Options.

- (a) **Keep 384 MiB and make a code-dense 32 MiB ROM fit** (phase 3 stays open). `verify` needs more than 768 MiB
  of old space on the doubled ROM today, so its live set must fall by more than half, the analysis's by a quarter
  with headroom. Candidates, each to be measured on the doubled ROM and against g2's and g3's gates (speed
  included), none changing a result: the readings' instruction lists as typed arrays rather than `{addr, len}`
  objects (`Reading.insns`, an internal type used by about twenty rules), addresses kept as small integers, shared
  empty lists; the text-layout check laying out one file at a time and dropping its text and statements, which
  changes how `checkEntries`, `generate` and `verify` pass the tree. This is a redesign of the readings' storage and
  of the check pass, not a fix round; with it, `g3.large-rom` could build a code-dense synthetic image from the
  fixtures (a gate change).
- (b) **Raise the cap of the bin and the gate** to a measured value that holds the doubled ROM: 768 MiB does not,
  1,024 MiB does. `g3.large-rom`'s budget would be set again from runs under the new cap with a stated margin (V8
  sizes its heap to the cap, so the synthetic image's RSS grows too), and the tuning ROMs re-measured.
- (c) **Read "every ROM size up to 32 MiB" as the sizes the synthetic image and the tuning ROMs measure.** A 32 MiB
  ROM of pokeemerald's code density twice over (about 30,000 functions) is a recorded release-1 limitation: the bin
  ends in V8's out-of-memory abort (exit 134). The memory work of (a) becomes a later phase's work item. Phase 3
  lands with its gates as they are, after this round's closing list.

## The closing gate

### Fix round 5

After fix round 5 (D71), with `test/gates/phase.json` at `{ "landed": 3 }`, the whole list ran in a fresh worktree at
`71143d4` (`git worktree add --detach` under the system temporary directory: no `node_modules`, no `bench/.local`;
objdiff-cli 3.7.2 found in the main checkout's build, D65 j), every command from the worktree root in this order with
the environment above, the real tier before the ci tier. Node 24.15, binutils 2.45.1, macOS. Every command exited 0.
Q7 is open, so this run does not land the phase. The worktree was clean afterwards but for the `bench/results.json` the
run wrote (`poc-digests.json` and `poc-dump-rows.json` byte-identical), which is committed as this run's artifact
(`meta.commit` `71143d4`, not dirty, source digest `dc63fdc7…`).

| Command | Exit at `71143d4` | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,950 tests, 1,950 pass, 0 fail |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (246 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 76 tests, 76 pass, 0 skipped; among them `large-rom-bin`: the twelve bin command forms complete on the 32 MiB synthetic ROM under the 384 MiB cap (517 s) |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.1 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass; the memory family under the 384 MiB cap: `init` exit 0 at 882.5 MiB (live heap 314.9 MiB), `generate` exit 0 at 824.2 MiB (334.8 MiB), tree `9d9c915d…` |
| `npm run bench -- speed` | 0 | ratio 0.941, every ROM ok; pokeemerald `generate` 7,839 ms, `init` 10,179 ms CPU |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | 0 | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end, g2.confirm-equals-discover (tmc's 8 recorded), g2.determinism, g2.entries, g2.extents, g2.held-out, g2.no-unreviewed, g2.speed (ratio 0.947), g3.link (47 fixtures, 6 of 6 tuning ROMs), g3.raw-link (53), g3.readability, g3.self-check (53), g3.speed-budget (ratio 0.947; pokeemerald `generate` 7,891 of 9,474 ms, `init` 10,320 of 14,212 ms), g3.text-layout (53), g3.tree-determinism; historical: g2.poc-parity; `g5.objdiff` fail (a phase-5 gate, not required; its counts are Q1's); g4 to g6 others pending (1,129 s) |
| `npm run bench -- gates --require 3 --tier ci` | 0 | every g1, g2 and g3 ci gate passes, among them **`g3.large-rom` pass**: heap cap 384 MiB, `init` 887.2 MiB, `generate` 772.8 MiB (budget 1,088 MiB), tree `9d9c915d…`; g4 to g6 pending |
| `npm run bench -- provenance` | 0 | source digest `dc63fdc7…` (Node 24), 19 real-tier gates of phase ≤ 3 pass or are historical, families live (memory included), 6 rows, no sealed row |
| `npm run bench -- stale-check` | 0 | the artifact is current at `71143d4` |

The two runs of the synthetic ROM in this list join the record under the 384 MiB cap: twenty runs, `init` 814.0 to
945.5 MiB, `generate` 765.6 to 837.9 MiB, all under the 1,088 MiB budget. `phase.json` stays at `{ "landed": 3 }`.
Nothing is merged or pushed.

### Fix round 4 (landing run)

After fix round 4 (D70), with `test/gates/phase.json` at `{ "landed": 3 }` (raised at `739d665`, not lowered: the
landing run there is withdrawn, D69's revision), the whole list ran in a fresh worktree at `81210eb` (`git worktree
add --detach`: no `node_modules`, no `bench/.local`; objdiff-cli 3.7.2 found in the main checkout's build, D65 j),
every command from the worktree root in this order with the environment above, the real tier before the ci tier.
Node 24.15, binutils 2.45.1, macOS. The worktree was clean afterwards but for the `bench/results.json` the run wrote
(`poc-digests.json` and `poc-dump-rows.json` byte-identical), which is committed as this run's artifact
(`meta.commit` `81210eb`, not dirty, source digest `4ad7a6b6…`; its memory member now carries each run's heap cap).

| Command | Exit at `81210eb` | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,948 tests, 1,948 pass, 0 fail |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (261 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 76 tests, 76 pass, 0 skipped; among them `large-rom-bin`: every bin command completes on the 32 MiB synthetic ROM under the 384 MiB cap (342 s) |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok |
| `npm run corpus` | 0 | 100% round trip (thumb, bl, arm) |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass; the memory family under the 384 MiB cap: `init` exit 0 at 864.0 MiB (live heap 314.5 MiB), `generate` exit 0 at 788.7 MiB (353.0 MiB), tree `9d9c915d…` |
| `npm run bench -- speed` | 0 | ratio 0.968, every ROM ok; pokeemerald `generate` 7,955 ms, `init` 10,427 ms CPU |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | 0 | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end, g2.confirm-equals-discover (tmc's 8 recorded), g2.determinism, g2.entries, g2.extents, g2.held-out, g2.no-unreviewed, g2.speed (ratio 0.994), g3.link (47 fixtures, 6 of 6 tuning ROMs), g3.raw-link (53), g3.readability, g3.self-check (53), g3.speed-budget (ratio 0.952; pokeemerald `generate` 8,297 of 9,520 ms, `init` 10,810 of 14,280 ms), g3.text-layout (53), g3.tree-determinism; historical: g2.poc-parity; `g5.objdiff` fail (a phase-5 gate, not required; its counts are Q1's); g4 to g6 others pending (1,194 s) |
| `npm run bench -- gates --require 3 --tier ci` | 0 | every g1, g2 and g3 ci gate passes, among them **`g3.large-rom` pass**: heap cap 384 MiB, `init` 840.4 MiB, `generate` 772.3 MiB (budget 1,088 MiB), tree `9d9c915d…`; g4 to g6 pending |
| `npm run bench -- provenance` | 0 | source digest `4ad7a6b6…` (Node 24), 19 real-tier gates of phase ≤ 3 pass or are historical, families live (memory included), 6 rows, no sealed row |
| `npm run bench -- stale-check` | 0 | the artifact is current at `81210eb` |

`phase.json` stays at `{ "landed": 3 }`. Nothing is merged or pushed.

### The owner's answer to Q6 (landing run)

Withdrawn as a landing by the review of `d744f5d` (D69's revision, D70): the bin's own `verify`, `model` and
`analyze --json` did not complete on the 32 MiB synthetic ROM under the cap, which no command of this list ran.

The landing procedure after the owner's answers to Q1 to Q6 (D68, D69): `test/gates/phase.json` raised to `{ "landed":
3 }` at `739d665`, then the whole list in a fresh worktree (`git worktree add --detach`: no `node_modules`, no
`bench/.local`; objdiff-cli 3.7.2 found in the main checkout's build, D65 j), every command from the worktree root in
this order with the environment above, the real tier before the ci tier. Node 24.15, binutils 2.45.1, macOS. The
worktree was clean afterwards but for the `bench/results.json` the run wrote (`poc-digests.json` and
`poc-dump-rows.json` byte-identical), which is committed as this run's artifact (`meta.commit` `739d665`, not dirty,
source digest `4240d78a…`).

| Command | Exit at `739d665` | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,943 tests, 1,943 pass, 0 fail |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (270 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 75 tests, 75 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.6 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass; the memory family under the 384 MiB cap: `init` exit 0 at 846.6 MiB, `generate` exit 0 at 821.6 MiB, tree `9d9c915d…` |
| `npm run bench -- speed` | 0 | ratio 0.951, every ROM ok; pokeemerald `generate` 8,075 ms, `init` 11,057 ms CPU |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | 0 | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end, g2.confirm-equals-discover (tmc's 8 recorded), g2.determinism, g2.entries, g2.extents, g2.held-out, g2.no-unreviewed, g2.speed (ratio 1.029), g3.link (47 fixtures, 6 of 6 tuning ROMs), g3.raw-link (53), g3.readability, g3.self-check (53), g3.speed-budget (ratio 0.964; pokeemerald `generate` 7,944 of 9,643 ms, `init` 10,380 of 14,464 ms), g3.text-layout (53), g3.tree-determinism; historical: g2.poc-parity; `g5.objdiff` fail (a phase-5 gate, not required; its counts are Q1's); g4 to g6 others pending (1,189 s) |
| `npm run bench -- gates --require 3 --tier ci` | 0 | every g1, g2 and g3 ci gate passes, among them **`g3.large-rom` pass**: heap cap 384 MiB, `init` 850.4 MiB, `generate` 789.9 MiB (budget 1,088 MiB), tree `9d9c915d…`; g4 to g6 pending |
| `npm run bench -- provenance` | 0 | source digest `4240d78a…` (Node 24), 19 real-tier gates of phase ≤ 3 pass or are historical, families live (memory included), 6 rows, no sealed row |
| `npm run bench -- stale-check` | 0 | the artifact is current at `739d665` |

The two runs of the synthetic ROM in this list (the memory family of `run --scaffold` and the gate) join the recorded
runs under the 384 MiB cap: `init` 817.2 to 866.5 MiB, `generate` 789.3 to 837.9 MiB over nine runs, all under the
1,088 MiB budget. `phase.json` stays at `{ "landed": 3 }`. Nothing is merged or pushed.

### The owner's answers (landing run)

The landing procedure after the owner's answers (D68): `test/gates/phase.json` raised to `{ "landed": 3 }` at
`334c0ee`, then the whole list in a fresh worktree (`git worktree add --detach`: no `node_modules`, no `bench/.local`;
objdiff-cli 3.7.2 found in the main checkout's build, D65 j), every command from the worktree root in this order with
the environment above, the real tier before the ci tier. Node 24.15, binutils 2.45.1. The working tree was clean
afterwards but for the `bench/results.json` the run wrote (`poc-digests.json` and `poc-dump-rows.json`
byte-identical), which is committed as this run's artifact (`meta.commit` `334c0ee`, not dirty).

| Command | Exit at `334c0ee` | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,943 tests, 1,943 pass, 0 fail |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset (305 s) |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, `poc-digests.json` byte-identical |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 75 tests, 75 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok |
| `npm run corpus` | 0 | 100% round trip, 4.7 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass; the memory family records `init` exit 128 (out of memory under the cap) and `generate` exit 1 (no config) |
| `npm run bench -- speed` | 0 | ratio 0.981, every ROM ok; pokeemerald `generate` 8,148 ms, `init` 10,554 ms |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | 0 | pass: g1.bench-harness, g1.dataset-elf, g2.baseline-rows, g2.code-end, g2.confirm-equals-discover, g2.determinism, g2.entries, g2.extents, g2.held-out, g2.no-unreviewed, g2.speed, g3.link (6 of 6), g3.raw-link, g3.readability, g3.self-check, g3.speed-budget (ratio 0.946; pokeemerald `generate` 7,825 of 9,456 ms, `init` 10,259 of 14,184 ms), g3.text-layout, g3.tree-determinism; historical: g2.poc-parity; `g5.objdiff` fail (a phase-5 gate, not required; its counts are Q1's); g4 to g6 others pending |
| `npm run bench -- gates --require 3 --tier ci` | **1** | every g1, g2 and g3 ci gate passes but **`g3.large-rom` fail**: `bench large-rom --json exited 1`, `init` exit 128, "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" under `--max-old-space-size=256` (Q6) |
| `npm run bench -- provenance` | 0 | source digest `9163d5a9…` (Node 24), 19 real-tier gates of phase ≤ 3 pass or are historical, families live, 6 rows, no sealed row |
| `npm run bench -- stale-check` | 0 | the artifact is current at `334c0ee` |

One command fails, for a reason outside the answers (Q6): by the landing procedure `phase.json` is back at
`{ "landed": 2 }` (`5067eb6`). The marker is part of the source digest, so the committed artifact, whose digest is
`334c0ee`'s, is stale at the lowered commit (`stale-check` there says so); the next closing run rewrites it. Nothing is
merged or pushed.

### Fix round 3

Run at `5acf06a` in the main checkout, every command from the repository root in this order, the environment
above, `test/gates/phase.json` at `{ "landed": 2 }`: it is not raised, because the phase does not land while Q1 to
Q5 are open (raising it records a landing). `bench/results.json` records `dirty` because this record was being
written during the run; the source digest does not cover `docs/`, and no file it covers changed.

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | pass |
| `npm test` | 0 | 1,941 tests, 1,941 pass, 0 fail (also 1,941 of 1,941 with TMPDIR on a case-sensitive APFS image) |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, equal to `bench/baseline/poc-digests.json` |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 75 tests, 75 pass, 0 skipped (config-mutations added) |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.1 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass |
| `npm run bench -- speed` | 0 | every ROM ok; pokeemerald `generate` 7,976 ms, `init` 10,230 ms |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | **1** | every gate of phase ≤ 3 pass or historical except **`g3.objdiff` fail** (Q1); g4 to g6 pending |
| `npm run bench -- gates --require 3 --tier ci` | **1** | every gate of phase ≤ 3 pass except **`g3.large-rom` fail** (Q2: `init` 1,144.3 MiB, `generate` 1,025.6 MiB) |
| `npm run bench -- provenance` | 0 | ok |
| `npm run bench -- stale-check` | 0 | the artifact is current, source digest `b2d9634c…` |

The phase is not merged, and the branch is not pushed for its pull request, until Q1 to Q5 are answered.
`bench/results.json` is the one this run wrote, committed after it with no source change.

### Fix round 2

Run at `11c49fe` in the main checkout, every command from the repository root in this order, the environment
above, `test/gates/phase.json` at `{ "landed": 2 }` (the phase does not land):

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | 8 packages |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,934 tests, 1,934 pass, 0 fail, 0 todo |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, equal to `bench/baseline/poc-digests.json` |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 74 tests, 74 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.0 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass |
| `npm run bench -- speed` | 0 | every ROM ok; pokeemerald `generate` 7,890 ms, `init` 10,226 ms |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | **1** | every gate of phase ≤ 3 pass or historical except **`g3.objdiff` fail** (Q1); g4 to g6 pending |
| `npm run bench -- gates --require 3 --tier ci` | **1** | every gate of phase ≤ 3 pass except **`g3.large-rom` fail** (Q2: `init` 1,258.1 MiB, `generate` 1,129.9 MiB) |
| `npm run bench -- provenance` | 0 | ok |
| `npm run bench -- stale-check` | 0 | the artifact is current, source digest `af1ab245…` |

The phase is not merged, and the branch is not pushed for its pull request, until Q1 to Q5 are answered.
`bench/results.json` is the one this run wrote (commit `11c49fe`), committed after it with no source change.

### Fix round 1

Run at `29b3563` in the main checkout, every command from the repository root in this order, the environment
above, `test/gates/phase.json` at `{ "landed": 2 }` (the phase does not land):

| Command | Exit | Output |
| --- | --- | --- |
| `npm ci` | 0 | |
| `npm run typecheck` | 0 | no error |
| `npm run lint` | 0 | 21 of 21 pass |
| `npm test` | 0 | 1,914 tests, 1,914 pass, 0 fail, 0 todo |
| `npm run fixtures -- check` | 0 | 47 of 47 fixtures agree (binutils 2.45.1) |
| `npm run export-poc -- --mode scored` | 0 | six scored dumps, tmc from romlift's dataset |
| `npm run export-poc -- --mode parity` | 0 | five parity digests, equal to `bench/baseline/poc-digests.json` |
| `npm run export-poc -- --mode queries` | 0 | five lockstep logs, each parity matching the committed digest |
| `npm run export-poc -- --mode raw` | 0 | 47 fixtures |
| `ROMLIFT_REQUIRE_LOCAL=1 npm run test:local` | 0 | 74 tests, 74 pass, 0 skipped |
| `npm run bench -- doctor-real` | 0 | every input ok (objdiff-cli 3.7.2) |
| `node --conditions=source src/cli/main.ts doctor --json < /dev/null` | 0 | summary ok (agbcc and old_agbcc reported missing, not required) |
| `npm run corpus` | 0 | 100% round trip, 4.3 s |
| `npm run bench -- run --scaffold` | 0 | six rows written, raw and readable SHA-1 on all six, sealed pair pass |
| `npm run bench -- speed` | 0 | every ROM ok; pokeemerald `generate` 8,209 ms, `init` 10,690 ms |
| `npm run bench -- regression` | 0 | no regression against `c5cc0b1` |
| `npm run bench -- dataset-check` | 0 | every dataset agrees with its ELF and its run |
| `npm run bench -- poc-check` | 0 | six ROMs OK |
| `npm run bench -- gates --require 3 --tier real` | **1** | every gate of phase ≤ 3 pass or historical except **`g3.objdiff` fail** (Q1); g4 to g6 pending |
| `npm run bench -- gates --require 3 --tier ci` | **1** | every gate of phase ≤ 3 pass except **`g3.large-rom` fail** (Q2: `init` 1,089.7 MiB, `generate` 1,121.3 MiB) |
| `npm run bench -- provenance` | 0 | ok |
| `npm run bench -- stale-check` | 0 | the artifact is current, source digest `0831b0cc…` |

The phase is not merged, and the branch is not pushed for its pull request, until Q1 to Q5 are answered.
`bench/results.json` is the one this run wrote (commit `29b3563`), committed after it with no source change.

### Closing round

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
- `g3.objdiff` is `g5.objdiff`, a phase-5 gate (Q1's answer); it still runs and fails on the six tuning ROMs, as Q1's
  table classifies.
- The installed `romlift` bin runs with V8's old space capped at 1,024 MiB (Q7's answer, D72, replacing Q6's 384, which
  replaced Q2's 256). Measured on the bin's own twelve command forms under that cap (`bench large-rom --bin`, "Measured
  numbers", the owner's answer to Q7; Node 24.15, macOS): every one completes on every tuning ROM (212.7 to 847.5 MiB
  peak RSS), on the 32 MiB synthetic image (940.0 to 1,217.6 MiB) and on the code-dense doubled ROM (pokeemerald twice
  over, 29,084 functions; 951.6 to 1,376.0 MiB), none aborting. Under Q6's 384 MiB cap every command aborted on the
  doubled ROM (fix round 5, D71 a); the runs of fix rounds 4 and 5 are the record of that cap. Node 22.18 and Linux were
  measured under 384 MiB (fix round 5), not yet under 1,024 MiB; the phase pull request's CI runs `g3.large-rom` on
  both. A ROM whose live set exceeds the 1,024 MiB old space still ends in V8's out-of-memory report (exit 134, outside
  the CLI's exit codes); no ROM measured comes near it but the doubled one.
- The live heap under the 1,024 MiB cap, after a full mark-compact: the synthetic image's gate children reach 348.9 MiB
  and its bin commands 422.6 MiB (`explain --json`), about 601 MiB under the old space; the doubled ROM's bin commands
  reach 922.7 MiB (the raw printer's `verify`), about 101 MiB (10%) under it. D71 b's 2% headroom was the synthetic
  image's under 384 MiB. A bin command's live peak past these recorded maxima is the regression signal. The candidates of
  Q7's option (a) (instruction spans as typed arrays, shared empty lists, the text-layout check one file at a time)
  would lower it; none is done in phase 3, and the owner did not make them a work item.
- **The readable printer's `adr` naming a function label** (found on the doubled ROM in fix round 5, D71 h; by the
  owner's answer to Q7 a phase-4 work item, recorded here as a known limitation of phase 3, not a failure, D72 c): the
  readable printer names the target of two Thumb `adr`s of the doubled ROM's second copy by a function label, `adr r6,
  sub_0906A708` at 0x0906A56C among them, which the text-layout check refuses ("operand out of range or
  unencodable"); the four readable `verify` forms exit 3 and nothing is written (`init` and `generate` likewise), so
  `bench large-rom --bin --rom` exits 1 on that ROM. No fixture or tuning ROM shows it, and the raw printer's tree of
  that ROM links to its SHA-1 `fb17b88d…`. roadmap.md, phase 4, "Carried from phase 3".
- Fix round 1 (D65): a ROM whose size its last unit's alignment does not divide is refused by the text-layout
  check (Q5 a; a release-1 limitation by the owner's answer, D68 e); a `[symbols]` entry inside an instruction gets no label (`W_SYMBOL_UNPLACED`); names starting with
  `$` or `.` are `E_NAME_INVALID`; a `c` module fails the check until phase 4's c-stub writer.
- The generate path warns on every tuning ROM (delivery-4, Q5 c; a phase-4 work item by the owner's answer, D68 e): `W_LISTED_INVALID` fe7j 5, klonoa 4, pokeemerald
  6, sa2 4, sa3 4, tmc 24; sa3 also 4 `W_WALK_LIMIT`, tmc 1 `W_UNLISTED_FUNCTION` (`initModel`, fix round 1). The
  closing round said confirm equals discover only for the fixtures; on the tuning ROMs it equals it on functions and
  extents, with these warnings.
- `g3.tree-determinism` (delivery-5): its "Linux and macOS agree" and Node 22.18 clauses are unmeasured until the
  phase's pull request runs CI (no `phase-3` branch is pushed). `g3.large-rom`'s children were run in fix round 5 under
  Node 22.18 on macOS and under Node 22.18 and 24 in Linux containers; each wrote the tree digest `9d9c915d…` of the
  macOS Node 24 runs (D71 g). The CI's own `g3.large-rom` numbers are recorded when the pull request runs. The gate digests the discover model's tree, not the
  confirm run's with planWrites and the manifest; measured at fix round 1, the generate tree equals the discover
  tree digest for digest on the 47 fixtures (`test/unit/workflow/generate.test.ts`) and on fe7j, klonoa, pokeemerald,
  sa2 and sa3, and differs on tmc by one file (10,971 against 10,970). The gate is not changed (a gate change is the
  owner's); planWrites' order independence is its property test's.
- A user config that removes `label = true` from the startup code inside the cartridge entry's extent brings back
  the confirm-mode startup region of four bytes; if its startup module is still named `crt0`, the paths check
  reports `asm/crt0.s` twice (`E_PATH_CASE_COLLISION`), correctly, and nothing is written. Phase 4's TOML
  patcher should keep that label.
- Generated files are no longer flushed to disk before their rename (D64 d, accepted by the owner, D68 c); a crash
  can leave one short, and the next run rewrites it.
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

- `bench/results.json` was regenerated by the landing run at `739d665` (with its gate record, every gate of phase ≤ 3
  passing or historical, `g5.objdiff` failing as a phase-5 gate); `provenance` and `stale-check` pass on it. A later
  source change moves the source digest again.
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
- Limitation carried into phase 4 (Q5 b; a phase-4 work item by the owner's answer, D68 e), no rule broken: 2-byte (or 1- to 3-byte) zero padding between two functions is an orphan
  chunk of its own (`unk_<ADDR>.s` holding `.align 2, 0`), as the PoC's `tile()` made a gap chunk of it (66 of
  the PoC's 97 gap chunks on the fixtures are under 4 bytes) and as plan.md's "No orphan bytes" rule asks. With
  the discover model, padding-only orphans of all orphans: pokeemerald 3,203 of 3,222, tmc 2,289 of 2,320, fe7j
  1,530 of 1,558, sa3 867 of 882, sa2 448 of 464, klonoa 64 of 87.
  The next function's `thumb_func_start` already emits `.align 2, 0`, so folding the pad into it would remove
  the files without changing a byte; that changes the chunk model and the plan's rule, so it is left as is.

## Review

The review of `9b3f244` (architecture-1 to -14, correctness-1 to -7, delivery-1 to -13). Fix round 1 on the branch
`phase-3`; each fix is its own commit with a test that fails without it where the finding is a defect (D65).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-1 | blocker | **Fixed** (`089ff8d`, D65 c). A `[symbols]` entry inside the ROM gets a data label only where an item can start (the D63 d predicate of the local labels); one inside an instruction, pool word or table entry gets none and is `W_SYMBOL_UNPLACED`; the text-layout check resolves through `[symbols]` only the entries outside the ROM. klonoa with `0x080453F1 = 'gOddSym'`: `W_SYMBOL_UNPLACED`, every check ok, the readable tree links to the SHA-1 (before: checks ok, `undefined reference to gOddSym`). The text-layout mutation test fails before the fix. |
| correctness-2 | major | **Fixed** (`68e4205`, D65 b). planWrites folds the manifest's and journal's paths (`foundation/util/fold.ts`): a tree path that only the case separates from an owned one is always written, and the old spelling's delete sorts first, so applyWrites prunes the emptied directory before the new spelling is made. Unit test (both kinds of snapshot) and an apply test on this case-insensitive file system renaming a module file, a module directory and a chunk file, then re-planning to keeps only; both fail before. |
| correctness-3 | major | **Fixed** (`0f0d36e`). `foundation/util/arrays.ts` pushAll replaces every `push(...lines)` of the printers and the model. klonoa without its data module, and with one module: every check ok, both links reproduce the SHA-1 (before: RangeError). A printer test with a 4 MiB orphan fails before. Printing large data runs as `.incbin` inside code chunks was not done: it changes every tree's text, not a defect. |
| correctness-4 | major | **Fixed as a refusal** (`fb7a5fa`, D65 a). `layoutStatements` reports the section alignment GNU as records (measured with binutils 2.45.1: Thumb state 1, an ARM instruction 2, `.align p` p, `.align 0` 2, data 0), and checkEntries fails a unit whose start or length it does not divide. klonoa cut to 1,048,575 bytes: text-layout fails ("GNU as pads the object's section to a multiple of 2 bytes, 1 past the module's end 0x080FFFFF"), verify exits 3; cut to 1,048,578 bytes still passes and links. A fixture test cuts a data-last and a code-last fixture by 0 to 3 bytes and requires the check's verdict to equal the link's. Emitting such ROMs so they link is owner question Q5 (a). |
| correctness-5 | major | **Fixed** (`afd3af9`, D65 d). `isSymbolName` (a letter or `_`, then letters, digits, `_`, `.`, `$`) in the schema, and `E_NAME_INVALID` in buildModel for function, alias and symbol names. The `g4.toml-mutations` name set is not changed: that gate is phase 4's and its illegal edits need the phase-4 parser's codes; recorded for 4.B. |
| correctness-6 | minor | **Fixed** (`2873d2f`, D65 e). A C module's source is a path the stream must hold, so until the c-stub writer the check fails ("the stream emits no such file, which the model needs"). |
| correctness-7 | minor | **Fixed** (`089ff8d`, D65 e). `W_FUNCTION_OUTSIDE_ROM` for a `[functions]` entry outside the ROM and an `[[overrides]]` range reaching outside it. |
| architecture-1 | major | **Fixed** (`66c625a`, D65 h). `relocationsOf` in `foundation/formats/elf.ts`; compareObject, assembleVerdict, linkVerdict and firstDifference in `core/verify/toolchain.ts` with tests on a hand-built object; link-check.ts runs, writes, reads and hashes only. |
| architecture-2 | major | **Fixed** (`0db9b5b`, D65 g). GenerateResult holds `cx`; `generatedEntries(rom, result)` re-emits. A test walks a result and finds no function. |
| architecture-3 | major | **Fixed** (`0db9b5b`). `initConfig`, `initModel`, `generateFromRom`, `discoverModel`, `writable`, `freshTreePlanInputs` in core/workflow; `writeFreshTree` in shell/project; cli/verify, cli/model, bench emission-run, bench scaffold and the explain workflow use them; verify's ids are computed once. |
| architecture-4 | major | **Fixed** (`8254a85`, D65 f). checkReencode runs `rawReason` for every instruction naming an address; only address-free ones use a cache keyed by the exact word (`core/model/printing-cache.ts`, moved out of items.ts). pokeemerald verifyModel 330-400 → 610-700 ms. |
| architecture-5 | major | **Fixed in part** (`cdf63f5`). The Thumb prefilters live in `foundation/isa/decode.ts`; `peek16`/`peek32` in `foundation/rom/rom.ts` replace the local `half`/`word32` copies and inline byte assembly; codeLayout scans the code spans once (`borderRefs`) instead of twice. Not done: deriving codeLayout's references from the model's codeRefs. They read different inputs (the analysis' function spans at load addresses, the model's overlap-resolved code segments at run addresses), core/layout may not import core/model (architecture §2), and changing which references bound the legal borders is a behaviour change, not a refactor. |
| architecture-6 | minor | **Fixed** (`0f0d36e`, `7a44898`). `lowerBound` and `spanIndexAt` with tests; every listed copy uses them. findItem keeps its loop over the item table's typed-array columns. |
| architecture-7 | minor | **Fixed in part** (`82e1b1f`, `8254a85`). text-layout.ts loses the link-script checks (`link-scripts.ts`) and its diagnostic (`text-error.ts`): 585 → 459 lines; items.ts loses segments (`segments.ts`) and the printing cache. borders.ts is not split: the edge table admits only `core/model` → `core/layout/borders.ts`. |
| architecture-8 | minor | **Fixed in part** (`7a44898`). The text-layout check's per-model WeakMap is gone: checkEntries builds its index and LayoutMemo per pass and drops them with it, so the memo no longer lives as long as generate's model. Kept: the resolver's label index (keyed by the labels array; the printer calls resolverFor per chunk through the frozen Writer/EmitContext contract, D62), unit-text.ts's chunkPaths per chunks array, and printing-cache's OFFSET_MASK (a static table per isa row, not model state). |
| architecture-9 | minor | **Fixed** (`66c625a`). `BASEROM_PATH` and `MACROS_PATH` once, in `core/model/paths.ts`, exported from `romlift`; the other names are gone. |
| architecture-10 | minor | **Fixed** (`66c625a`, `8254a85`, `7a44898`). `runTool`, `errnoOf`, `errorReason`, `modeOfSpec`, `runOffsetOf` and statements.ts `stripComment` are the one helper each. |
| architecture-11 | minor | **Fixed** (`5f7267f`, `66c625a`). Tests for each tiling defect, the lock takeover race, a lock that cannot be read, removeStale's two refusals, and assembleCheck with a stub toolchain (one unit does not assemble, another's object cannot be read). |
| architecture-12 | minor | **Fixed** (`82e1b1f`). `core/emit/unit-text.ts` holds the shared helpers; each writer file holds its Writer. |
| architecture-13 | minor | **Fixed** (`82e1b1f`). ExtentSource is the model's type; one compareLabels (rank lookup); ten file-local exports unexported. Types of exported functions' parameters and results stay exported. |
| architecture-14 | minor | **Fixed** (`7a44898`). The casts are checked reads; indexes that must exist raise RomliftInvariantError. |
| delivery-1 | major | **Fixed where the base was wrong; the rest reclassified, measured and put to the owner** (`701a99a`, D65 i). Every objdiff base now assembles (the far-pool functions of sa2, sa3, pokeemerald and fe7j's ColorFadeTick are assembled with the chunks they reach, at their ROM word phase); a resolved `b` and ARM `bl` pair like a `bl`. The committed classifier shows that most of the rows Q1 filed as "gated under every option" link to the same word (`.word 0x30000c8 \| .word sTalkText`, `sym + addend` against a label). What stays gated under option (b) is in Q1's table. The trailing zero halfword is not an emission defect: the ELF counts the pad in 46 functions (sa3 39, sa2 6, fe7j 1) and leaves it out in 7,008 with the same bytes (sa3 739, sa2 441, fe7j 312, pokeemerald 3,202, klonoa 45, tmc 2,269), so no rule from the bytes can follow it. fe7j's PutUnkSprite `b` is the analysis' dead halfword after a `b` (`@ dead`, D16); printing dead code as instructions is a rule change. Phase 3 stays unlanded. |
| delivery-2 | major | **Recorded** in Q2's facts: real-ROM peak RSS of `model`, `verify` and `verify --link`, and that options (b) and (c) must also cover 16 MiB ROMs at 0.35 to 1.1 GiB. |
| delivery-3 | major | **Owner question Q3**, with the share of the flushes measured on pokeemerald. |
| delivery-4 | minor | **Recorded** under "Known limitations" and Q5 (c): the generate path's warnings per tuning ROM. Not fixed: the confirm run validates every listed function with the valid.* rules (W_LISTED_INVALID), which the discover run accepted through other rules; confirm still equals discover on extents (`g2.confirm-equals-discover`). |
| delivery-5 | minor | **Recorded** under "Known limitations": the cross-OS and Node 22.18 clauses are unmeasured until the phase PR's CI runs; on the fixtures and five tuning ROMs the generate tree equals the discover tree the gate digests (measured digest for digest), on tmc it differs by one file. The gate is not changed (a gate change is the owner's). |
| delivery-6 | minor | **Fixed** (`701a99a`). Q1 is retitled; its facts come from `bench/tools/objdiff-classes.ts` with a tested classifier. |
| delivery-7 | minor | **Recorded** in D65 l and raised as owner question Q4. |
| delivery-8 | minor | **Fixed**: the roadmap table lists `p3-fixture-goldens`; D62 a is amended by D65 k. |
| delivery-9 | minor | **Fixed**: D62 j amended by D65 j; the gate's comment gives the real order. |
| delivery-10 | minor | **Fixed** in Q2: per-command minimum and maximum over every recorded run; the 1,495 MiB figure has no recorded command and is withdrawn. |
| delivery-11 | minor | **Fixed**: the README says phase 2 has landed (#2 merged, tag `phase-2`). |
| delivery-12 | minor | **Fixed**: AGENTS.md's `test:local` row names emission-real, poc-raw-printer and objdiff and their inputs. |
| delivery-13 | minor | **Owner question Q5 (b)**, as a limitation carried into phase 4. |

### Fix round 2

The review of fix round 1 (`e048247`): architecture-r1-1 to -14, correctness-r1-1 and -2, delivery-r1-1. Each fix is
its own commit; a defect's fix has a test that fails without it (D66).

| Finding | Severity | Disposition |
| --- | --- | --- |
| architecture-r1-1 | major | **Fixed** (`1ac3527`, D66 g). The classifier checks every same-word class: the word or branch target each side links to, from the ELF's addresses and Thumb bits, the reference relocation's addend (read from the reference object, REL implicit or RELA explicit) and the base's addend or plain value (read from the base object); static-callee checks the reference's resolved target against the callee's address; a difference whose facts are missing is the new class `unverified`, gated under option (b); the switch over kinds is exhaustive (`never`) and throws on an unknown kind; default spellings parse through romlift's `defaultSpellingAddress`. Re-measured: no difference is unverified; one tmc `alias` does not link to the same word and is `relocation-other` now; option (b)'s remainder is 110 (was 109). Q1's table is the new output. |
| correctness-r1-1 | major | **Fixed** (`ac9934c`, D66 a). Before a write, each component of its path that exists under another case and is the same directory entry (dev and inode) is renamed to the op's spelling through a temporary name, taking what it holds along; readDiskState lists a file found under another spelling of an asked-for path once, under that path. Apply test: renaming `main` to `Main` with an unowned `notes.txt` inside leaves `asm/nonmatchings/Main/` holding the tree's files and `notes.txt`, and the next run keeps all with one W_UNOWNED_FILE (for `notes.txt`); it and the snapshot test fail without the fix. A tree the earlier version left misspelled is repaired the next time a file in that directory is written. |
| correctness-r1-2 | minor | **Fixed** (`0ccfb46`, D66 b). Symbol and module names are at most 200 characters (schema, E_NAME_INVALID); the paths check raises E_PATH_TOO_LONG for a component over 255 UTF-8 bytes. Tests for both. |
| delivery-r1-1 | minor | **Fixed** in Q2: the review's two runs at `e048247` and this round's runs are in the table, the spread is stated as V8 sizing its heap (not bounded by the recorded runs), and option (b)'s budget is derived from the largest recorded peak, 1,415.2 MiB. |
| architecture-r1-2 | minor | **Fixed** (`c186d7f`). core/layout/{align,entries,tiling,refs,asm-only}.ts; borders.ts keeps codeLayout, legalBorders, nearestBorders and re-exports what core/model and core/workflow use, so the model's one edge is unchanged. The fix-round-1 disposition ("the edge table admits only borders.ts") was wrong and is withdrawn. |
| architecture-r1-3 | minor | **Fixed** (`c186d7f`). test/unit/layout/refs-agree.test.ts: on all 47 fixtures, discover and confirm runs, every pool load and adr codeRefs names inside a function span is in borderRefs' list at the same site and target (run offset applied); 502 references. |
| architecture-r1-4 | minor | **Fixed** (`1e70e17`). `decodeItemAt(rom, items, i, runOffset): Insn \| string` in core/model/item-table.ts (u32/u16 reads); itemAt throws its reason, the re-encode check reports it; the `<< 16` assembly is gone. |
| architecture-r1-5 | minor | **Fixed in part, exception recorded** (`44b4a93`, D66 d). chunkPathsOf in core/model/paths.ts is the one memo, shared by the writers and textLayoutIndex, so a generate computes the paths once; unit-text.ts's WeakMap is gone. The resolver's label index stays a memo: D66 d records why (frozen public printChunk/resolverFor/Writer signatures, the model JSON contract). |
| architecture-r1-6 | minor | **Fixed** (`236f43b`). One `externalSymbols(model)` and `isOutsideRom` in core/model/symbols.ts; both writers use it; the verifier builds its by-name map from it (`externalSymbolValues`); the ldscript writer no longer imports the symbols writer. |
| architecture-r1-7 | minor | **Fixed** (`f1f15ff`). DIALECT.macrosPath and DIALECT.macrosInclude; the preamble is built from them; MACROS_PATH re-exports the path; text-layout takes the include line from the dialect. |
| architecture-r1-8 | minor | **Fixed** (`98436ea`). runStartOf and toLoad in core/model/modules.ts; one moduleIndexAt (moved there, re-exported by resolver.ts and `romlift`) taking the relocated modules to search, replacing runModuleAt; text-layout, the data writer and the label index pass the relocated list once; labels.ts sorts with compareLabels. |
| architecture-r1-9 | minor | **Fixed** (`c452056`, D66 f). `textLayoutIndex(model)` (type TextLayoutIndex) is exported and `checkEntry(rom, model, index, entry)` takes it. |
| architecture-r1-10 | minor | **Fixed** (`a95229f`). AssembleUnit and `assembleUnits(model)` in core/model/paths.ts, built from each module; core/verify/toolchain.ts `unassemblable(unit)` holds the not-assembly verdict the shell reports; tests for both and for the shell branch (stub `as` that fails if it runs). |
| architecture-r1-11 | minor | **Fixed** (`1c71482`). test/mutation/phase3/link-scripts.test.ts covers unitAlignment's start branch and the three uncovered ldscript branches. |
| architecture-r1-12 | minor | **Fixed** (`cc9c8df`, D66 e). DecompState.defined is a sorted `readonly string[]`; the generate test JSON round-trips every non-model field of a result. |
| architecture-r1-13 | minor | **Fixed** (`ac9934c`, `cc9c8df`). readOptionalText, fileText, corpusDetail, ROMLIFT_CONFIG_SCHEMA, labelKindRank and four cli helpers unexported; removeStale documented as exported for its race test; generate()'s comment names generatedEntries. |
| architecture-r1-14 | minor | **Fixed** (`0ccfb46`, D66 c). W_OVERRIDE_OUTSIDE_ROM in core/model/codes.ts; a test raises both codes. |

### Fix round 3

The review of fix round 2 (`e0815d9`): architecture-r2-1 to -9, correctness-r2-1 to -3, delivery-r2-1. Each fix is
its own commit; a defect's fix has a test that fails without it (D67).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-r2-1 | major | **Fixed** (`c8823c2`). The case-rename apply test probes whether the temporary directory folds case (one inode under both spellings); on a case-sensitive file system it requires `main/` to keep `notes.txt`, `Main/` to hold the tree's files and the warning to name `asm/nonmatchings/main/notes.txt`. `npm test` with TMPDIR on a case-sensitive APFS image (`hdiutil create -fs "Case-sensitive APFS"`): 1,941 of 1,941 pass; on the default TMPDIR the same. |
| correctness-r2-2 | major | **Fixed** (`13cf21c`, D67 b). A `b` or `bl` whose target the module's resolver names by a `func` label of the other state is a raw-insn `'interworking-branch'` with W_INTERWORKING_BRANCH, so ld has nothing to insert a veneer for. klonoa with 0x08040B50 or 0x08040D68 listed `arm` (and 0x08040B50 with size 4): writable, the readable tree links to the SHA-1 (before: `493717f0…`/`84c9b343…`, first difference 0x080007FC); an ARM function listed `thumb` (0x080001D0, 0x08000278) likewise. test/local/config-mutations.test.ts requires both flips to be writable and to link; the items and codes unit tests require the raw reason and the code. No fixture or tuning ROM tree changes (goldens and digests unchanged). |
| correctness-r2-3 | major | **Fixed** (`13cf21c`, D67 a). buildModel raises E_NAME_INVALID for a module name the schema's rule refuses and E_MODULE_NAME_DUPLICATE for two modules of one (folded) name; the paths check raises E_PATH_INVALID for a path isProjectPath rejects. klonoa with `main_2` renamed: `data` → E_MODULE_NAME_DUPLICATE, not writable (before: writable, ld "multiple definition"); `../../evil` and `''` → E_NAME_INVALID and the paths check fails, not writable (before: writable, then RomliftInvariantError in planWrites); `a/b`, `.hidden` and a 240-character name → E_NAME_INVALID, not writable. Unit tests for each name and path; the local test for `data`, `../../evil` and `''`. |
| architecture-r2-4 | minor | **Fixed in part** (`56c7d81`, D67 c). renameCase renames the temporary name back when the second rename fails and E_IO_WRITE names the entry's actual location; tests inject a failure into each rename. Carried: the rename is not journalled, so a crash between the two renames leaves the directory under `.romlift-case-<pid>-<name>` until the user moves it. |
| architecture-r2-6 | minor | **Fixed** (`cc60e55`). One buildUnitOf; AssembleUnit is exported from `romlift` beside assembleUnits; the core/verify and shell/toolchain re-exports and its `romlift/node` export are gone. |
| architecture-r2-7 | minor | **Fixed** (`5acf06a`). Architecture §2 lists core/layout's eight files (borders.ts as core/model's one entry), foundation/util/project-path.ts and shell/project/spelling.ts; the roadmap's 3.A row lists the layout files and config-from-discover.ts under core/workflow. |
| architecture-r2-8 | minor | **Fixed** (`cc60e55`). marksOf's doc comment is on marksOf; label candidates carry `load` and sort through a compareLabels view; the blank line and the MACROS_INCLUDE alias are gone. |
| delivery-r2-1 | minor | **Fixed** in Q2: the review's two runs at `e0815d9` and this round's runs are in the table, and option (b) is stated as a bound no recorded run sets. |
| architecture-r2-1 | minor | **Carried into phase 4.** TextLayoutIndex stays exported with its Maps and memo (D66 f); making it a branded handle or unexporting checkEntry changes the public API the bench and test/local use, and phase 4 reopens the writer contract (D66 d). |
| architecture-r2-2 | minor | **Carried into phase 5** (after Q1's answer, D68 f). The bench's REL/RELA addend decoder (bench/src/objects.ts) beside foundation/formats/elf.ts relocationWidth, and the R_ARM_*/SHT_* constants spread over objects.ts, objdiff-cli.ts and objdiff-classes.ts. A refactor of the classifier behind Q1, whose numbers it would have to re-measure; the gate it serves is `g5.objdiff`, so it goes to phase 5 with it (roadmap 5.C). |
| architecture-r2-3 | minor | **Carried into phase 5** (D68 f). No fixture test covers objdiffDifferences' sectionBase and baseField plumbing; linkedWord's dead branch and missingClass's final `unverified` are uncovered. With r2-2. |
| architecture-r2-5 | minor | **Fixed** (`0483164`, after Q6's answer, D69 c). moduleIndexAt's `relocated` is required (no linear default): names.ts computes relocatedModules once per pass, moduleAt and the data writer pass it; `romlift` exports moduleIndexAt from core/model/modules.ts and the resolver.ts re-export is gone. No result changes (a module without `runs_at` has no run range). |
| architecture-r2-9 | minor | **Fixed** (`5ae1c1c`, D68 f). test/unit/verify/text-layout.test.ts gives textLayoutIndex two module-scoped `sLocal` labels in two data modules; each module's `.4byte sLocal` lays out to its own label's word. |


### Fix round 4

The review of `d744f5d` (the landing run after Q6): correctness-r0-1 to -r0-5, gate-honesty-r0-1 to -r0-5 (D70). Each
fix is its own commit; the blocker's fix has a test that fails without it (`test/local/large-rom-bin.test.ts`, which
fails at `d744f5d` on `analyze --json`, `model`, `model --json` and the three `verify` runs).

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-r0-1 | blocker | **Fixed by the review's option (a)** (`0bb3d75`, `47c3b62`, `77a7a2f`; D70 a, b). `generateFromRom` and `initModel` drop the discover analysis before the confirm run; `analyze --json` and `model --json` stream their NDJSON and wait for stdout to drain. Every bin command completes on the synthetic ROM under the 384 MiB cap (765.3 to 811.8 MiB peak RSS) and on the six tuning ROMs, outputs byte-identical to `d744f5d`'s uncapped run ("Measured numbers", fix round 4). `bench large-rom --bin` runs them and `test/local/large-rom-bin.test.ts` requires them (in the closing list through `test:local`); `g3.large-rom` is not changed, since the owner authorised no further gate change. `test/gates/phase.json` is not lowered and raised again: the landing run at `739d665` is withdrawn (D69's revision), and the closing list runs again after this round with the marker at `{ "landed": 3 }`, as the landing procedure requires; a failing command puts it back at 2. |
| correctness-r0-2 | major | **Fixed** (the docs commit of this round). "Known limitations" says what was measured on the bin and withdraws the earlier claim; D69 carries a revision withdrawing "a user's `romlift` run … holds about 0.8 to 0.9 GiB"; the README, architecture §9.4 and §12 say the gate measures the workflow children and the bin is measured by `large-rom --bin`. |
| gate-honesty-r0-1 | major | **Fixed** with correctness-r0-1 and -r0-2: the bin's commands are measured (and complete), and the claim is withdrawn until measured, then restated from the measurement. |
| gate-honesty-r0-2 | minor | **Fixed in the record** ("Measured numbers", fix round 4): the review's four runs join the record, `init` 814.0 to 945.5 MiB over eighteen runs ("sixteen" until fix round 5, D71 f), and the budget is 15.1% above the largest, not 25%. The budget is not raised to keep 25%: that is a gate change the owner has not made (D70 c). |
| gate-honesty-r0-3 | minor | **Fixed** (`879a91f`, D70 e). The artifact's memory member keeps `maxOldSpaceSizeMiB`; the memory family's summary says the runs are recorded and `g3.large-rom` judges them. `provenance` is not given a second copy of the gate's threshold. |
| gate-honesty-r0-4 | minor | **Fixed**: AGENTS.md's `bench large-rom` row says `< 1,088` (D69 b). |
| gate-honesty-r0-5 | minor | **Fixed**: the README's index says D1–D70 and the answers to Q1 to Q6. |
| correctness-r0-3 | minor | **Fixed** (`77a7a2f`, D70 d). Each child reports `peakLiveHeapMiB` (node:v8 GCProfiler, the largest heap live after a full mark-compact); recorded at 314.5 to 351.6 MiB (`init`) and 330.4 to 353.0 MiB (`generate`) of 384, with the regression signal at about 355 MiB. |
| correctness-r0-4 | minor | **Fixed** with gate-honesty-r0-4. |
| correctness-r0-5 | minor | **Fixed in part** (`e8869c0`, D70 f). The data writer computes the relocated modules once per module; the orphan comment is gone; `moduleAt` is documented as the one-address form. pool.ts keeps calling it once per address with labels: threading the list through `wordText`, `labelForWord` and their callers changes the printer helpers' signatures for a filter over a few dozen modules. |

### Fix round 5

The review of `16d1280` (the landing run after fix round 4): correctness-r1-1 to -r1-4, gate-honesty-r1-1 to -r1-3
(D71). Each fix is its own commit; a defect's fix has a test that fails without it.

| Finding | Severity | Disposition |
| --- | --- | --- |
| correctness-r1-1 | blocker | **Put to the owner as Q7; the claim restated** (D71 a). Reproduced: on pokeemerald twice over (SHA-1 `fb17b88d…`) every one of the twelve bin command forms aborts under the 384 MiB cap, and `bench large-rom --rom`'s `init` does too. Not fixed by cutting retained memory: without a cap `verify` holds 721 MiB live, at a 768 MiB cap it still aborts, and what it holds (the readings' instruction spans, the text-layout check's whole-tree text and statements) needs a redesign of the readings' storage and the check pass, measured in Q7's facts. The verdict, D70's consequences (its revision), the README and architecture §9.4 now claim completion only for the synthetic image and the six tuning ROMs; the doubled ROM is under "Known limitations". Phase 3 does not land until Q7 is answered. |
| correctness-r1-2 | major | **Fixed** (`fa4f71b`, `88cede1`; D71 b, c). `rss-probe.ts` reports the live heap (GCProfiler, `bench/src/live-heap.ts`) and `bench large-rom --bin` records `peakLiveHeapMiB` per command. Recorded in "Measured numbers" (fix round 5) and D71 b: the bin's largest live heap on the synthetic image is 377.5 MiB of 384, about 2% of headroom, and the regression signal is any bin live peak past the recorded maximum (the 355 MiB signal of D70 d is withdrawn). Measuring it found `analyze`'s text form aborting under Node 22.18; `88cede1` streams its table (byte-identical output), with a test. |
| correctness-r1-3 | minor | **Fixed** (`fa4f71b`, D71 e). `BIN_RUNS` and the local test's list add `explain`, `verify --assemble` (text), `verify --assemble --json` and `verify --printer raw --assemble --json`; the recorded range is restated from the twelve forms ("Measured numbers", D71). |
| correctness-r1-4 | minor | **Fixed**: architecture §9.4 gives the tuning ROMs' range from the bin's and the gate's runs, 236.1 to 679.2 MiB. |
| gate-honesty-r1-1 | minor | **Fixed** (D71 d). The gate's comment, `bench/src/large-rom.ts`, roadmap 3.E and architecture §12 say 1,088 MiB was set at `a206ac1` when 866.5 MiB was the largest recorded peak and is 15.1% over the 945.5 MiB recorded since. The threshold is not changed. Q6's rule was applied when the budget was set and does not ask for it to be set again; raising it would loosen the gate, so no owner question is open on it and "needs the owner" is withdrawn. |
| gate-honesty-r1-2 | minor | **Fixed** (D71 f): eighteen runs in the fix-round-4 review row; four live-heap runs in D70 d. |
| gate-honesty-r1-3 | minor | **Fixed in part** (D71 g). Measured: `g3.large-rom`'s children under Node 22.18 on macOS (2 runs) and under Node 22.18 and 24 in Linux containers (arm64, 3 runs each), and the bin's twelve commands on both, all recorded in "Measured numbers"; every run of the children completes with the tree `9d9c915d…`. The bin's text `analyze` did not complete under Node 22.18 until `88cede1`. Not done: the phase pull request's CI numbers, since nothing is pushed; they are recorded when that pull request runs, before the merge. |
