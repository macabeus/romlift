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
| `p3-fixture-goldens` | 3 | `phase-3-fixture-goldens` | ready, not merged | the writer goldens, `export-poc --mode raw` and the raw printer's PoC parity, the six-ROM emission test, the tree digests in CI, the emission fixes of wave 3 |

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
  still lists `--mode scored|parity|queries` (not this component's file).

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
    changes no verdict. Open for the phase lead.
- Readability note, no rule broken: 2-byte (or 1- to 3-byte) zero padding between two functions is an orphan
  chunk of its own (`unk_<ADDR>.s` holding `.align 2, 0`), as the PoC's `tile()` made a gap chunk of it (66 of
  the PoC's 97 gap chunks on the fixtures are under 4 bytes) and as plan.md's "No orphan bytes" rule asks. With
  the discover model, padding-only orphans of all orphans: pokeemerald 3,203 of 3,222, tmc 2,289 of 2,320, fe7j
  1,530 of 1,558, sa3 867 of 882, sa2 448 of 464, klonoa 64 of 87.
  The next function's `thumb_func_start` already emits `.align 2, 0`, so folding the pad into it would remove
  the files without changing a byte; that changes the chunk model and the plan's rule, so it is left as is.
