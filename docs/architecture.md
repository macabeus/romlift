# romlift architecture

This is the definitive architecture of romlift, revision 2. It implements [plan.md](plan.md) (revision 26)
and is measured against the proof of concept described in [proof-of-concept.md](proof-of-concept.md), on
the ROMs listed in [benchmark-roms.md](benchmark-roms.md). Every choice a reviewer could contest is
recorded with its alternatives in [decisions.md](decisions.md); this document cites them as `D<n>`.
Revision 2 answers the four adversarial reviews of 17 October 2026; the disposition of each of their 60
findings is in [architecture-review.md](architecture-review.md). Phase 6 revises it for the owner's decisions of 20
October 2026: the gba-kit trace is dropped (D91), phase 5 is skipped and its reconciler, rename, writers, data ranges
and objdiff gate move into phase 6 (D92), and phase 6's contracts are frozen by D93. The order in which the components are
built, who owns which file, and the exact exit commands of each phase are in [roadmap.md](roadmap.md).

It starts from what a user runs and from the six gates of the plan, and works back to the modules.
Four principles drive it:

- **Every gate is an executable test from the first commit.** A gate reports one of five verdicts:
  `pass`, `fail`, `pending` (its exports are not public yet), `unavailable` (a local input such as a
  ROM, an ELF or the PoC checkout is missing; the input is named) and `historical` (a PoC-parity gate
  frozen after phase 2 lands, its evidence committed; its `run` still runs and fails the gate when its
  check fails). A phase lands when every gate of that phase and
  of all earlier phases is `pass` or `historical` on both tiers (D29, D50).
- **Nothing ships before its phase.** A command, a TOML key or a writer appears in the phase that
  gates it. Nothing is stubbed early.
- **The core is pure.** Bytes and plain data in, plain data out. Files, processes, clocks, hashing and
  the environment exist only in the shell (D3, D44).
- **The shell decides nothing.** It reads inputs, calls one workflow, and applies the plan the core
  returned. Every policy (what to write, delete or refuse) is a pure function (D36, D17).

---

## 1. Goals and non-goals

**Goal.** `npx romlift init baserom.gba && ./setup.sh && make`, run in the directory that holds the
ROM, ends at the ROM's SHA-1 with no file edited by hand, and the split it produces meets the entry,
extent and code-end gates of §8. Requirements R1–R9 of the plan apply unchanged:

| # | Requirement | Where this architecture meets it |
| --- | --- | --- |
| R1 | One shot, split into functions | `init` (§2.1); gates `g4.e2e-fixtures`, `g4.e2e-real` (every tuning ROM: six since D60, tmc included), `g4.packed-e2e` (the published tarball) |
| R2 | Node and TypeScript only | Node ≥ 22.18 type stripping, three runtime dependencies (D2, D38); `g1.runtime-deps` |
| R3 | One TOML; `generate` never writes it | `generate` runs in confirm mode and takes every name, extent and border from the TOML (D8, D9); `g4.no-toml-write` |
| R4 | Generated `.s` regenerated and gitignored; two runs identical | one emission stream, one write plan, a manifest (§6.3, §6.4); `g3.tree-determinism` on Linux and macOS with a varied environment (D30); the scaffold's `.gitignore` ignores every generated root and a fresh clone or worktree gets the tree from `setup.sh`'s duty 5 (the owner's answer to phase-4 Q9, D79 b; `g4.worktree`) |
| R5 | Byte-exact, self-checked, proven by the build | four self-checks before any write, including the text-layout check that re-reads every emitted file (§6.4, D49); `verify --link`; the SHA-1 after `make` |
| R6 | No ROM-specific constant in code | every analysis constant is a named `CompilerProfile` field and the rule order is profile data (D12); per-ROM facts live in the TOML; `g2.second-profile` |
| R7 | Pure core, small modules, typed boundaries | four layers, one file per rule, `test/architecture.test.ts` (D3, D5, D7); `g1.architecture` |
| R8 | Agent-friendly | no prompts, NDJSON diagnostics, `explain`; `g4.cli-contract`, `g4.worktree` |
| R9 | `generate` touches C only on `INCLUDE_ASM` lines | `reconciled` file ownership: `TextEdit`s only (§6.3), `g6.reconciler` |

R3 and R9 are the two the proof of concept breaks: its `generate` rewrites `romlift.toml` and applies
signatures at every run. This architecture restores both.

**The six phases and their gates.** Each gate is a test id under `test/gates/` (§10); the components
that make each gate pass are in [roadmap.md](roadmap.md).

| Phase | Delivers | Gate test ids |
| --- | --- | --- |
| 1 Decoder | ISA table, decoder, encoder, formatter, parser, raw fallback, the shared assembler dialect, `doctor`, bench harness over the PoC's runs, all gate files | `g1.architecture`, `g1.runtime-deps`, `g1.thumb-roundtrip`, `g1.bl-sample`, `g1.arm-sample`, `g1.encoder-agrees`, `g1.context-corpus`, `g1.doctor`, `g1.bench-harness`, `g1.dataset-elf`, `g1.provenance`, `g1.checks-fail` |
| 2 Analysis | Rules, the driver ported from the PoC's control flow, the profile, `analyze`, `explain` (analysis part), fixtures, held-out runs | `g2.poc-parity`, `g2.baseline-rows`, `g2.entries`, `g2.extents`, `g2.code-end`, `g2.no-unreviewed`, `g2.confirm-equals-discover`, `g2.determinism`, `g2.synthetic-analysis`, `g2.rule-registry`, `g2.rule-coverage`, `g2.vocabulary-emitted`, `g2.second-profile`, `g2.held-out`, `g2.speed`, `g2.regression`, `g2.checks-fail` |
| 3 Emission | Model, module inference without libraries, printer-driven writers, write plan, `verify`, `model --json` | `g3.self-check`, `g3.text-layout`, `g3.raw-link`, `g3.link`, `g3.readability`, `g3.tree-determinism`, `g3.golden-writers`, `g3.speed-budget`, `g3.large-rom`, `g3.checks-fail` |
| 4 One shot | Config on disk, scaffold, C stubs, per-module compilers, `init`, `generate`, `analyze --update` | `g4.e2e-fixtures`, `g4.e2e-real`, `g4.packed-e2e`, `g4.generate-idempotent`, `g4.toml-mutations`, `g4.no-toml-write`, `g4.worktree`, `g4.toml-canonical`, `g4.c-data-fails-loud`, `g4.multi-compiler`, `g4.cli-contract`, `g4.checks-fail` |
| 5 Migration | Skipped by the owner (D92, "We don't need it. Skip phase 5"): it never runs or lands; legacy import and the Klonoa switch-over are dropped, and rename, the reconciler, `expected/`, `objdiff.json`, the C data ranges and the objdiff gate move to phase 6 | none (skipped, D92) |
| 6 Evidence | Signatures (build, match, propose), serial and BIOS-stub signatures, the proposal screen, code run from RAM through hand-written `runs_at` overrides (the gba-kit trace is dropped, D91), full `explain`; from phase 5 (D92) the reconciler and `rename`, `expected/`, `objdiff.json`, matchings, C data ranges and the objdiff gate | `g6.signatures-judged`, `g6.signatures-rebuild`, `g6.signatures-heldout`, `g6.signatures-loo`, `g6.no-heldout-references`, `g6.ram-code-mapped`, `g6.evidence-conflict`, `g6.explain-coverage`, `g6.reconciler`, `g6.rename`, `g6.expected-bytes`, `g6.objdiff`, `g6.c-data-ranges` |

**Non-goals for release 1** (plan): C decompilation, typed assets, analysis profiles other than agbcc
(the profile registry exists and a dummy second profile is tested; only `agbcc` ships), shiftable
builds, other consoles, a GUI, and C-defined `.rodata`/`.data`/`.bss` outside a module's data range (§6.6, D92). Build
compilers are a separate matter: `agbcc` and `old_agbcc` ship as per-module build compilers (D47).
Also out of scope by decision: a stage cache in user projects, replay of stages from dumped
artifacts, and a structural `diff` command (D18).

## 2. Package layout

**One npm package, `romlift`, with four entry points** (D1, D37): `romlift` (the pure library API:
analysis, model, emission, explain, formats; browser-safe), `romlift/node` (the file-backed API:
locate and load a project, apply a write plan, run the toolchain), `romlift/isa` (the instruction set,
importable alone so gba-kit can share it) and `romlift/internal` (analysis tuning, the rule registry,
`defineRule` and ablation; outside semver, documented as such, imported only by the CLI's `--disable`, the bench,
the gate tests and `test/local`). Templates ship inside the package. Signature specs ship; built
signature files ship only once the owner decides (D40). The bench, fixtures and tests are not published.

Node 24 runs `.ts` directly through type stripping (D2). Each export has two conditions,
`"source": "./src/<entry>.ts"` and `"default": "./dist/<entry>.js"`; every npm script runs Node with
`--conditions=source`, so development and the bench read the sources while an installed package reads
`dist/`, which `g4.packed-e2e` proves. `tsconfig.json` sets `strict`, `erasableSyntaxOnly`,
`verbatimModuleSyntax`, `rewriteRelativeImportExtensions`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes` and `noEmit`; `tsconfig.build.json` emits `dist/` for publishing only.
Consequences: no `enum`, no `namespace`, no constructor parameter properties; closed sets are `as const`
objects or string-literal unions.

```
romlift/
  AGENTS.md                         agent instructions (never CLAUDE.md)
  README.md
  package.json                      bin romlift (dist/cli/main.js, whose first line runs Node with
                                    --max-old-space-size=1024, D68 b, D72); exports ".", "./node", "./isa", "./internal" (source/default
                                    conditions); engines node >=22.18; files: dist/, templates/, signatures/specs/
  package-lock.json
  tsconfig.json, tsconfig.build.json
  .gitignore                        *.gba *.elf *.map *.o (fixture builds re-included), dist/, bench/.local/,
                                    bench/timings.json, signatures/*.json (built files, D40)
  .github/workflows/                ci.yml, printer.yml, fixtures.yml, provenance.yml, packed.yml
  templates/                        MANIFEST.json (every scaffold file and its project path, D74 d), Makefile, setup.sh,
                                    AGENTS.md, build.yml, gitignore, README.md, compilers/<id>.mk, agbcc.json (the pinned
                                    agbcc URL and commit); include/** is rendered from the dialect, not a template
  signatures/
    specs/<library>.json            committed: references, object globs, reviewed names; no bytes
    <library>.json                  built locally by `romlift signatures build`; gitignored (D40)
  src/
    index.ts, node.ts, isa.ts, internal.ts   barrels: only `export * from './api/<component>.ts'` lines
    api/                            one barrel per component, created empty by its phase's component 0 (D43)
    foundation/                     no project knowledge (one recorded exception, util/project-files.ts, D76 h);
                                    imports nothing outside foundation/
      rom/                          span.ts, rom.ts, header.ts, memory-map.ts, bios.ts, codes.ts
      isa/                          types.ts, thumb-table.ts, arm-table.ts, decode.ts, encode.ts, format.ts,
                                    parse.ts, assemble.ts, roundtrip.ts, registers.ts (register effects, D59)
      corpus/                       corpus.ts, types.ts, cases.ts, layout.ts, compare.ts, parse-summary.ts: the
                                    as round-trip corpus, counts only (D54 c, D55)
      asm/                          dialect.ts (preamble, macros.inc, C-stub texts; their paths are
                                    util/project-files.ts's, D77 h), statements.ts (parser of the
                                    directive subset romlift emits), layout.ts (lays statements out to bytes)
      formats/                      elf.ts, gnu-map.ts, canonical-json.ts (the legacy-file parsers and the trace's
                                    format were dropped with legacy import and the trace, D91, D92)
      diagnostics/                  diagnostic.ts (the mechanism; no codes)
      util/                         hex.ts, sorted.ts, interval-index.ts, csr.ts, min-heap.ts, arrays.ts (pushAll,
                                    lowerBound, spanIndexAt), fold.ts (foldPath), project-path.ts
                                    (isProjectPath: what every emitted, journalled and written path must be),
                                    line-diff.ts, project-files.ts (the exception: a project's file names, the
                                    default function name and the C stubs' project paths, NONMATCHINGS_ROOT,
                                    nonmatchingDir, chunkFileOf, isChunkFile, stubNameOf, INCLUDE_DIR,
                                    INCLUDE_ASM_HEADER_NAME and INCLUDE_ASM_HEADER_PATH, and the C sources'
                                    spelling, C_SOURCE_DIR, isCSource and cSourceOf (fix round 6; their one
                                    owner since fix round 7, architecture-b2-7), which asm/dialect.ts,
                                    core/config, core/model, core/reconcile, core/emit, core/verify,
                                    core/scaffold and the shell import from here; the public api/ modules
                                    re-export some (api/reconcile.ts, api/model.ts, api/one-shot-types.ts,
                                    api/config.ts), and the aliases of architecture-r1-2 (locate.ts's
                                    DECOMP_YAML_NAMES, BASEROM_PATH, SCAFFOLD_ROM_FILE, TARGET) stay until
                                    phase 6, roadmap.md; D75 g, D76 h, D77 h, D83 c, D84 e, D85 e)
    core/                           pure; only allowlisted globals (§2, D5)
      diagnostic-codes.ts           the union of every module's codes.ts
      provenance/                   rule-id.ts, provenance.ts, trail.ts, vocabulary.ts
      profile/                      types.ts, registry.ts, agbcc.ts
      analysis/                     types.ts, address-map.ts, pointers.ts, limits.ts, codec.ts, explain.ts, codes.ts,
                                    reading.ts
        driver/                     run.ts, state.ts, facts.ts, trail.ts, view.ts, grow.ts, fill-gaps.ts, accept.ts,
                                    settle.ts, validity.ts, epoch.ts, worklist.ts, confirm.ts, diagnose.ts, reuse.ts
        walk/                       cursor.ts, record.ts, predicates.ts, insn-index.ts, thumb.ts, arm.ts
        rules/                      define-rule.ts, index.ts (concatenates the family registries)
          seed/ walk/ bl/ valid/ accept/ gap/ claim/ region/     index.ts + one file per rule (§4.1)
      proposals/                    types.ts (Proposal, ProposalSource: signature, analysis, layout; LibraryRegion,
                                    sourceKey; D91 e)
      layout/                       types.ts, borders.ts (core/model's one entry; it re-exports the rest), align.ts,
                                    asm-only.ts, entries.ts, refs.ts, tiling.ts, infer-modules.ts
      signatures/                   schema.ts, spec.ts (frozen by D93), extract.ts, match.ts, resolve.ts, policy.ts,
                                    propose.ts, codes.ts
        rules/                      index.ts + one file per sig.* placement rule
      config/                       schema.ts, keys.ts, parse.ts, serialize.ts, patch.ts, compilers.ts,
                                    decomp-yaml.ts, rom-sha1.ts (romSha1Problems, E_ROM_SHA1_MISMATCH), codes.ts
      model/                        types.ts, item-table.ts (ItemTable builder, itemAt), resolver.ts (labels per
                                    module, wordValueOf), paths.ts (the paths writers and checks share), segments.ts,
                                    printing-cache.ts, items.ts, chunks.ts, modules.ts, labels.ts, names.ts,
                                    symbols.ts, model.ts, codec.ts, c-unit.ts, c-data-assert.ts (the C-data
                                    section and ASSERT lines the ldscript writer prints and its check reads, D76 h),
                                    codes.ts (D62 b)
      reconcile/                    c-tokens.ts, c-scan.ts (the file-scope scanner, `compiledDefinitions` and include
                                    resolution, split out of the planner, architecture-b2-9), include-asm.ts (the
                                    INCLUDE_ASM planner), rename-tokens.ts (identifier-only renames, phase 6, D92),
                                    text-edit.ts, codes.ts
      emit/                         tree.ts, emit-tree.ts, unit-text.ts (what the chunk-file and unit-file writers
                                    share; the resolver is core/model/resolver.ts, D62 b)
        print/                      insn.ts, pool.ts, table.ts, data.ts, raw.ts
        writers/                    one file per WriterId (§6.3)
      verify/                       tiling.ts, reencode.ts, module-size.ts, text-layout.ts, link-scripts.ts (ldscript.txt
                                    and symbols.ld), text-error.ts, paths.ts, toolchain.ts (the assemble and link
                                    verdicts on the toolchain's bytes), c-stub.ts (a C unit's INCLUDE_ASM statements,
                                    read for the text-layout and link checks), report.ts, codes.ts
      write-plan/                   types.ts, plan-writes.ts, manifest.ts, journal.ts, project-plan.ts (the write
                                    state of a project or a fresh tree, D75 k), codes.ts
      scaffold/                     render.ts, vars.ts
      workflow/                     doctor.ts (phase 1: the doctor's checks, corpus threshold and verdict, D55),
                                    types.ts, discover.ts, explain.ts, config-from-discover.ts (D62 c), init-config.ts
                                    (initConfigOf, the one path to init's config, D75 f), generate.ts, c-stubs.ts (a
                                    project's C files reconciled with the model, D75 b, D77 a), init.ts,
                                    scaffold-diff.ts, analyze-update.ts, codes.ts; phase 6: proposals.ts
                                    (checkProposals, the proposal screen, §7.4) and rename.ts (planRename, D92)
    shell/                          the only code that touches files, processes, hashing or the environment
      codes.ts                      the shell's diagnostic codes
      hash.ts                       sha1/sha256 via node:crypto, incremental
      fs.ts                         listDir (sorted by code unit), atomic write (temp and rename)
      rom.ts                        readRom: a ROM file read, hashed and wrapped (D59)
      project/                      locate.ts, read-inputs.ts, templates.ts, apply-writes.ts, lock.ts, disk-state.ts,
                                    fresh-tree.ts (writeFreshTree), write-project.ts (generate's and init's writes
                                    under the project lock), spelling.ts (case-only renames on a case-insensitive file
                                    system)
      config/                       load.ts, save.ts
      toolchain/                    binutils.ts, doctor.ts, corpus.ts (runCorpus), corpus-inputs.ts (the corpus
                                    inputs digest), link-check.ts, npm.ts (D55)
      signatures/                   build-from-references.ts, locate.ts
    cli/
      main.ts, args.ts, registry.ts, exit-codes.ts
      commands/                     index.ts, lists/<component>.ts (one command list per component), one file per command,
                                    command-common.ts (what the commands share: exit codes, usage errors, span and
                                    provenance JSON, op counts, batched output; no command imports another's, D78 f)
      reporters/                    text.ts, ndjson.ts
  bench/                            dev only; imports only romlift, romlift/node, romlift/isa, romlift/internal
    src/                            cli.ts, run.ts, score.ts, parity.ts, classify.ts, seal.ts,
                                    dataset.ts, dataset-check.ts, vocabulary.ts, gates.ts, provenance.ts,
                                    digest.ts, regression.ts, ablate.ts, speed.ts, readability.ts, objdiff.ts,
                                    large-rom.ts, large-rom-bin.ts, rss-probe.ts, live-heap.ts, signatures.ts,
                                    doctor-real.ts, report.ts, serve.ts
    tools/export-poc.ts             runs the PoC (read-only, outside the repo) to dump its runs (§4.5)
    tools/objdiff.version           the pinned objdiff-cli version
    tools/convert-poc-signatures.ts converts the PoC's signature files to schema 3 into bench/.local/ (phase 6)
    dataset/real/<rom>.json         tuning and held-out datasets (§8.2)
    dataset/synthetic/<name>/       fixture sources, build.mk, expect.json, build/ (committed)
    baseline/                       poc-2026-10-16.json (the PoC's rows), poc-dump-rows.json (the pinned PoC
                                    rows of ROMs revealed later, D60), poc-digests.json, poc-source.json,
                                    accepted-diffs.json, speed.json
    overrides/                      klonoa.json: the hand-written [[overrides]] of a tuning ROM's RAM code, which
                                    g6.ram-code-mapped appends after init (D91 c)
    results.json                    the committed artifact; refreshed only by a phase lead (D43)
  test/
    architecture.test.ts            layer edges, globals allowlist, rule-file isolation, Map iteration, barrels
    unit/                           mirrors src/
    golden/                         printer, writers, config serializer and patcher, reconciler, explain
    corpus/                         generate.ts (the as round-trip corpus driver over runCorpus; output never
                                    committed; imports only the entry points and bench/src/args.ts, D55)
    mutation/                       fault injection into every checker (§10)
    gates/                          g1.*.test.ts … g6.*.test.ts, gate.ts, phase.json, and the pure helpers the
                                    gates call and test/unit/gates tests: held-out-verdict.ts (g2.held-out's
                                    cross-ROM verdict and the D60 waiver), poc-parity-check.ts
                                    (g2.poc-parity's one check, run before and after landing),
                                    baseline-rows-verdict.ts, confirm-differences.ts, dataset-binding.ts
                                    (the tmc scopings' binding, D61 f), speed-verdict.ts (g2.speed's
                                    verdict, D78 e), order.ts (byCodeUnit)
    local/                          tests that need local ROMs or the PoC; report `unavailable` when absent
    fixtures/                       tiny self-authored files for parser tests (an ELF, a map)
    helpers/                        thumb`` / arm`` byte builders, prng.ts, temp dirs, fixture loader, dummy profile,
                                    large-rom.ts, e2e.ts
```

**Dependency rules.** `test/architecture.test.ts` parses every import of `src/`, `bench/src/` and
`test/gates/` with the TypeScript compiler API (D5). A type-only import is an edge like any other, and
the test also runs the typechecker, so a frozen type that names a type from a forbidden layer fails it.
It fails on any edge not allowed here:

| From | May import |
| --- | --- |
| `foundation/*` | other `foundation/*` modules only; no npm package, no `node:*` |
| `core/provenance` | `foundation` |
| `core/profile` | `foundation`, `core/provenance` |
| `core/analysis` (all but rule files) | `foundation`, `core/provenance`, `core/profile` |
| `core/analysis/rules/<family>/<rule>.ts` | `foundation`, `core/provenance`, `core/profile/types.ts`, `core/analysis/{types,walk,pointers,address-map,limits}`, `rules/define-rule.ts`; **never another rule file, `core/profile/agbcc.ts` or `core/profile/registry.ts`**; only a family's `index.ts` imports its rule files, only `rules/index.ts` imports family indexes, only `driver/` imports `rules/index.ts` |
| `core/proposals` | `foundation`, `core/provenance` |
| `core/layout` | `foundation`, `core/profile/types.ts`, `core/analysis/types.ts`, `core/proposals` |
| `core/signatures` | `foundation`, `core/provenance`, `core/analysis/types.ts`, `core/proposals` |
| `core/config` | `foundation`, `core/proposals`, `smol-toml`, `zod`, `@match-kit/decomp-yaml` (its pure validators) |
| `core/model` | `foundation`, `core/provenance`, `core/profile/types.ts`, `core/analysis/types.ts`, `core/config` (types and `compilers.ts`), `core/layout/borders.ts` |
| `core/reconcile`, `core/scaffold` | `foundation` |
| `core/emit` | `foundation`, `core/model`, `core/reconcile` (stub planning for the `c-stub` writer) |
| `core/verify` | `foundation`, `core/model`, `core/emit/tree.ts`, `core/reconcile` and `core/config/compilers.ts` (a C unit's stub, read with the one C tokenizer, and its compiler; D74 g) |
| `core/write-plan` | `foundation`, `core/emit/tree.ts` |
| `core/diagnostic-codes.ts` | the `codes.ts` file of every module, and `foundation/rom/codes.ts` |
| `core/workflow` | every core module above; **nothing in core imports `core/workflow`** |
| `shell/*` | `core`, `foundation`, `node:*`, runtime npm dependencies |
| `cli/*` | `shell`, `core/workflow`, `core/diagnostic-codes.ts`, `foundation/diagnostics`, `src/api/*` |
| `src/api/*`, `src/{index,node,isa,internal}.ts` | the modules they re-export |
| `bench/src/*`, `test/gates/*`, `test/local/*` | `romlift`, `romlift/node`, `romlift/isa`, `romlift/internal` (package self-reference), `node:*` |
| `test/corpus/*` | the same, plus `bench/src/args.ts` (D55) |

**Globals allowlist** (D5). Under `src/foundation` and `src/core` an identifier that resolves to a
global must be one of: `Math` (but not `Math.random`), `Number`, `String`, `Boolean`, `BigInt`,
`Symbol`, `Array`, the typed arrays, `ArrayBuffer`, `DataView`, `Map`, `Set`, `WeakMap`, `Object`,
`JSON`, `Error` and its subclasses, `TextEncoder`, `TextDecoder`, `Infinity`, `NaN`, `undefined`.
Everything else (`process`, `Date`, `performance`, `crypto`, `Intl`, `globalThis`, `setTimeout`,
`import.meta`, …) fails, as do the members `localeCompare` and `toLocaleString` and an argument-less
`.sort()`. A second AST check, using the type checker, fails when `core/analysis`, `core/model`,
`core/emit`, `core/layout` or `core/signatures` iterates a `Map` or `Set` (`for…of`, spread,
`Array.from`, `forEach`, `keys`, `values`, `entries`) except through `sortedKeys` or `sortedEntries`
from `foundation/util/sorted.ts`. In the shell, only `shell/fs.ts` may call `readdir`, and
`listDir` returns names sorted by code unit.

**Barrels.** `src/index.ts`, `node.ts`, `isa.ts` and `internal.ts` contain only `export * from
'./api/<component>.ts'` lines, one per component, written by component 0 of the phase that creates
the component. Each `src/api/<component>.ts` is owned by exactly one component, and
`cli/commands/lists/<component>.ts` follows the same pattern, so parallel work never edits a shared barrel (D43).

Runtime dependencies (D38): `smol-toml`, `zod`, `@match-kit/decomp-yaml`; no optional peer dependency (the gba-kit
trace was dropped, D91). Dev dependencies: `typescript`, `@types/node`. `g1.runtime-deps`
asserts that `dependencies` is exactly these three, that no package of `npm ls --all --omit=dev` has an
install script, a `.node` file or a `binding.gyp`.

### 2.1 Commands end to end

Each command is a `CommandSpec`. The registry lists the commands that are implemented; phase gating
lives in `test/gates`, never in the shipped CLI (D29).

```ts
// cli/registry.ts
export interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly positionals: readonly PositionalSpec[];   // { name, optional? }; the parser rejects a missing or an extra one (D55)
  readonly options: readonly OptionSpec[];
  run(args: ParsedArgs, io: CliIo): Promise<ExitCode>;
}
export const ExitCode = { ok: 0, errors: 1, usage: 2, verifyFailed: 3, internal: 70 } as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
```

`errors` covers error-level diagnostics, including a refused write (`E_PATH_NOT_OWNED`) and a locked
project (`E_PROJECT_LOCKED`); `verifyFailed` covers a failed self-check or SHA-1; `internal` is an
invariant violation (a bug). No command reads stdin or prompts; `g4.cli-contract` runs every command
with stdin closed and parses `--json` output line by line.

| Command (phase) | Reads | Writes | Must end with |
| --- | --- | --- | --- |
| `doctor` (1) | the `PATH` toolchain | nothing | binutils version, the corpus re-assembled with the user's `as`, the `R_ARM_THM_JUMP11` probe, agbcc and old_agbcc present or not |
| `analyze <rom> [--json] [--disable <rule>…]` (2) | ROM | stdout only | functions with origin and provenance, rejections, diagnostics; discover mode |
| `explain <addr> [--rom <rom>] [--json]` (2, extended in 3, 4 and 6) | a ROM, or a project via `decomp.yaml` | stdout only | phase 2: owner, claim, provenance, rejections, `bl` verdicts, rule meta; phase 3: item and chunk; phase 4: name and its source; phase 6: the signature placement read from the TOML's `from` key |
| `model --json` (3) | ROM + TOML (in phase 3: ROM + in-memory config) | stdout, NDJSON | a header line, then one line per chunk (the public `ModelJson`, §3.4) |
| `verify [--assemble] [--link] [--printer raw]` (3) | ROM + TOML (or `--rom` alone, with the config `configFromDiscover` builds) | a temporary directory only | the four self-checks; `--assemble`: per module, `as` output equals the ROM range; `--link`: a full link equals the SHA-1 |
| `init <rom> [dir] [--name] [--module-size] [--no-signatures] [--json]` (4; `--no-signatures` in 6, D74 c, D93) | ROM, templates, signatures (6) | TOML, `decomp.yaml`, scaffold, `src/*.c`, generated tree | `dir` defaults to the working directory; accepted when empty, when it holds only the given ROM plus `.git` and dot-files, or when it is a romlift project; refused otherwise (`E_DIR_NOT_EMPTY`) |
| `generate [--rom <rom>] [--dry-run] [--json] [--out <dir>]` (4) | `decomp.yaml` → TOML, ROM, `src/*.c` | generated tree; `INCLUDE_ASM` edits (4: add and remove, D75 b) | self-checks pass before any write; never writes the TOML; `--dry-run --json` prints the write plan |
| `analyze --update [--write]` (4) | project | prints a TOML patch; `--write` applies it | the patch keeps comments and re-parses |
| `scaffold --diff` (4) | project, templates | nothing | how scaffold files differ from the current templates |
| `rename <old> <new>` (6, D92) | TOML, `src/`, `include/` | a one-line TOML patch; identifier tokens | refuses when `new` exists or `old` is unknown |
| `signatures build <spec> [--out <dir>]` / `signatures <rom>` (6) | reference checkouts / ROM | `signatures/<library>.json` (local, gitignored; `--out` another directory) / stdout | placements with their `sig.*` rule ids |

`init`, `generate`, `analyze --update`, `rename` and `explain` are each one function in
`core/workflow/` that takes in-memory inputs and returns a plan (an emission stream with its checks, a
TOML patch, an edit list or a report). The shell reads the inputs, calls the workflow, then calls the
pure `planWrites` and applies its operations. So every workflow and every write policy is testable
without a file system (D36, D17).

## 3. Core model

All exported types are deeply `readonly` and built by functions, never mutated after return. Every
public type is plain data: no methods, no closures, nothing a JSON codec would have to drop (D19).

```ts
// foundation/rom
export type Addr = number;                         // GBA bus address; ROM starts at 0x0800_0000
export type Mode = 'thumb' | 'arm';
export interface Span { readonly start: Addr; readonly end: Addr }        // half-open
export interface CartridgeHeader {
  readonly title: string; readonly gameCode: string; readonly makerCode: string; readonly version: number;
}
export interface Rom {                              // the one public value never serialised (it holds the bytes)
  readonly base: 0x0800_0000;
  readonly bytes: Uint8Array;
  readonly end: Addr;
  readonly sha1: string;                            // computed by the shell, passed in
  readonly header: CartridgeHeader;
}
export function romFromBytes(bytes: Uint8Array, sha1: string): Rom;
export function u8(rom: Rom, a: Addr): number;     // also u16, u32, contains(rom, a, len)

// foundation/diagnostics/diagnostic.ts: the mechanism only (D45)
export type Severity = 'error' | 'warning' | 'info';
export interface Diagnostic<C extends string = string> {
  readonly code: C;
  readonly severity: Severity;
  readonly addr?: Addr; readonly span?: Span; readonly path?: string;
  readonly message: string;
  readonly cites?: readonly Addr[];                // the addresses the decision read
  readonly rule?: string;                          // the RuleId that raised it, as text
}
export interface CodeSpec { readonly severity: Severity; readonly meaning: string }
export function defineCodes<const T extends Record<string, CodeSpec>>(codes: T): T;
```

Each module that raises diagnostics owns a `codes.ts` (`export const ConfigCodes = defineCodes({...})`).
`core/diagnostic-codes.ts` unions them into `ALL_CODES` and the type `DiagnosticCode`. A code lands in
the same commit as its first raiser, so the unit test that fails on an unused or undocumented code
never sees a code whose module has not landed (§9.1).

### 3.1 Provenance (rule records)

`evidence` keeps the plan's meaning: external facts, never a rule's decision (§7.4). Since the owner dropped the
trace (D91) and legacy import with the ELF and map importers (D92), library signatures are the only such source. What a
rule decided, and why, is *provenance* (D6). The rule metadata lives in each rule file (§4.1); `core/provenance` holds
only the types and the two vocabularies the rules emit.

```ts
// core/provenance/rule-id.ts
export type Family = 'seed' | 'walk' | 'bl' | 'valid' | 'accept' | 'gap' | 'claim' | 'region' | 'sig';
export type RuleId = `${Family}.${string}`;
export type Fact = 'rom' | 'claims' | 'function-set' | 'readings' | 'validity' | 'pointer-index'
  | 'bl-verdicts' | 'exits' | 'candidates' | 'regions' | 'placements';
export interface RuleMeta {
  readonly id: RuleId;
  readonly summary: string;       // one line, printed by explain
  readonly restsOn: string;       // the compiler or hand-written behaviour it relies on (plan: "Why it holds")
  readonly recovers: string;      // what it prevents or recovers (plan: third column)
  readonly reads: readonly Fact[];   // plan: "each pass declares what it reads from the model…"
  readonly adds: readonly Fact[];    // "…and what it adds"
  readonly origin?: Origin;          // seed and gap rules: the origin id of what they propose
}

// core/provenance/vocabulary.ts: the two vocabularies rules emit (the bench's third list is bench-only, §8.3)
export const MISS_REASONS: { readonly 'inside-code': string; /* … the plan's ten ids */ };
export type MissReason = keyof typeof MISS_REASONS;
export const ORIGINS: { readonly 'rom-entry': string; /* … the plan's ten ids plus 'listed' and 'override' ('evidence' went with seed.evidence-hint, D91 e) */ };
export type Origin = keyof typeof ORIGINS;

// core/provenance/provenance.ts
export interface Provenance {
  readonly rule: RuleId; readonly round: number;
  readonly cites: readonly Addr[];                 // at most 4 addresses that the decision read
  readonly note?: string;
}
export interface Rejection {                       // the last rejection per (at, mode), with a count
  readonly at: Addr; readonly mode: Mode; readonly rule: RuleId; readonly reason: MissReason;
  readonly intrinsic: boolean;                     // true: memoised for the whole analysis
  readonly round: number; readonly detail: string; readonly count: number;
}

// core/provenance/trail.ts
export type TrailKind = 'propose' | 'accept' | 'reject' | 'wait' | 'absorb' | 'verdict' | 'claim' | 'place';
export interface TrailEvent {
  readonly kind: TrailKind; readonly at: Addr; readonly rule: RuleId; readonly round: number;
  readonly cites: readonly Addr[]; readonly detail?: string;
}
export interface TrailSink { event(e: TrailEvent): void }
export type TrailLevel = 'off' | 'decisions' | 'full';
```

An `Origin` is never chosen by hand: it is the `origin` of the seed or gap rule that proposed the
function (`seed.call` → `call`, `gap.arm-scan` → `arm-gap-scan`, `seed.listed` → `listed`). A unit
test fails when a seed or gap rule has no `origin`, and `g2.vocabulary-emitted` fails when a miss
reason or an origin is emitted by no rule.

### 3.2 Instructions

```ts
// foundation/isa/types.ts
export type SpecId = `${'thumb' | 'arm'}.${string}`;          // 'thumb.ldr_pc', 'arm.dp_imm'
export type FieldKind = 'reg' | 'imm' | 'simm' | 'cond' | 'reglist' | 'shift' | 'rot-imm' | 'pc-rel' | 'bl-off';
export interface Field { readonly name: string; readonly lo: number; readonly width: number;
  readonly kind: FieldKind; readonly scale?: number }
export type Fields = Readonly<Record<string, number>>;
export type FlowKind = 'next' | 'branch' | 'cond-branch' | 'bl' | 'bx' | 'pop-pc' | 'mov-pc' | 'add-pc'
  | 'pc-load' | 'adr' | 'swi' | 'invalid';
export type RawReason = 'undefined' | 'unpredictable' | 'sbz-set' | 'as-alias' | 'no-roundtrip';  // encoding reasons only
export interface InsnSpec {                                // a table row; lives only in the isa table
  readonly id: SpecId; readonly mode: Mode; readonly size: 2 | 4;
  readonly mask: number; readonly match: number;           // decode: (w & mask) === match, first row wins
  readonly fields: readonly Field[];
  readonly syntax: string;                                 // GNU as unified syntax: 'ldr {rd}, {pool}'
  readonly flow: FlowKind;
  readonly asPriority: number;                             // GNU as's choice when two rows parse one text
  readonly stack?: (f: Fields) => number;                  // sp delta in bytes (push, pop, add sp)
  readonly raw?: (f: Fields) => RawReason | null;          // encodings as will not reproduce
}
export type Flow =
  | { readonly kind: 'next' }
  | { readonly kind: 'branch'; readonly target: Addr; readonly conditional: boolean }
  | { readonly kind: 'bl'; readonly target: Addr }
  | { readonly kind: 'return'; readonly via: 'bx-lr' | 'pop-pc' | 'mov-pc-lr' }
  | { readonly kind: 'indirect'; readonly reg: number; readonly via: 'bx' | 'mov-pc' | 'add-pc' | 'load-pc' }
                                                           // load-pc: pc loaded through base `reg` (ldr/ldm, base not sp; 15 = a pc-relative table read)
  | { readonly kind: 'pool-load'; readonly pool: Addr; readonly rd: number }  // rd 15 (ldr pc, [pc, #imm]) transfers control: the walker reads rd
  | { readonly kind: 'adr'; readonly target: Addr }
  | { readonly kind: 'swi'; readonly imm: number }
  | { readonly kind: 'mode-switch'; readonly target: Addr }               // bx pc
  | { readonly kind: 'invalid' };
export interface Insn {                                    // plain data: the row is named, not embedded
  readonly addr: Addr; readonly mode: Mode; readonly size: 2 | 4;
  readonly word: number;                                   // the original bytes (bl: both halfwords)
  readonly specId: SpecId; readonly fields: Fields; readonly flow: Flow;
}
export function specOf(id: SpecId): InsnSpec;
export interface SymbolResolver {
  labelFor(addr: Addr, from: Addr): string | undefined;    // the printer never invents a name
  addressOf(name: string): Addr | undefined;               // parse() maps a label back
}
```

`decode(mode, word, addr)` computes `Flow` targets from `addr`; the analysis passes the **run**
address, which equals the load address everywhere except in a `runs_at` range (§3.3, §6.7).

### 3.3 Addresses and the analysis result

**Load and run addresses** (D46). A byte has a load address (where it sits in the ROM) and a run
address (where the CPU executes it). They differ only inside an `[[overrides]]` range with `runs_at`.
`AddressMap` lands in phase 2 as the identity; phase 6 fills it from hand-written overrides with `runs_at` (D91).

```ts
// core/analysis/address-map.ts
export interface AddressMap {
  readonly ranges: readonly { readonly load: Span; readonly run: Addr }[];   // sorted, disjoint
}
export function addressMap(overrides: readonly OverrideFact[]): AddressMap;  // identity when none sets runsAt
export function toRun(m: AddressMap, load: Addr): Addr;
export function toLoad(m: AddressMap, run: Addr): Addr | undefined;          // undefined: not ROM-backed
```

The walk cursor reads bytes at load addresses and computes branch, pool and `adr` targets in run
space, then maps a target back with `toLoad`; a target with no load address is a RAM reference, never
a function candidate. Every address stored below is a load address unless named `runAt`.

The `Reading` (the walk of one entry under the current claims) is internal to `core/analysis`. What
leaves the analysis is a `FunctionFact`: span-level and serialisable (D19). Instructions are re-decoded
by the model from `code` spans.

```ts
// core/analysis/types.ts
export const Claim = { free: 0, code: 1, pool: 2, table: 3, dead: 4, padding: 5, data: 6 } as const;
export type ClaimKind = (typeof Claim)[keyof typeof Claim];

export interface JumpTable { readonly base: Addr; readonly targets: readonly Addr[]; readonly thumbBit: boolean }
export interface CallSite { readonly site: Addr; readonly target: Addr; readonly mode: Mode }
export type BlVerdict = 'call' | 'far' | 'noreturn';
export interface BlVerdictRecord { readonly site: Addr; readonly target: Addr; readonly verdict: BlVerdict;
  readonly rule: RuleId }
export interface Exit { readonly at: Addr; readonly rule: RuleId;
  readonly kind: 'return' | 'tail' | 'noreturn-call' | 'swi-end' | 'reg-jump' }

export interface FunctionFact {
  readonly entry: Addr; readonly mode: Mode;
  readonly runAt?: Addr;                          // set only inside a runs_at range
  readonly extent: Span;                          // code plus adjacent pools and tables (claim.adjacent-pools)
  readonly codeEnd: Addr;                         // computed once when the reading is built (§9.3)
  readonly code: readonly Span[];                 // instruction bytes, merged runs
  readonly dead: readonly Span[];                 // claim.dead-code-in-extent
  readonly pools: readonly Addr[];                // adjacent pool words
  readonly farPools: readonly Addr[];             // claimed, outside the extent
  readonly tables: readonly JumpTable[];
  readonly calls: readonly CallSite[];
  readonly blVerdicts: readonly BlVerdictRecord[];
  readonly exits: readonly Exit[];
  readonly branchTargets: readonly Addr[];        // targets of b/bcc inside the function (the held-out classifier reads them)
  readonly adrs: readonly Addr[]; readonly veneers: readonly Addr[];
  readonly absorbed: readonly Span[];             // gap.adr-block-absorb
  readonly holes: readonly Span[];                // tiled-hole and ARM-mixer bytes kept inside the extent
  readonly origin: Origin;
  readonly accepted: Provenance;                  // the rule that proposed it and the accept rule that took it
  readonly also: readonly Provenance[];           // later proposals of the same entry
}

export interface UnlistedFinding { readonly entry: Addr; readonly mode: Mode; readonly origin: Origin;
  readonly provenance: Provenance }
export interface ListedInvalid { readonly entry: Addr; readonly rejection: Rejection }

interface AnalysisCommon {
  readonly schema: 'romlift/analysis@1';
  readonly rom: { readonly sha1: string; readonly end: Addr };
  readonly profile: ProfileId;
  readonly options: AnalysisOptionsRecord;        // the serialisable public options; tuning is never recorded
  readonly functions: readonly FunctionFact[];    // sorted by entry; never derived from Map iteration
  readonly claims: readonly { readonly span: Span; readonly kind: ClaimKind; readonly owner?: Addr }[];
  readonly startup: { readonly span: Span; readonly entries: readonly Addr[] };
  readonly codeEnd: Addr;
  readonly rejections: readonly Rejection[];      // sorted by (at, mode)
  readonly diagnostics: readonly Diagnostic[];
}
export type AnalysisResult =
  | (AnalysisCommon & { readonly mode: 'discover' })
  | (AnalysisCommon & { readonly mode: 'confirm'; readonly unlisted: readonly UnlistedFinding[];
      readonly listedInvalid: readonly ListedInvalid[] });

export interface AnalysisOptions {                // public
  readonly mode: 'discover' | 'confirm';
  readonly seeds: readonly Seed[];               // confirm: exactly the TOML's [functions]; discover: none (no evidence source seeds, D91)
  readonly overrides: readonly OverrideFact[];
  readonly trail: TrailLevel;
  readonly trailFilter?: Span;                   // explain: keep only events touching this span
}
export interface Seed {
  readonly entry: Addr; readonly mode: Mode;
  readonly rule: 'seed.listed' | 'seed.override';   // replaces a separate source field (seed.evidence-hint deleted, D91 e)
  readonly name?: string; readonly size?: number; readonly label?: boolean;
}
export interface OverrideFact { readonly span: Span; readonly kind: 'code' | 'data';
  readonly mode?: Mode; readonly runsAt?: Addr }

export function analyze(rom: Rom, profile: CompilerProfile, options: AnalysisOptions,
  sink?: TrailSink): AnalysisResult;

// exported from romlift/internal only, outside semver (D37)
export interface AnalysisTuning {               // no worklist member: it is always ascending (D10, D59 n)
  readonly cache: 'epoch' | 'epoch-reuse';       // §4.2, D13
  readonly disabled: readonly RuleId[];          // `analyze --disable`, `bench ablate`
}
export function analyzeTuned(rom: Rom, profile: CompilerProfile, options: AnalysisOptions,
  tuning: AnalysisTuning, sink?: TrailSink): AnalysisResult;
```

### 3.4 Config, proposals, model and emission stream

```ts
// core/config/schema.ts (types inferred from the zod schema; the TOML is in §6.5)
export interface RomliftConfig {
  readonly schema: 1;
  readonly rom: { readonly path: string; readonly sha1: string };
  readonly build: { readonly name: string; readonly compiler: BuildCompilerId };   // the default per module
  readonly signatures: { readonly enabled: boolean; readonly libraries?: readonly string[] };
  readonly modules: readonly ModuleConfig[];
  readonly functions: ReadonlyMap<Addr, FunctionConfig>;
  readonly symbols: ReadonlyMap<Addr, SymbolConfig>;
  readonly overrides: readonly OverrideConfig[];
}
export interface ModuleConfig {
  readonly name: string; readonly start: Addr; readonly kind: 'asm' | 'c' | 'data';
  readonly generated: boolean; readonly library?: string; readonly version?: string;
  readonly compiler?: BuildCompilerId;           // default: build.compiler (D47)
  readonly cflags?: readonly string[];           // appended to the compiler's default flags
  readonly dataStart?: Addr;                     // phase 6 (`data_start`): the module's C data range starts here (§6.6, D92, D93)
}
export interface FunctionConfig { readonly name: string; readonly mode: Mode; readonly size?: number;
  readonly label?: boolean;                      // a typed global label inside the containing function, not a chunk start
  readonly aliases: readonly string[]; readonly from?: string }      // from: a sourceKey (D9)
export interface SymbolConfig { readonly name: string; readonly size?: number;
  readonly type?: 'pointers' | 'bytes'; readonly aliases: readonly string[]; readonly from?: string }
export interface OverrideConfig { readonly start: Addr; readonly size: number; readonly kind: 'code' | 'data';
  readonly mode?: Mode; readonly runsAt?: Addr; readonly from?: string }

// core/config/compilers.ts: build compilers, an open registry (D47)
export type BuildCompilerId = string;            // 'agbcc' and 'old_agbcc' ship
export interface BuildCompiler { readonly id: BuildCompilerId; readonly cc1: string;   // path under tools/agbcc/bin
  readonly flags: readonly string[]; readonly rule: string }                           // templates/compilers/<id>.mk
export const BUILD_COMPILERS: Readonly<Record<BuildCompilerId, BuildCompiler>>;

// core/proposals/types.ts: the one shape every proposer returns (D9)
export type ProposalSource =
  | { readonly kind: 'signature'; readonly library: string; readonly version: string; readonly rule: RuleId }
  | { readonly kind: 'analysis'; readonly rule: RuleId }
  | { readonly kind: 'layout'; readonly reason: 'header' | 'startup' | 'asm-only' | 'module-size' | 'data' | 'runs-at' };  // inferModules (D62 d); 'runs-at': the borders of a runs_at range (§6.7, phase 6)
export type Proposal =
  | { readonly kind: 'function'; readonly addr: Addr; readonly mode: Mode; readonly name?: string;
      readonly size?: number; readonly label?: boolean; readonly source: ProposalSource }
  | { readonly kind: 'symbol'; readonly addr: Addr; readonly name: string; readonly size?: number;
      readonly type?: 'pointers' | 'bytes'; readonly source: ProposalSource }
  | { readonly kind: 'module'; readonly name: string; readonly start: Addr; readonly moduleKind: 'asm' | 'c' | 'data';
      readonly library?: { readonly name: string; readonly version: string }; readonly source: ProposalSource }
  | { readonly kind: 'override'; readonly span: Span; readonly overrideKind: 'code' | 'data';
      readonly mode?: Mode; readonly runsAt?: Addr; readonly source: ProposalSource };
export function sourceKey(s: ProposalSource): string | undefined;   // 'sig:m4a@2001'; undefined: 'analysis' and
                                                                    // 'layout' are never persisted (the evidence and legacy
                                                                    // sources went with their importers, D91 e, D92)
export interface LibraryRegion { readonly span: Span; readonly library: string; readonly version: string }

// core/model/types.ts: plain data; `model --json` is its NDJSON form (D19)
export const ItemKind = { insn: 0, rawInsn: 1, pool: 2, tableEntry: 3, padding: 4, data: 5 } as const;
export type ItemRawReason = RawReason | 'cross-module-short-branch' | 'interworking-branch';
export interface ItemTable {                      // struct of arrays; tiles [base, end) in address order
  readonly count: number;
  readonly kind: Uint8Array;                      // ItemKind
  readonly start: Uint32Array; readonly length: Uint32Array;
  readonly spec: Uint16Array;                     // isa row index for insn and rawInsn; 0xFFFF otherwise
  readonly aux: Uint32Array;                      // pool value, table target, ItemRawReason code, data note code
}
export type Item =                                // decoded on demand by itemAt(model.items, i, rom)
  | { readonly kind: 'insn'; readonly span: Span; readonly insn: Insn }
  | { readonly kind: 'raw-insn'; readonly span: Span; readonly insn?: Insn; readonly reason: ItemRawReason }
  | { readonly kind: 'pool'; readonly span: Span; readonly value: number }
  | { readonly kind: 'table-entry'; readonly span: Span; readonly target: Addr; readonly thumbBit: boolean }
  | { readonly kind: 'padding'; readonly span: Span }                 // zeros up to a word boundary
  | { readonly kind: 'data'; readonly span: Span; readonly note?: 'dead' | 'mixer-hole' | 'unreached' };
export type ChunkKind = 'header' | 'startup' | 'function' | 'orphan' | 'data';
export interface Chunk {
  readonly span: Span; readonly kind: ChunkKind; readonly name: string; readonly mode: Mode | null;
  readonly module: string; readonly items: { readonly first: number; readonly count: number };
  readonly innerLabels: readonly Label[];         // `label = true` entries and second entries
  readonly runAt?: Addr;
  readonly entry?: Addr;                          // where its label and start macro go, when not span.start:
}                                                 // a function chunk whose span opens with a folded pad (§6.2, D75 d)
export interface Module {
  readonly name: string; readonly span: Span; readonly kind: 'asm' | 'c' | 'data';
  readonly generated: boolean; readonly compiler: BuildCompilerId; readonly cflags: readonly string[];
  readonly library?: { readonly name: string; readonly version: string };
  readonly runAt?: Addr;                          // phase 6 adds dataStart (D62 d, D76 g)
  readonly chunks: { readonly first: number; readonly count: number };
}
export type LabelKind = 'func' | 'local' | 'pool' | 'table' | 'data';
export interface Label { readonly addr: Addr;     // the run address; equals the load address outside runs_at
  readonly name: string; readonly kind: LabelKind; readonly thumb: boolean;
  readonly scope: 'global' | 'module' }           // global := referenced from another module
export type NameSource = { readonly kind: 'default' } | { readonly kind: 'toml'; readonly from?: string };
export interface ModelFunction {
  readonly entry: Addr; readonly extent: Span; readonly mode: Mode; readonly name: string;
  readonly aliases: readonly string[]; readonly runAt?: Addr;
  readonly source: { readonly name: NameSource; readonly extent: 'analysis' | 'toml-size' | 'override' | 'next-listed' };
}
export interface Model {
  readonly schema: 'romlift/model@1';
  readonly rom: { readonly sha1: string; readonly end: Addr };
  readonly build: { readonly name: string };
  readonly functions: readonly ModelFunction[];
  readonly chunks: readonly Chunk[];
  readonly modules: readonly Module[];
  readonly items: ItemTable;
  readonly labels: readonly Label[];              // sorted by addr, then name
  readonly symbols: readonly { readonly addr: Addr; readonly name: string; readonly size?: number }[];
  readonly unlisted: readonly UnlistedFinding[];
  readonly diagnostics: readonly Diagnostic[];
}
export function buildModel(rom: Rom, analysis: AnalysisResult, config: RomliftConfig): Model;
// core/model/item-table.ts; runOffset = chunk.runAt - chunk.span.start inside a runs_at range (D62 b)
export function itemAt(items: ItemTable, i: number, rom: Rom, runOffset?: number): Item;
// core/model/resolver.ts (D62 b): visible in `module` = global, or lying in it; preferred label per address
export function resolverFor(model: Pick<Model, 'labels' | 'modules'>, module: string): SymbolResolver;
export function wordValueOf(label: Pick<Label, 'addr' | 'kind' | 'thumb'>): number;   // addr | 1 for a Thumb func

// core/model/codec.ts: the public JSON contract for asmlift and Mizuchi
export interface ModelJsonHeader { readonly schema: 'romlift/model-json@1'; /* rom, build, modules,
  functions, labels, symbols, unlisted, diagnostics */ }
export interface ModelJsonChunk { /* chunk fields, `entry` when set; items: [kind, start, length, specId | null, aux][] */ }
export function encodeModel(model: Model, rom: Rom): Iterable<string>;   // NDJSON lines, header first

// core/emit/tree.ts: plain data, no closures (D17)
export type WriterId = 'header' | 'crt0' | 'function' | 'orphan' | 'module' | 'data' | 'ldscript'
  | 'symbols' | 'modules-mk' | 'expected' | 'objdiff' | 'c-stub' | 'scaffold';
export type FileEntry =
  | { readonly ownership: 'generated'; readonly path: string; readonly text: string; readonly writer: WriterId }
  | { readonly ownership: 'scaffold'; readonly path: string; readonly text: string; readonly writer: 'scaffold' | 'c-stub' }
  | { readonly ownership: 'reconciled'; readonly path: string; readonly baseSha1: string;
      readonly edits: readonly TextEdit[] };
export interface TextEdit { readonly start: number; readonly end: number; readonly text: string;
  readonly reason: 'add-stub' | 'remove-stub' | 'add-header' }   // phase 6's renames add theirs (fix round 7)
export interface DecompState { readonly defined: ReadonlySet<string> }    // names defined in src/*.c
export type Printer = 'readable' | 'raw';
export interface EmitContext { readonly decomp: DecompState; readonly printer?: Printer }   // default 'readable' (D62 d)
export interface PrintStats { readonly insns: number; readonly rawInsns: number; readonly branches: number;
  readonly symbolicBranches: number; readonly poolLoads: number; readonly symbolicPoolLoads: number;
  readonly rawReasons: Readonly<Record<string, number>> }                   // the readability family's inputs
export interface PrintedChunk { readonly lines: readonly string[]; readonly stats: PrintStats }
export interface Writer { readonly id: WriterId; readonly scope: 'module' | 'global';
  emit(rom: Rom, model: Model, cx: EmitContext, module: number | null): Iterable<FileEntry> }
// core/emit/emit-tree.ts: per generated module in ROM order, its module-scoped writers' entries sorted by path,
// then the global writers' entries (ldscript.txt, symbols.ld) sorted by path; re-callable, deterministic
export function emitTree(rom: Rom, model: Model, cx: EmitContext): Iterable<FileEntry>;
export function printChunk(rom: Rom, model: Model, chunk: number, how?: Printer | EmitContext): PrintedChunk;  // default 'readable' (D63)

// core/write-plan/plan-writes.ts: the write policy, pure (D17)
export interface Manifest { readonly schema: 1; readonly romlift: string;
  readonly files: Readonly<Record<string, { readonly sha1: string; readonly writer: WriterId }>> }
export type WriteOp =
  | { readonly op: 'write'; readonly path: string; readonly text: string; readonly sha1: string; readonly writer: WriterId }
  | { readonly op: 'edit'; readonly path: string; readonly baseSha1: string; readonly resultSha1: string;
      readonly text: string }
  | { readonly op: 'delete'; readonly path: string }
  | { readonly op: 'keep'; readonly path: string; readonly sha1: string };
export interface WritePlanInputs {
  readonly entries: Iterable<FileEntry>;
  readonly manifest: Manifest | null;
  readonly disk: ReadonlyMap<string, string | 'absent'>;   // sha1 of every path under the generated roots, and of every tree path
  readonly reconciledTexts: ReadonlyMap<string, string>;   // current text of each reconciled file
  readonly hash: (text: string) => string;                 // injected by the shell (D44)
  readonly retained: readonly string[];                    // path prefixes of generated = false modules (D62 d)
  readonly journal?: Journal | null;                       // an interrupted run's journal: its paths count as owned (D63)
  readonly romlift?: string;                               // the version stamped on the new manifest (D63)
}
export interface WritePlan { readonly ops: readonly WriteOp[]; readonly manifest: Manifest;
  readonly diagnostics: readonly Diagnostic[] }
export function planWrites(inputs: WritePlanInputs): WritePlan;
```

What changes from the PoC: its `Func` mixed reading, acceptance and mutation (`absorbBlock` writes into
another function's maps). Here a `Reading` is immutable, an absorption produces a new fact with a
combined reading, and the PoC's free-text `origin` and miss-reason strings become vocabulary ids that
rules emit directly, so the bench's `originId(text)` and `missReasonId(text)` prefix matching disappears.
There is no overlay module: `buildModel` reads the config directly, with name resolution in
`core/model/names.ts`, and writers read everything they need from the `Model` (D9, D19). The word
"overlay" is not used anywhere in romlift; code that runs from RAM is called `runs_at` (§6.7).

## 4. The analysis

### 4.1 Rules as named units

Every rule is one file `core/analysis/rules/<family>/<name>.ts` of 20 to 80 lines that exports one value
built by `defineRule`, which carries the rule's metadata next to its code (D7):

```ts
// core/analysis/rules/valid/dense.ts
export default defineRule({
  meta: { id: 'valid.dense', summary: 'holes inside the extent stay within max(minHoles, extent >> holeShift)',
          restsOn: 'a compiled function is one contiguous run', recovers: 'data decoded as code',
          reads: ['readings', 'rom'], adds: [] },
  kind: 'valid', reason: 'not-dense', intrinsic: true,
  check(r, v) { /* … */ },
});
```

Each family directory has an `index.ts` that exports its rules as an unordered record keyed by id;
`rules/index.ts` concatenates the eight family records into `RULES`. Order lives only in the profile's
pipeline (§4.3). A rule file never imports another rule file; shared logic lives in `walk/`,
`pointers.ts` or `types.ts`. Each rule has a unit test built from hand-assembled bytes
(`test/helpers/thumb.ts`), and `bench ablate <rule>` measures its contribution.

**Contracts.** The rules are predicates and proposers. The driver calls each one at the exact place the
PoC evaluates the same condition (D48), so the contracts follow the PoC's call sites rather than an
idealised pipeline:

```ts
// core/analysis/types.ts
export interface AnalysisView {                       // what a rule may read; the driver owns all state
  readonly rom: Rom; readonly profile: CompilerProfile; readonly addresses: AddressMap;
  readonly round: number; readonly epoch: number;
  claimAt(a: Addr): ClaimKind;
  owner(a: Addr): FunctionFact | undefined;            // innermost extent covering a (§9.3)
  isFunction(a: Addr): boolean;                        // discover: accepted; confirm: listed (§4.2)
  read(entry: Addr, mode: Mode): Reading;              // cached for the current epoch (§4.2)
  valid(entry: Addr): boolean;                         // the driver's validity service (driver/validity.ts)
  neverValid(entry: Addr): boolean;                    // intrinsic failures, remembered for the analysis
  originOf(rule: RuleId): Origin | undefined;          // a proposer's meta.origin (D59)
  readonly pointers: PointerIndex;
  // D56 added seeds, overrides, functions(), accepted(), whyInvalid(), inProgress() and adrOwner()
}
// A proposer returns a Proposal; the driver stamps the id of the slot it called (D59), so no rule spells
// its own id and accept rules judge a candidate by its origin, never by another rule's id.
export interface Proposal  { readonly entry: Addr; readonly mode: Mode; readonly cites: readonly Addr[] }
export interface Candidate extends Proposal { readonly proposedBy: RuleId }

export interface SeedRule    { kind: 'seed';    seeds(v: AnalysisView): readonly Proposal[] }             // round 0, sorted
export interface HarvestRule { kind: 'harvest'; harvest(v: AnalysisView, earlier: ReadonlySet<Addr>): readonly Addr[] }
export interface QueueRule   { kind: 'queue';   queue(f: FunctionFact, v: AnalysisView): readonly Proposal[] }   // at accept, and for an absorbed block
export interface WalkPolicy  { kind: 'walk';    onInsn(insn: Insn, cursor: WalkCursor): WalkStep | undefined }
export type WalkStep =
  | { readonly step: 'end-path'; readonly exit: Exit['kind'] }
  | { readonly step: 'pool'; readonly addr: Addr }
  | { readonly step: 'table'; readonly table: JumpTable }
  | { readonly step: 'switch-mode'; readonly target: Addr }
  | { readonly step: 'continue' } | { readonly step: 'padding' }          // D56
  | { readonly step: 'arm-tail'; readonly target: Addr };                 // walk.inline-arm-switch (D59)
export interface BlVerdictRule { kind: 'bl';
  decide(site: BlSite, caller: Reading, v: AnalysisView): BlVerdict | 'defer' | undefined }
export interface ValidityRule { kind: 'valid'; readonly reason: MissReason; readonly intrinsic: boolean;
  check(r: Reading, v: AnalysisView): string | undefined }                  // the detail on failure
export interface AcceptRule { kind: 'accept';                              // the driver records the provenance
  holds(c: Candidate, r: Reading, v: AnalysisView): { readonly cites: readonly Addr[]; readonly note: string } | undefined }
export interface ClaimRule  { kind: 'claim';  claims(f: FunctionFact, r: Reading, v: AnalysisView): readonly ClaimEdit[] }
export interface RegionRule { kind: 'region'; classify(v: AnalysisView): readonly ClaimEdit[] }

// gap family: one contract per PoC call site inside fillGaps
export interface GapCursor { readonly gap: Span; readonly at: Addr; readonly end: Addr;
  readonly head?: Reading; readonly pass: 'patient' | 'impatient' }
export interface GapAbsorb   { kind: 'gap-absorb';   absorb(c: GapCursor, v: AnalysisView): { readonly into: Addr; readonly span: Span } | undefined }
export interface GapHead     { kind: 'gap-head';     head(c: GapCursor, v: AnalysisView): Reading | undefined }
export interface GapProposer { kind: 'gap';          propose(c: GapCursor, v: AnalysisView): Proposal | undefined }
export interface GapPrefer   { kind: 'gap-prefer';   prefer(thumb: Reading, arm: Reading, v: AnalysisView): 'thumb' | 'arm' }
export interface GapSkip     { kind: 'gap-skip';     skip(c: GapCursor, v: AnalysisView): Addr | undefined }   // next cursor, or stop
```

The rules, with the PoC source each one is ported from (`romlift-poc/src/analysis.ts`):

| Family | Rule ids (contract) | PoC call site |
| --- | --- | --- |
| seed | `seed.rom-entry`, `seed.startup-pointer`, `seed.listed`, `seed.override` (SeedRule; `seed.evidence-hint` deleted, D91 e); `seed.pool-pointer`, `seed.data-pointer` (HarvestRule); `seed.call`, `seed.veneer`, `seed.adr`, `seed.ram-copy` (QueueRule; `seed.ram-copy` has no PoC counterpart, D60 e) | `run()`; `pointerCandidates()` (one snapshot per `grow` round, data list filtered by the pool set and `neverValid`); the `accept()` worklist; `seed.ram-copy` maps the IWRAM pointers accepted code jumps through to the load image of a block accepted code copies to IWRAM (a BIOS CpuSet/CpuFastSet, or a callee whose loads and stores name the source and the destination), and `seed.adr` proposes only past the function's extent (D60 g) |
| walk | `walk.pc-load-is-pool`, `walk.table-nearest-pool-load` (until milestone M3, then `walk.table-by-register`), `walk.mov-lr-pc-bx-is-call`, `walk.noreturn-call-before-noncode`, `walk.swi-before-noncode`, `walk.mov-pc-without-table`, `walk.branch-into-function`, `walk.bx-pc-veneer`, `walk.trailing-zero-padding`; `walk.inline-arm-switch` (no PoC counterpart, D59) | `analyzeThumb`, `analyzeArm`; `walk.inline-arm-switch` answers a Thumb `bx rN` after `add rN, pc, #0` (the walk of the ARM code after it gives the extent, `Reading.armTails`) |
| bl | `bl.self-or-accepted`, `bl.target-before-entry`, `bl.near-is-call`, `bl.target-inside-caller`, `bl.target-has-prologue`, `bl.target-beyond-callee` (no PoC counterpart, D59), `bl.target-pops-unpushed-frame`, `bl.noreturn-before-noncode` | `settle()`; `bl.target-beyond-callee` sits before the frame check: a far `bl` past the entry of another function the caller calls is a call |
| valid | `valid.in-rom-unclaimed`, `valid.decodes`, `valid.balanced-stack`, `valid.returns-or-prologue`, `valid.no-claimed-code`, `valid.pool-not-code`, `valid.not-pointer-table`, `valid.dense`, `valid.calls-code` | `whyInvalid()` in this order; `dense()`, `looksLikePointerTable()`, `couldBeCode()` |
| accept | `accept.tiles-after-accepted`, `accept.prologue-and-loaded`, `accept.prologue-and-end-anchored`, `accept.pointer-table-run`, `accept.prologue-and-calls-accepted` (no PoC counterpart, D60 h), `accept.tiny-anchored-at-start` | `acceptable()`, `inPointerTable()`, `thumbCandidate()`; `accept.prologue-and-calls-accepted` takes a data-named candidate with a prologue, a return and calls only to accepted functions |
| gap | `gap.adr-block-absorb` (GapAbsorb), `gap.tiled-hole` (GapHead), `gap.tiled-hole-inner`, `gap.forward-chain`, `gap.arm-scan`, `gap.end-anchor`, `gap.backward-prologue-chain` (GapProposer), `gap.arm-over-prologueless-thumb` (GapPrefer), `gap.skip-padding-and-pointers` (GapSkip) | `fillGaps()`: `absorbRun`, `holeHead`, `tryTiledHole` and the head acceptance (both through the proposers after the pair, `gap.tiled-hole-inner`, D59), `thumbCandidate`, `armAhead`, the comparison at the same cursor, the end-anchor loop, the backward prologue chain, the padding and pointer-word step; since D60 `gap.end-anchor` also takes a veneer-array element and a `push {.., lr}` on 2 mod 4, and `gap.forward-chain` declines a word holding an accepted function's address |
| claim | `claim.adjacent-pools`, `claim.far-pools`, `claim.dead-code-in-extent` | `claim()`, `Func.end`; `claim.dead-code-in-extent` leaves an unreached copy of the reading's own `movs rX, #k; b T` entry stub free (D60 d) |
| region | `region.startup`, `region.padding`, `region.data-after-code` | `startup` getter, classification |
| sig (§7) | `sig.unique-fit`, `sig.link-order-run`, `sig.neighbour-spacing`, `sig.pinned-both-sides`, `sig.short-member-window` | `signatures/apply.ts`; their own registry in `core/signatures/rules/` |

The registry test (`g2.rule-registry`) fails on a rule without complete metadata (`summary`, `restsOn`,
`recovers`, `reads`, `adds`, and `origin` for seed and gap rules), on a rule that is in no pipeline slot
or in more than one, on a pipeline id with no implementation, and on a rule without a unit test file.
The signature registry is merged with `RULES` only for `explain`.

### 4.2 Driver

`core/analysis/driver/` ports the PoC's control flow nearly verbatim (D48): `run.ts` (`run()`),
`grow.ts` (`grow()` with its own until-stable loop and one `pointerCandidates` snapshot per round),
`fill-gaps.ts` (`fillGaps()`: `hi` computed once per call, the gap head computed once per gap, absorb at
the gap start and at every forward-chain position, the Thumb/ARM choice at the same cursor, the
backward end-anchor loop that shrinks `end`, the late head acceptance, and the patient pass skipping a
whole gap; positions are bus addresses, the hole head is accepted under the head rule wherever a
proposer after the pair takes it, and the count it returns is what `accept()` reports, absorbed blocks'
calls included, so a confirm run whose candidates are unlisted reaches its fixpoint; after a reading the scan
resumes on the halfword where it ends when `alignment.thumbFunction` allows a Thumb function there and that
halfword is not padding, else on the next `alignment.cFunction` boundary, D60 a), `accept.ts` (`accept()` and `claim()`), `settle.ts` (the per-function `bl` fixpoint),
`validity.ts` (`valid()`: the optimistic memo set before the check, intrinsic failures kept in
`neverValid`, which also filters harvests), `epoch.ts` and `worklist.ts`; `state.ts` (the state and
`createDriver`), `facts.ts` (`FunctionFact`, the extent end, the owner), `trail.ts` (events, rejections)
and `view.ts` (the view). The rule slots are called at the PoC's call sites, in the order the profile's
pipeline gives, and every decision is a slot's: the driver repeats no rule's predicate and names no
rule id (D59). `grow` asks the validity slot about every harvest target that is not yet a function,
claimed ones included (`valid.in-rom-unclaimed` rejects those before any reading); an accept veto's
decision is a rejection under the veto's id. What the gap scan does without a slot is traversal and
format, not a decision: it steps over bytes a claim rule already claimed, and it never stands in the
cartridge header (D59 l). Stage control stays code because it is
the PoC's code; only the slot orders are data, so a reorder is a diff of the profile.

**Epochs** (D13). An epoch begins at every `grow` round and every `fillGaps` call, where the PoC calls
`forgetCandidates()`. Within an epoch a reading or a validity verdict, once computed, is reused even
after later acceptances in the same epoch, exactly as the PoC reuses it. At an epoch boundary the
readings of non-accepted entries and the validity memo are dropped; intrinsic failures and accepted
readings stay. This is the semantics, not an optimisation: `cache: 'epoch'` is the only production
mode. `cache: 'epoch-reuse'` (internal, built at milestone M2 only if a ROM misses the budget) may carry
a reading across a boundary when every fact it read is unchanged, and a local test requires its digests
to equal `'epoch'` on every tuning ROM. One bound evicts by capacity, and only on pathological input:
the readings an epoch holds for entries not accepted are limited to `epochReadingBytes` (below), past
which they are dropped (their verdicts stay memoised) and re-walked when asked for.

**Two modes, one driver** (D8):

- `discover` (used by `analyze`, `init`, `analyze --update` and the bench) accepts what the rules accept.
- `confirm` (used by `generate`, `model`, `verify` and `explain` inside a project) seeds exactly the
  TOML's `[functions]` as `seed.listed`, and `isFunction(a)` is true for every listed entry from round
  0. A listed entry's extent is its TOML `size` when given; otherwise its reading under that fixed
  function set, cut at the next listed entry that is not `label = true` (`ModelFunction.source.extent`
  says which). Only a listed entry with `from` (another source's proposal, §6.5) is validated
  (`Seed.validate`, which `listedSeedsOf` sets exactly when the entry has `from`; D68 e, the owner's answer
  "Only entries with `from`", D76 a); one that fails validity is honoured (`W_LISTED_INVALID`, recorded in
  `listedInvalid`). An entry without `from` is taken without the valid.* rules and never warns. `generate`,
  `model`, `verify`, `explain` and `analyze --update`'s confirm run all seed through `listedSeedsOf` (D77 e). Harvest and gap rules still run, but their acceptances become `UnlistedFinding`s and
  `W_UNLISTED_FUNCTION` diagnostics, and claim nothing. A `bl` to an unlisted target is decided by the
  same `bl.*` rules but never creates a function. So a tool upgrade cannot add or drop a split; it can
  only report.

`g2.confirm-equals-discover` (tier real, phase 2) runs discover, builds the listed set from it (entries,
modes, `label` for entries inside another found extent, no sizes), runs confirm, and requires the parity
view (functions, extents, far verdicts, claims) to be equal on every tuning ROM. If it fails on a ROM,
the remedy is a final `resettle` stage in discover that recomputes `bl` verdicts and readings against the
final function set until stable; it then runs in both modes and lands as its own commit with its bench
diff under the rules of §4.5. `g4.generate-idempotent` later proves the same on the files. The gate
holds on fe7j, klonoa, pokeemerald, sa2 and sa3 and fails on tmc, on six functions of hand-written code
with several entries whose shared code goes to whichever entry is taken first (D60 k); a confirm mode that
took the listed entries after the passes held by construction and was withdrawn. By the owner's answer to
Q3 ("Build resettle, else accept", D61 e) the `resettle` stage was built and measured: it cuts the cartridge
entry's extent at the startup piece and the m4a mixer's at its inner entries on the other tuning ROMs and
moves the sealed pair's counts, so it was reverted, and tmc's six differences of Q3 are a known phase-2
limitation, pinned by content (D61 e); by the owner's answer to Q6 ("Yes, cover all 8") the limitation also
covers 0x080B255C and 0x080B2874, which `95b257b` moved after Q3's count, and their three claim runs. The gate (`test/gates/confirm-differences.ts`) compares the two views
in full on every ROM, equal digests or not, and decides on the differences themselves (`viewDifferences`,
`judgeDifferences`; the views' digests are only a cross-check). `KNOWN_DIFFERENCES.tmc` holds each of the
eight functions' discover and confirm records (mode, extent, far verdicts) and the four differing claim runs
(0x080087D2..0x08008886, as measured at `9c8b282` with the six of Q3; 0x080B2874..0x080B289C,
0x080B2874..0x080B299C and 0x080B289C..0x080B299C, as measured at `51ea4ee` with the two of Q6); tmc passes only when its differences are exactly those
records, printed as `KNOWN LIMITATION` every run. A known function whose record changed or that is gone
from a view fails; any other differing function or claim run fails wherever it lies, inside a known
extent included; a recorded difference that no longer differs, and a record whose ROM is not a tuning
dataset, fail as stale; every other ROM must have no difference. Each failure message gives the counts
and the first four records of each list. The record is bound to tmc's ROM SHA-1 and ELF SHA-256 as the
answer was given on (`test/gates/dataset-binding.ts` `TMC_AT_D61`, D61 f): for another build of that name
it is stale and fails, and tmc is judged as without it. A ninth differing function fails.

**Limits** (`core/analysis/limits.ts`). Reaching `settleRounds` (600) keeps the last reading and raises
`W_SETTLE_LIMIT`, as the PoC's capped loop does; reaching `fixpointRounds` raises `W_FIXPOINT_LIMIT` and
returns what was accepted; grow judges at most `candidateBudget` (262,144) distinct harvest targets
in a whole run, so past it a fresh target is never judged (a target judged before still is) and
`W_CANDIDATE_BUDGET` is raised once; the candidate readings one epoch holds are limited to
`epochReadingBytes` (256 MiB by estimate) and raise `W_READING_BUDGET` once when dropped, together with
their 'epoch-reuse' facts. The tuning ROMs stay below both (measured on all six on 18 October 2026:
13,423 distinct targets in a run at most, pokeemerald, against 262,144; and 208,344,064 bytes held in one
epoch at most, pokeemerald, 78% of the 256 MiB, the next fe7j at 120 MB; the "about 105 MB" recorded
before was wrong, pokeemerald already held 206 MB at `22cbc77`), so they bound only a flood of pointers: its rejections and verdicts are bounded by
the budget whatever the number of grow rounds, while its time still grows with the rounds, because each
round's harvest enumerates the flood (a 32 MiB image of self-referencing Thumb pointers analyses under a
512 MiB heap). Seeds are checked before round 0: one whose entry is not an address, whose mode is
unknown or whose size does not fit the ROM is left out with `W_SEED_MALFORMED`. A path that runs over more than `zeroRun` (64) consecutive all-zero instructions
stops with a 'zero-run' error, and a walk that records `walkInsns` (65,536) instructions stops with a
'walk-limit' error and raises `W_WALK_LIMIT`, which bounds the memory a candidate's reading holds
(D42, D59). `RomliftInvariantError` (exit 70) is reserved for broken internal invariants, such
as a claim overlap or a tiling gap, never for the shape of a ROM.

### 4.3 Profile

The profile is the seam for compiler knowledge (D12). Its type lives in `core/profile/types.ts`, below
the analysis, so the model and the layout can read alignment from it without importing analysis code:

```ts
export type ProfileId = string;                       // registry key; 'agbcc' ships
export interface Pipeline {
  readonly seed: readonly RuleId[];                   // round 0, in order
  readonly harvest: readonly RuleId[];                // per grow round, in order, from one snapshot
  readonly queue: readonly RuleId[];                  // at accept: callees, veneers, adr targets
  readonly walk: readonly RuleId[];                   // first answer wins
  readonly bl: readonly RuleId[];                     // first answer wins
  readonly validity: readonly RuleId[];               // first failure is the rejection
  readonly accept: readonly RuleId[];                 // first that holds
  readonly claim: readonly RuleId[];
  readonly gap: { readonly absorb: RuleId; readonly head: RuleId;
                  readonly forward: { readonly thumb: RuleId; readonly arm: RuleId; readonly after: readonly RuleId[] };
                  readonly prefer: RuleId; readonly skip: RuleId; readonly endAnchor: RuleId; readonly backward: RuleId };
  readonly region: readonly RuleId[];
  readonly passes: readonly ('patient' | 'impatient')[];   // each runs grow + fillGaps until stable
}
export interface CompilerProfile {
  readonly id: ProfileId;
  readonly pipeline: Pipeline;
  readonly farJump: { readonly minDistance: number; readonly requiresPushedLr: boolean };
  readonly tableJump: { readonly maxBaseDistance: number; readonly maxEntries: number;
                        readonly maxTargetSpan: number; readonly lookBehindInsns?: number };  // deleted at M3
  readonly density: { readonly minHoles: number; readonly holeShift: number };
  readonly pointerTableRun: number;
  readonly tinyFunctionInsns: number;
  readonly gapScan: { readonly backwardWindow: number; readonly fillSlack: number;
                      readonly armFrontPoolWords: number; readonly armMinInsnsForSkip: number;
                      readonly prologueDistance: number };
  readonly ramCopy: { readonly argInsns: number; readonly jumpInsns: number };  // seed.ram-copy (D60 e): 12 and 8,
                    // from the tuning set's distribution with a margin; a copy fits IWRAM (the memory map)
  readonly alignment: { readonly thumbFunction: number; readonly armFunction: number; readonly cFunction: number;
                        readonly pool: number; readonly object: number };
  // misfitThreshold returns with the first raiser of W_PROFILE_MISFIT (D59)
  readonly idioms: {
    isPrologue(rom: Rom, a: Addr, mode: Mode): boolean;
    isPadding(rom: Rom, a: Addr): boolean;            // zero, or a byte of 0x46C0 (D59: `next` dropped, unread)
    matchTableJump(insns: readonly Insn[], cursor: number, rom: Rom): JumpTableMatch | undefined;
    matchFarJump(site: BlSite, caller: ReadingSummary): boolean;
  };
}
// core/profile/registry.ts
export const PROFILES: Readonly<Record<ProfileId, CompilerProfile>>;   // { agbcc }
export function profileById(id: ProfileId): CompilerProfile | undefined;
```

`agbcc.ts` holds the PoC's numbers (`minDistance` 1536, `maxBaseDistance` 0x400, `maxEntries` 2048,
`maxTargetSpan` 0x10000, `minHoles` 8, `holeShift` 4, `pointerTableRun` 3, `tinyFunctionInsns` 3,
`backwardWindow` 4096, `fillSlack` 3, `armFrontPoolWords` 16, and so on) and the PoC's slot orders.
Rules read the profile only through `v.profile`; the architecture test forbids a rule file to import
`agbcc.ts` or `registry.ts`. `g2.second-profile` builds a dummy profile in `test/helpers/` with different
numbers and a reordered `validity` slot, and requires it to typecheck and run on every fixture.

### 4.4 Determinism

- Output collections are sorted arrays with numeric comparators. A `Map` or `Set` only indexes; the
  architecture test enforces that iteration goes through `sortedKeys`/`sortedEntries` (§2).
- The worklist key is total (D10): `'ascending'` pops the minimum of `(addr, modeRank, ruleRank, seq)`,
  where `modeRank` is 0 for Thumb and 1 for ARM, `ruleRank` is the proposing rule's index in its
  pipeline slot, and `seq` is the proposal counter. `'poc-lifo'`, which reproduced the PoC's
  `work.pop()`, was deleted by the phase-2 integration (D59).
- No clock, environment, locale, `os` or path value reaches core. Text is LF only, paths are POSIX, and
  numbers print through `foundation/util/hex.ts`. Generated files never contain the project's absolute
  path.
- Names are scoped (§6.2) and the tree check `E_PATH_CASE_COLLISION` rejects two paths that differ only
  by case, so APFS and ext4 write the same tree.
- `g2.determinism` and `g3.tree-determinism` run the analysis or the emission twice in two processes,
  the second with a different working directory and project path, `TZ=Pacific/Kiritimati` and
  `LANG=tr_TR.UTF-8`, and compare the sha256 of the canonical outputs; CI compares the digests across
  Linux and macOS and across Node 22.18 and 24 (D30).

### 4.5 Port strategy and milestones

Phase 2 ports the rules' semantics first (D10, D11). The PoC is never copied into the repository, and
its checkout is never modified.

**Pinning the PoC.** The PoC has no commits, so `bench/baseline/poc-source.json` records the sha256 of
every file under its `src/`, `signatures/`, `bench/dataset/` and its `package-lock.json`, plus one digest
over the sorted list. `bench/tools/export-poc.ts` refuses to run when the checkout differs (D50).

**What export-poc writes** (all to the gitignored `bench/.local/poc/<rom>/`, run with the PoC's own
`tsx`):

- `scored.json` (phase 1): the bench's `ScoredRun` (entries, modes, extents, origins, miss diagnoses,
  code end), the PoC's scaffold built with `make` and its SHA-1 verdict, and a second run's digest for
  determinism;
- `parity.json` (phase 2): the parity view, the canonical JSON of the fields both implementations produce:
  per function the entry, mode, extent, code end, code spans, pools, tables, far jumps, never-returning
  sites and origin; the claim runs; the startup region; the code end. Its sha256 per ROM is committed in
  `bench/baseline/poc-digests.json`;
- `queries.ndjson` (phase 2): the lockstep log. export-poc wraps, at run time and without editing a PoC
  file, the methods `whyInvalid`, `valid`, `settle`, `acceptable`, `inPointerTable`, `thumbCandidate`,
  `armAhead`, `holeHead`, `tryTiledHole`, `absorbBlock` and `pointerCandidates` of the PoC's `Analyzer`
  prototype, and records each call's sequence number, arguments and result.

**Lockstep** (historical: `bench/src/lockstep.ts` and the driver's oracle were deleted in the fix round of
phase 2, D59; `test/local/poc-lockstep.test.ts` checks the committed summary). Because the driver called
the rule slots at the PoC's call sites, the k-th query of our run corresponded to the k-th query of the
PoC's. With `tuning.oracle` set, a rule family that was not implemented yet was answered from the log,
and an implemented family was compared with it; the first divergence was reported with its sequence
number, the query, both answers and the epoch. So each component proved its own family on all five
tuning ROMs before integration, with the other families answered by the PoC (D48); milestone M1 recorded
the result in `results.json` (`romlift-bench/parity-evidence@1`). The log (`export-poc --mode queries`)
is still written and re-read through its validating reader; nothing replays it.

**Milestones**, in order, on the phase branch after the components merge:

1. **M1 Parity.** `worklist: 'poc-lifo'`, `cache: 'epoch'`, no oracle: the parity view of each tuning
   ROM hashes to the committed PoC digest, and `bench run` reproduces `bench/baseline/poc-2026-10-16.json`
   row for row (`g2.poc-parity`).
2. **M2 Performance, profile-driven** (D13). `bench run --cpu-prof <rom>` writes the top self-time
   functions. Step (a): compute `codeEnd`, `end` and the extent once per immutable reading. The review
   measured the PoC with `node --cpu-prof`: on sa3, `looksLikePointerTable` takes 17.35 s of 18.6 s
   because its loop condition re-runs the `codeEnd` getter, which iterates every instruction, on each
   pass; FE7J (10.6 s) and Emerald (6.0 s) spend 59.5% and 39.6% there. Step (a) keeps the digests.
   Step (b): re-measure with `bench speed`. Step (c), only if a ROM still misses the budget: `epoch-reuse`,
   with digest equality.
3. **M3 Table jumps by register tracking** (D12). `walk.table-by-register` follows the register that
   reaches `mov pc`/`add pc` back through moves and adds to its pool load, as the plan's rule says, and
   replaces `walk.table-nearest-pool-load`; `tableJump.lookBehindInsns` is deleted. One commit, with
   its bench diff.
4. **M4 Order switch.** `worklist: 'ascending'` becomes the default, and the property test that permutes
   seed and TOML order is enabled. One commit, with its bench diff.
5. **M5 Debt.** The six unreviewed rows are classified (§8.3) and the startup exclusion is applied to
   every dataset (§8.4).
6. **M6 Confirm equals discover** (§4.2).
7. **M7 Held-out runs**, sealed (§8.4).

**What a row change may be** (D10). M3, M4 and every later rule change must pass `bench regression
--base <the previous milestone's commit>` with no exemption. `bench/baseline/accepted-diffs.json` may
record only improvements against the PoC baseline: a row removed from the misses or the false entries,
or an extent that now agrees, each with the commit and a reason. A regression is fixed in the rules,
never accepted as a diff. A listed improvement that no longer differs from the PoC baseline fails as
stale. From then on `g2.baseline-rows` holds: the bench rows equal the baseline except the improvements
listed in `accepted-diffs.json`. One ROM is a benchmark row instead (`test/gates/baseline-rows-verdict.ts`
`BENCHMARK_ROWS`): tmc, revealed after the baseline was pinned, by the owner's answer to Q1 and Q2 of
phase-2.md (D61 d), "Keep tmc as 99.94%. It's a benchmark row that we can improve later". Its reference is
the pinned PoC's own run of it; a row that differs from that run and is not a listed improvement passes only
when the dataset lists it with a category (a `labels` or `untyped` row), and is printed; an extent change, an
unlisted or uncategorised row and a stale accepted diff still fail; and its tp 8,631 of 8,636 (recall
99.94%) is a floor. The five original ROMs are judged exactly as above.

The three tmc scopings (`BENCHMARK_ROWS` here, `SCOPED_OUT` of `g2.poc-parity` below, `KNOWN_DIFFERENCES` of
§4.2) are one mechanism (D61 f, `test/gates/dataset-binding.ts`): each holds tmc by name, ROM SHA-1 and ELF
SHA-256 as the owner's answers were given on (`TMC_AT_D61`, pinned to `bench/dataset/real/tmc.json` by
`test/unit/gates/dataset-binding.test.ts`), as `g2.held-out`'s waiver holds the sealed pair. A dataset of
that name with another ROM or ELF ends the scoping, which fails as stale, and tmc is judged as without it;
a record whose ROM is not a tuning dataset fails as stale too, and so does a benchmark row whose ROM's PoC
reference is not the pinned PoC's own run of it (`staleBenchmarkRows`).

`'poc-lifo'` was deleted by the phase-2 integration and the oracle in its fix round (D59); `g2.poc-parity`
checks the committed evidence (the digests and the lockstep summary in `results.json`, tied to the commit
it names) and becomes `historical` when phase 2 lands. It is never re-run. One check
(`test/gates/poc-parity-check.ts` `parityCheck`) decides it before and after landing: once historical the
harness still runs the gate's `run` and records `historical` only when it passes, so raising `phase.json`
cannot freeze a fail (D60, gate-honesty-r1-3, r2-1; a separate `historicalCheck` was removed in fix round 1
of D61, code-quality-r0-6). Its scope is the five ROMs of the
M1 evidence: the owner's answer to Q1 of phase-2.md (D61 c), "Keep tmc as 99.94%. It's a benchmark row that
we can improve later", scopes tmc out (its M1 evidence cannot exist: the lockstep ran under `poc-lifo`
before tmc was revealed), and the gate prints "tmc: not applicable, no M1 lockstep run".

## 5. The printer

**One table** (`foundation/isa/thumb-table.ts`, `arm-table.ts`) drives decoding, encoding, text and
the analysis flow classes. A row:

```ts
row('thumb.ldr_pc', { mask: 0xF800, match: 0x4800, size: 2,
  fields: [reg('rd', 8), imm('imm8', 0, 8, 4)],
  syntax: 'ldr {rd}, {pool}', flow: 'pc-load', asPriority: 0 })
```

- `decode(mode, word, addr)` uses a 65,536-entry `Uint16Array` from Thumb halfword to row index (built
  at module load, about 2 ms); `bl` pairs combine two halfwords; ARM decodes through buckets keyed on
  bits 27..20 and 7..4.
- `encode(spec, fields)` packs fields back.
- `format(insn, resolver)` fills the template in GNU `as` unified syntax. Every address operand goes
  through `SymbolResolver.labelFor`, so the printer never invents names.
- `parse(text, mode, addr, resolver)` reads exactly the grammar `format` writes, back to a spec
  candidate list and fields.
- `assemble(parsed, addr)` picks the encoding GNU `as` picks for that text at that address, by
  `asPriority` and the row's constraints (ARM immediate rotation, `add` against `adds`, hi-register
  forms, `Align(PC, 4)` for PC-relative Thumb forms).
- `roundTrips(insn, resolver) = assemble(parse(format(insn)), insn.addr) === insn.word`.

**The assembler dialect** (`foundation/asm/dialect.ts`) is the one definition of the text every
generated unit file (`rom_header.s`, `crt0.s`, `<module>.s`, `data/<module>.s`) starts with
(`.syntax unified`, the `include/macros.inc` include, `.thumb`/`.arm`) and of `macros.inc` itself; a chunk
file a unit includes starts with `.thumb` or `.arm` alone, because `as` refuses `macros.inc` twice (D63). The corpus, the writers, the `macros.inc` template and the text-layout
check (§6.4) all take it from there, so the corpus tests the dialect the writers emit (D49).

**Printing rule** (D14): an instruction is printed as a mnemonic only when `roundTrips` holds in
process. Otherwise it is a `raw-insn` item printed `.inst.n 0xXXXX @ <decoding>` (Thumb) or
`.inst 0xXXXXXXXX @ <decoding>` (ARM), and its reason is counted for the printer and readability
families. In-process round-tripping proves the text matches our model of `as`; the corpus proves our
model of `as` matches the real one.

**Round-trip corpus** (`test/corpus/generate.ts`, workflow `printer.yml`). Every corpus file opens with
the dialect preamble. For each case, labels are defined at the computed targets in the same file:

- all 65,536 Thumb halfwords, each PC-relative or branch form at both a 0-mod-4 and a 2-mod-4 address;
- `b`, `bcc`, Thumb `ldr rd, [pc, #imm]` and `add rd, pc, #imm` at the offset extremes (minimum,
  maximum, and maximum + 1, which must fall back to raw);
- `bl` pairs: every prefix with boundary suffixes, offsets at ±4 MiB, and a seeded sample of 65,536;
- ARM: every row with each field class swept exhaustively at its boundaries, all 16 conditions per row,
  PC-relative `ldr`, `b` and `bl` at their offset extremes, plus a seeded sample of 2^20 words
  (fixed-seed xorshift in `test/helpers/prng.ts`). `results.json` lists, per row, the field classes
  covered exhaustively and the ones covered only by sampling.

The corpus is assembled with `arm-none-eabi-as` and compared byte for byte. Assertions: every printed
mnemonic assembles to its original bytes (`g1.thumb-roundtrip`, `g1.bl-sample`, `g1.arm-sample`),
`assemble` agrees with `as` on every printed text (`g1.encoder-agrees`), and every address-dependent form
agrees at both alignments and every extreme (`g1.context-corpus`). The corpus text is never committed; the
summary (round-trip share, raw count per `RawReason`, coverage classes) goes to the printer family of
`bench/results.json`. CI runs it on two binutils versions (Ubuntu apt and Homebrew). `doctor` runs the
same corpus through the user's `as`. The same check on whole writer output (a Thumb function at
2-mod-4, ARM after `bx pc`, a pool after `.align 2, 0`) runs from phase 3 as part of `g3.text-layout` and
`g3.link`.

**Printing beyond one instruction** (`core/emit/print/`):

- **Literal pools.** `ldr r0, _08001A3C @ =gFoo` with `_08001A3C: .4byte gFoo`. A value prints as a
  name only when the linker would produce the same word: a Thumb function name stands for its address
  plus one, so an odd word equal to that prints as `.4byte Func`, and an even word equal to a Thumb
  function's address stays numeric (Emerald has 125 such words). Far pools are printed where they sit,
  always in the module of the load that names them: `as` cannot assemble a PC-relative load of a symbol
  in another object, so no legal border separates the two (D63).
- **Jump tables.** One `table-entry` item per word, printed `.4byte _0800ABCD` (with `+ 1` when the
  stored value carries the Thumb bit) to a `local` label.
- **Mode switches.** `bx pc` is followed by whatever bytes are there (`.align 2, 0` when they are zero,
  or the `mov r8, r8` printed as an instruction), then `.arm`. Every chunk opens with `.thumb` or
  `.arm`, so no file depends on state from an earlier include. ARM functions open with
  `arm_func_start`; a Thumb entry at a 2-mod-4 address uses `non_word_aligned_thumb_func_start`; a
  function whose label is module-scoped (§6.2) uses the `_local` variant of its macro.
- **Branches and calls.** `b`, `bcc` and `bl` print to labels; a `bl` judged far prints as `bl` to a
  `local` label. **Every branch prints symbolically when its target is in the same module** (plan:
  "no branch or load is left as raw data"). `init` never draws a module border across a short branch,
  because `core/layout/borders.ts` makes that border illegal (§6.2). Only a border the user moves by
  hand can split one; that branch then prints raw with the target in the comment
  (`'cross-module-short-branch'`, `W_CROSS_MODULE_SHORT_BRANCH`) and is counted in the readability
  family. This exception needs the owner's approval (§12, D15). A `b` or `bl` that would name a function
  label of the other state (a `[functions]` entry listed `arm` that Thumb code calls, or the reverse) prints
  raw too (`'interworking-branch'`, `W_INTERWORKING_BRANCH`, D67 b): GNU ld would put an interworking veneer
  into the image for it, which moves every later byte and which no text-layout check sees.
- **Padding** (D16). Zero bytes up to a word boundary print as `.align 2, 0`, as the plan requires, so
  pools stay aligned when a neighbouring C function changes size.
- **Data in code.** Dead or unreached bytes inside an extent are `data` items printed as
  `.2byte`/`.4byte`/`.byte` with a comment naming their note (`@ dead`, `@ mixer hole`, `@ unreached`),
  inside the owning function's file.
- **Raw printer.** `--printer raw` keeps the PoC's all-data emission (`rawLines`, ported) as a
  bisection baseline. A raw build must always match, and `g3.raw-link` proves it on every tuning ROM
  from the first model onwards.

## 6. Emission and project model

### 6.1 Ladder

Each rung adds writers; no rung changes what an earlier writer emits, and every rung re-runs the
earlier gates.

1. **Readable assembly** (phase 3): writers `header`, `crt0`, `function`, `orphan`, `module`, `data`,
   `ldscript`, `symbols`. Every module is `asm`. Phase 3 runs on a config built in memory by
   `configFromDiscover` (§6.2), so no TOML on disk is needed yet.
2. **C stubs** (phase 4): game modules become `kind = "c"`; writers `c-stub` (scaffold ownership) and
   `modules-mk`. The first build is all `INCLUDE_ASM`.
3. **objdiff targets and matchings** (phase 6, moved from phase 5 by D92): writers `expected` and `objdiff`, the
   `matchings/`/`nonmatchings/` split from `DecompState`, the reconciler and `rename`.
4. **Code run from RAM** (phase 6): `runs_at` ranges link at their run address (§6.7).

### 6.2 Tiling, chunks, modules, borders and names

`buildModel(rom, analysis, config)` in `core/model/`:

1. **Items** (`items.ts`): instructions re-decoded from `FunctionFact.code`, pools and tables from
   claims, padding from region rules, the rest `data` (with its note) or `raw-insn`. Invariant: every ROM
   byte is in exactly one item.
2. **Chunks** (`chunks.ts`, ported from the PoC's `tile()`): one chunk per listed function. In confirm
   mode every listed entry starts a chunk, except an entry with `label = true`, which becomes an inner
   label of the chunk that contains it (a second entry, or a label a signature folded into its parent); a
   `label = true` entry that only the cartridge entry's extent covers still starts a chunk, because the header
   chunk clips that extent (D64 a).
   Bytes between functions in a code module become an `orphan` chunk named `unk_XXXXXXXX`, with its own
   file and stub line, never glued to a neighbour, with one exception: a pad, 1 to 3 zero bytes up to a
   word-aligned address with no listed entry or `[symbols]` entry inside (D68 e, D75 d). A pad before a
   word-aligned entry of a function of its module belongs to that function's chunk, whose start macro's
   `.align 2, 0` emits it: the chunk's span opens with the pad and `Chunk.entry` is the entry its label and macro
   go at. A pad at its module's end (a border or the data start follows) is the last item of the chunk before
   it, printed `.align 2, 0`, when that chunk stays assembly: any chunk of an `asm` module, an orphan of a `c`
   module. After a function of a `c` module it stays its own orphan, since gas ends a decompiled function's C
   object with a 0x46C0 nop where the ROM has zeros (D78 b; 11 on the tuning ROMs). A 0x46C0 nop pad stays an
   orphan: no start macro emits it, and the function before it does not hold it once decompiled (on the tuning
   ROMs they lie in libgcc's `_call_via_rX` and in hand-written thunks).
3. **Modules** (`modules.ts`): taken from the config. Each module carries its build compiler and flags
   (`compiler` defaults to `build.compiler`). A `start` that is not a legal border (below) is
   `E_MODULE_BORDER`, naming the nearest legal borders.
4. **Labels and names** (`labels.ts`, `names.ts`): a name comes from the TOML, else the default `sub_`,
   `unk_`, `_` or `gUnk_` plus eight upper-case hex digits; `NameSource` records which, and the TOML's
   `from` key when present. A `local` label is made only where an item can start: never at an odd code
   address, the second halfword of a `bl`, the inside of an ARM word or of a pool or table word (an ARM
   `adr r0, X + 1` before a `bx r0` into Thumb names one), so the instruction naming such an address fails
   the printing rule and prints raw (D63). A label referenced from another module has `scope: 'global'`,
   every other label `scope: 'module'`. Names are unique within a module (`E_NAME_COLLISION`). A name may repeat in
   different modules only when no other module references it, as static functions do in real decomps
   (Emerald has 117 duplicated static `FUNC` names); such labels print with the `_local` macros. Two file
   names in one directory that differ only by case (Emerald's `VBlankCB` and `VblankCB`, `InitBgs` and
   `InitBGs`) are both written as `<Name>_<ADDR>.s` (every member of a case-folded group, never only the second); the self-check `E_PATH_CASE_COLLISION` guards the
   invariant (§6.4).

**Legal borders** (`core/layout/borders.ts`). A module border is legal when it is a word-aligned chunk
start (`ld` word-aligns every object), when no short Thumb branch (`b`, `bcc`) crosses it, when no
PC-relative load or `adr` (Thumb `ldr rd, [pc, #]` and `add rd, pc, #`, ARM `ldr rd, [pc, #]` and `adr`)
crosses it, since `as` has no relocation for one that names a symbol in another object (D63), and when it
does not fall inside an assembly-only range (below). The data start is the code end rounded up to a word,
moved past every word the code loads PC-relative beyond it (D63). At or past the data start every word-aligned
address is a legal module start too, since no instruction lies there (D75 a): a `data` module the TOML starts above
the confirm run's data start (after the last listed function is deleted) keeps its start, and the bytes between
are an orphan chunk of the module before. `legalBorders(rom, analysis)` returns
them sorted, from the ROM's bytes and no compiler profile (the model has none, D63); it is exported, but no module of
`src` calls it yet: the model uses `codeLayout`'s borders with its own `isLegalStart` and data-start rule
(core/model/modules.ts), `init` gets its borders from module inference, and `analyze --update` and the TOML patcher
never check borders, so a patched config can be refused by `generate` (`E_MODULE_BORDER`; a recorded limitation,
phase-4.md; one owner of the rule is phase 6's, roadmap.md "Carried from phase 4", D77 k).

**Module inference** (`core/layout/infer-modules.ts`, D20) returns `Proposal`s of kind `module` and
follows the plan's rule:

- `rom_header` (0x08000000–0x080000C0), `crt0` (the startup region), and `data` from the derived end of
  code.
- One `asm` module per `LibraryRegion` it is given (phase 6 passes the signature regions; before that
  the list is empty), cut on legal borders.
- Every range that agbcc cannot have produced becomes an `asm`-only module: ARM code, an entry at a
  2-mod-4 address, a shared tail (a `walk.branch-into-function` exit into another function), a tiled
  hole. Adjacent such ranges merge.
- The remaining agbcc-shaped code is cut into `c` modules at legal borders, each closed at the first
  legal border past `--module-size` bytes (default `0x10000`). The default is measured: across the five
  tuning maps, 90% of C translation units have at most 0xFF70 bytes of `.text` (kleod p90 0xFF70, Emerald
  0x3D40, sa3 0x20AC, sa2 0x1840, FE7J 0x1228), so a default module never needs to be split to fit a real
  unit's typical size, and `start` stays easy to move.

`core/workflow/config-from-discover.ts` turns a discover result and the inferred modules into an in-memory
`RomliftConfig` (every found entry listed; entries inside another found extent with `label = true`, the
startup code inside the cartridge entry's included, so the confirm run reads every extent as discover did,
D64 a). It
lives in `core/workflow` because the edge table forbids `core/layout` to import `core/config` (D62 c). In
phase 3 it is what `generate`, `model` and `verify` run on, and every code module it writes is `asm`; in
phase 4 `core/workflow/init-config.ts` `initConfigOf` is the one path to init's config (D75 f): the build name, the
discover run, configFromDiscover (with the agbcc-shaped modules as `c` and `--module-size`), the serialised TOML and
that text parsed back, so `init`, `verify --rom`, `model --rom`, the bench's emission timings (`bench speed`) and its
init build (`run --scaffold`'s `scaffold.init`) run on what the TOML on disk will say. `explain --rom` and the bench's
printer trees, readability and objdiff models are the other path, `discoverModel` (the discover result under the
config configFromDiscover builds from it, neither serialised nor confirmed): `explain` explains the discover run it
traced (D35), and on a ROM where confirm and discover differ (tmc, D61 e) its item or chunk can differ from `model
--rom`'s (fix round 3, architecture-a1-11).

**Shared by writers and checks** (`core/model/resolver.ts`, `paths.ts`, D62 b). A label lies in the module
whose run range (a `runs_at` module first), else load span, contains its address; in a module it is visible
when it is global or lies there, and several labels at one address print in the order func, table, pool,
local, data, then name. `chunkPaths` names every function and orphan file, applying the case-fold rule above
to every member of a collision group; `buildUnits` lists one source and object per module in ROM order
(`asm/rom_header.s`, `asm/crt0.s`, `asm/<module>.s`, `data/<module>.s`).

### 6.3 Writers and the emission stream

Each writer is a `Writer` (§3.4): `emit(rom, model, cx, module)` yields one module's files of its kind
(module scope, called per generated module) or the global files (`ldscript.txt`, `symbols.ld`, called once
with `null`), with `EmitContext = { decomp: DecompState; printer?: Printer }` (D62 d). Everything else a writer needs (build name, module compiler and
flags, library, labels) is on the `Model`, so a writer has one source of names and modules.
`DecompState` is derived by the workflow from the C texts the shell passes in, with the reconciler's
tokenizer, and it decides one thing: `matchings` against `nonmatchings`. `emitTree` runs the writers
module by module in ROM order, so no whole tree is ever held in memory (§9.4).

| Writer | Path | Ownership | Phase |
| --- | --- | --- | --- |
| `header` | `asm/rom_header.s` | generated | 3 |
| `crt0` | `asm/crt0.s` (the startup region, one file) | generated | 3 |
| `function` | `asm/nonmatchings/<module>/<Name>.s`; `asm/matchings/…` when `src/<module>.c` defines `Name` outside every conditional (`compiledDefinitions`, D80 b) (6, D92) | generated | 3 |
| `orphan` | `asm/nonmatchings/<module>/unk_XXXXXXXX.s` | generated | 3 |
| `module` | `asm/<module>.s` (for `asm` modules: the includes in ROM order) | generated | 3 |
| `data` | `data/<module>.s` (labels, `.incbin` slices, pointer tables as `.4byte Name`) | generated | 3 |
| `ldscript` | `ldscript.txt` | generated | 3 |
| `symbols` | `symbols.ld` (RAM and absolute symbols) | generated | 3 |
| `modules-mk` | `modules.mk` (per-module compiler, `cc1` path and flags as target-specific variables) | generated | 4 |
| `c-stub` | `src/<module>.c` (the reconciler's stub planner run on an empty file plus the template header) | scaffold at `init`, reconciled after | 4, 6 |
| `scaffold` | `Makefile`, `setup.sh`, `include/**`, `AGENTS.md`, `.github/workflows/build.yml`, `.gitignore`, `README.md`, `<name>.sha1`, `package.json`, `.gitmodules` | scaffold | 4 |
| `expected` | `expected/<module>.s` (whole module at exact offsets, §6.8) | generated | 6 (D92) |
| `objdiff` | `objdiff.json` | generated | 6 (D92) |

`romlift.toml` and `decomp.yaml` are not tree entries: `init` creates them through `shell/config`, and
only `analyze --update --write` and `rename` patch the TOML.

**The scaffold** (phase 4) is the plan's table in full:

- `package.json` pins the exact romlift version. `init` then runs `npm install --package-lock-only
  --ignore-scripts` (`shell/toolchain/npm.ts`) to write `package-lock.json`; when the registry cannot be
  reached it raises `W_LOCKFILE_DEFERRED`, and `setup.sh` writes the lock on its first run.
- `tools/agbcc` is a submodule at the commit pinned in `templates/agbcc.json`. `init` writes
  `.gitmodules`; `setup.sh` registers and checks out the submodule (or clones it outside Git).
- `setup.sh` has five duties, each a template with a golden test: (1) check the toolchain
  (`arm-none-eabi-as`, `-ld`, `-objcopy`, `make`, a host C compiler for agbcc); (2) fetch and build agbcc
  and old_agbcc when `tools/agbcc/bin/agbcc` is missing; (3) in a `git worktree` without the ROM, copy
  `baserom.gba` from the main worktree (the first entry of `git worktree list --porcelain`) and check it
  against `<name>.sha1`; (4) `npm ci`, or `npm install` when no lock exists yet; (5) `npx romlift
  generate` when `asm/` is absent, or when `romlift.toml` is not the one `modules.mk` records (its
  `ROMLIFT_TOML_SHA1`: a pull or a checkout changed it since the last `generate`; fix round 6, D82 a). `ROMLIFT_CLI`, when set, is the romlift command setup.sh runs instead of `npx
  romlift`, and duty 4 is then skipped: the way to drive an unpublished romlift (a checkout's source CLI, an installed
  tarball's bin). The gates set it; `g4.packed-e2e` runs one fixture without it, its package.json pointed at the
  packed tarball, so duties 4 and 5 run as a user's (D75 o). The scaffold's `.gitignore` ignores the generated roots
  (`/asm/`, `/data/`, `/expected/`, `/ldscript.txt`, `/symbols.ld`, `/modules.mk`, `/objdiff.json`; R4, the owner's
  answer to phase-4 Q9, D79 b), so a fresh clone or worktree has no `asm/` and duty 5 writes the tree; `g4.worktree`
  requires that none of them is committed and that the worktree's `setup.sh` ran duty 5. Since the tree is not in
  Git, a pull or a checkout that changes `romlift.toml` leaves it stale: `modules.mk` records the SHA-1 of the
  `romlift.toml` bytes it was generated from (`ROMLIFT_TOML_SHA1`, the shell's hash passed in as
  `EmitContext.configSha1`; absent outside a project), and the `Makefile` stops before any build while the file's
  SHA-1 differs (`make clean` excepted), naming `npx romlift generate`; a C object's recorded SHA-1 leaves that line
  out (D82 a). The `Makefile` includes `modules.mk` and uses the per-compiler rule of
  `templates/compilers/<id>.mk`; an explicit rule the user adds for one object takes precedence over the
  pattern rule, which is how a legacy project keeps hand-written compile steps (D47).
- **Frozen by D74.** `templates/MANIFEST.json` lists every scaffold file with its project path; templates and targets
  spell a `ScaffoldVars` value as `@@<placeholder>@@`; `<name>.sha1`, `package.json`, `.gitmodules`,
  `include/macros.inc` and `include/include_asm.h` are rendered by romlift, not from a template; the compiler
  fragments land at `mk/<id>.mk`. A C module `src/<m>.c` is preprocessed by the host C compiler (`-E -x c -nostdinc
  -undef -I include`), compiled by `tools/agbcc/bin/<compiler>` with its flags and the module's `cflags` into
  `build/src/<m>.s` and assembled to `build/src/<m>.o`; asm and data units build to `build/<m>.o`. `modules.mk` holds
  `OBJS` (every unit object in link order), `C_OBJS`, and per C object `build/src/<m>.o: CC1 := …` and
  `build/src/<m>.o: CFLAGS := …`. A generated `src/<m>.c` is `#include "include_asm.h"` and one
  `INCLUDE_ASM("asm/nonmatchings/<m>", <Name>);` per chunk file in ROM order (`foundation/asm/dialect.ts`).

### 6.4 Writing safely

A command that writes runs four steps; only the last touches files (D17, D49):

1. **Plan** (`core/workflow/*`): build the model and the emission stream.
2. **Self-check**, before any write. Four checks; any failure writes nothing and exits 3:
   - tiling (`core/verify/tiling.ts`): every byte in exactly one item;
   - re-encode (`reencode.ts`): every mnemonic `roundTrips`;
   - module size (`module-size.ts`): each module's items add up to its span;
   - **text layout** (`text-layout.ts`): every `FileEntry` the stream produces is parsed back with
     `foundation/asm/statements.ts` (labels, `.2byte`/`.4byte` with symbol plus addend, `.align`,
     `.incbin`, `.inst`/`.inst.n`, the `macros.inc` macros, `.thumb`/`.arm`, `.global`), its symbols are
     resolved from `Model.labels` and `symbols.ld`, each module is laid out from its start by
     `foundation/asm/layout.ts`, and the bytes must equal the ROM range; every `.align` must emit exactly
     its padding item's length. A mismatch is `E_SELF_CHECK_TEXT` with the file, line and address. Paths
     are checked for duplicates and case-folded collisions in the same pass (`paths.ts`,
     `E_PATH_CASE_COLLISION`). Each build unit must also start and end on a multiple of its section's
     alignment, which GNU as pads a section's end to and ld places it on (D65 a). This makes every run on
     every ROM a link-equivalent check without a toolchain; `verify --link` and the SHA-1 remain the final
     proof.

   The check pass streams the emission once and keeps only paths and digests; the write pass re-runs
   the deterministic emission. Nothing is written unless the check pass completed.
3. **Plan the writes** (`core/write-plan/plan-writes.ts`, pure). The shell snapshots the sha1 of every
   path under the generated roots and every tree path, the manifest (`.romlift/manifest.json`,
   gitignored) and the text of each reconciled file, and calls `planWrites`, which owns every policy:
   - **generated**: `write` only when the content differs (so `make` stays incremental), `keep`
     otherwise; a path in the manifest and absent from the tree is `delete`d. A path absent from the
     manifest that exists on disk with different content is overwritten only under the generated roots
     (`asm/`, `data/`, `expected/`, `ldscript.txt`, `symbols.ld`, `modules.mk`, `objdiff.json`), which
     `AGENTS.md` and `.gitignore` declare tool-owned; elsewhere it is `E_PATH_NOT_OWNED`. Without a
     manifest nothing is deleted and an unknown file under a generated root is `W_UNOWNED_FILE`. Files of
     a `generated = false` module are never written and never deleted (`WritePlanInputs.retained`, D62 d).
     A tree path that only the case separates from a path the manifest or the journal lists (a module or
     function renamed by case) is one file on a case-insensitive file system: it is always `write`n, and the
     old spelling's `delete` comes before every other op, so it cannot remove the new file (D65 b).
   - **scaffold**: `write` only when absent; `scaffold --diff` shows template drift. An executable entry
     (setup.sh) is written with its mode on the temporary file before the rename, and one whose file lacks the
     executable bits gets a `mode` op, journalled like the others (D75 e).
   - **reconciled**: `edit` only if the file's sha1 still equals `baseSha1`, else `E_STALE_EDIT`. The rule is one
     function, `staleEdit` (`core/write-plan/plan-writes.ts`), which step 4 asks again (D81 b).
4. **Apply** (`shell/project/apply-writes.ts`), mechanically, deciding nothing itself:
   - take `.romlift/lock` with `O_EXCL` (it holds the pid and host); a second run fails with
     `E_PROJECT_LOCKED`; a lock whose pid is gone on the same host is taken over with `W_STALE_LOCK`;
   - write `.romlift/journal.json` (`core/write-plan/journal.ts` defines it: every op with its path,
     `baseSha1` and result sha1) before the first op;
   - hash an `edit`'s file again right before its write and pass its state to core's `staleEdit` (its sha1, or
     absent: a closed union, D82 d; read through the disk snapshot's own `digestOf`, so ENOENT and ENOTDIR are
     absent in both, D83 d): a save or a removal that landed since the plan stops the run with `E_STALE_EDIT`, the
     journal left (D80 b, D81 b);
   - apply each op through a temporary file and a rename; the journal, the manifest, edits, scaffold files
     and C stubs are flushed (`fsync`) before their rename, generated files are not, and a generated file whose
     path does not exist yet is created in place with `O_EXCL`: the next run's snapshot rewrites any generated
     file a crash left short (D64 d, accepted by the owner's answer to Q3 of phase-3.md, D68 c);
   - apply the write of `modules.mk` after every other op (the plan orders it last, D83 d): it records
     `romlift.toml`'s SHA-1, the stamp the scaffold's `Makefile` and `setup.sh` take for "the tree is current", so a
     run that stops part-way leaves the old stamp and `make` still asks for `romlift generate`;
   - write the new manifest last, through a temporary file and a rename, then delete the journal.

   A run that finds a journal first finishes the interrupted one: generated paths listed in the journal
   count as owned; an `edit` whose file already has its result sha1 is done, one whose file still has its
   base sha1 is re-applied, any other is `E_STALE_EDIT`. A unit test injects a failure after the k-th op
   for every k and checks that the next run converges to the same tree and manifest.

`--dry-run --json` prints the ops instead of step 4; `--out <dir>` applies them to another directory,
which is how the bench compares trees without touching a project.

### 6.5 `romlift.toml` (schema 1) and `decomp.yaml`

An illustrative file (the addresses show the syntax, not a recommended Klonoa layout):

```toml
schema = 1

[rom]
path = "baserom.gba"
sha1 = "a0a298d9dba1ba15d04a42fc2eb35893d1a9569b"

[build]
name = "klonoa-eod"
compiler = "agbcc"            # the default build compiler of every module

[signatures]                  # read by init and analyze --update only (phase 6)
enabled = true

[[modules]]                   # link order; start addresses increase; each start is a legal border
name = "crt0"
start = 0x080000C0
kind = "asm"

[[modules]]
name = "main"
start = 0x0800043C
kind = "c"

[[modules]]
name = "eeprom"
start = 0x0804E800
kind = "c"
data_start = 0x0804EF00       # its C data range (§6.6, phase 6)
compiler = "old_agbcc"        # per-module build compiler and extra flags (D47)
cflags = ["-O1"]

[[modules]]
name = "m4a"
start = 0x0804F000
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]                   # a runs_at range is its own module (§6.7)
name = "m4a_ram"
start = 0x0804F318
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]
name = "m4a_2"
start = 0x0804F718
kind = "asm"
library = "m4a"
version = "2001"

[[modules]]
name = "data"
start = 0x08051BD4
kind = "data"

[functions]                   # every entry is listed; keys are 0x plus eight upper-case hex digits
0x08000470 = "AgbMain"
0x080000FC = { name = "IntrMain", mode = "arm" }
0x0804F318 = { name = "SoundMainRAM", size = 0x3A4, from = "sig:m4a@2001" }
0x0804F73E = { name = "_0804F73E", label = true }               # a second entry inside its parent

[symbols]                     # data and RAM
0x03005220 = "gUnk_03005220"
0x03002920 = { name = "gEntityInfo", aliases = ["gUnk_03002920"] }
0x08189E84 = { name = "gSpriteDataTable", size = 0x40, type = "pointers" }

[[overrides]]                 # facts analysis cannot infer, written by hand; each is validated
start = 0x0804F318
size = 0x400
kind = "code"
runs_at = 0x03000388
```

- `core/config/keys.ts` rejects any address key that is not `0x` plus eight upper-case hex digits
  (`E_TOML_KEY_SPELLING`), any address listed twice (`E_DUPLICATE_ADDRESS`), and, once the schema has given each
  entry its mode, a `[functions]` key that is no instruction address of its mode, odd for Thumb or not word-aligned
  for ARM, such as a Thumb pointer value pasted as the entry (`E_FUNCTION_MISALIGNED`, naming the key and its line;
  D81 c, raised by the config since D82 d, so every command that loads `romlift.toml` refuses it before any analysis,
  through the predicate `insnAligned` of `foundation/rom/span.ts`, which the assembler layout reads too; the
  analysis keeps its own bit tests, D83 e).
- `[[overrides]]` with `runs_at` place a RAM-run range (§6.7). Until phase 6 applies the others to the analysis, an
  override without `runs_at` changes nothing but the extent of a listed entry the analysis did not find (a `code`
  override holding it, which `placeEntries` records on that entry); every other one is `W_OVERRIDE_IGNORED`, a
  warning derived from what `placeEntries` reports it used (the applied override itself, matched to one entry of its
  kind, span and mode, so a data override or a second code override on the same span is still ignored, D83 e), not
  from the override's kind, and not raised for a range wholly outside the ROM, which is `W_OVERRIDE_OUTSIDE_ROM`'s (a
  known limitation of phase 4; D81 c, D82 d).
- `data_start` (phase 6, D92) on a `[[modules]]` entry starts the module's C data range: the bytes from it to the
  module's end are what its C object's `.rodata` and `.data` replace (§6.6). The config reads it as a syntax only
  (an address); whether it is legal for its module is the model's question.
- `from` records where a proposed entry came from, as a `sourceKey`: `sig:<library>@<version>`, the only persisted
  source since the evidence importers and legacy import were dropped (D91, D92). It is data, not a comment: `explain` reads it, and `rename` removes it
  because the name is then the user's (D9). An entry without `from` was written by the analysis or by
  hand.
- `serialize.ts` writes the canonical layout `init` produces. `patch.ts` is the only `planPatch(text,
  config, proposals)`: it plans line-level edits of single-line entries against that layout, keeps
  comments, re-parses the result and compares it with the intended config; if a table was restructured by
  hand it returns `E_TOML_PATCH_REFUSED` with the entries to paste instead of guessing (D23). From phase 6 it also
  inserts a new `[[modules]]` block in canonical lines (before the next module's block and its comment lines, or after
  the last one), which the borders of a `runs_at` range need; changing, moving or dropping a listed module is still
  refused (D23, revision of phase 6).
- There is no `[analysis]` table: rules cannot be disabled per project (D22).
- `decomp.yaml` carries `tools.romlift: { config: romlift.toml }` (a strict object) and `tools.asmlift`,
  rendered by `core/config/decomp-yaml.ts` and validated through `@match-kit/decomp-yaml` before `init`
  writes it; `shell/project/locate.ts` finds it from any directory, a worktree included. `config` is always
  `romlift.toml` (`readDecompYaml` refuses any other value with `E_DECOMP_YAML_INVALID`, D83 b), as the ROM is always
  `baserom.gba` (D74 c): the scaffold's `Makefile` and `setup.sh` hash the file by that name against `modules.mk`'s
  stamp (D82 a). `loadConfig` returns the SHA-1 of the exact bytes it decoded (`ProjectConfig.sha1`), which
  `modules.mk` records (D83 d).

### 6.6 C stubs, reconciler, rename and data in C

The reconciler's move and remove cases, `rename` and the C data ranges were phase 5's; the owner skipped phase 5 and
moved them into phase 6 (D92). Legacy import (`import-legacy`), which this section also described, was dropped with
it (D51 superseded); nothing of it is built.

`core/reconcile/c-tokens.ts` tokenizes C (comments, strings, character literals, preprocessor lines,
identifiers, punctuation); no regex ever runs over code. `c-scan.ts` splits a file into file-scope items (the
scanner, `compiledDefinitions` and include resolution, split out of the planner, architecture-b2-9), and
`include-asm.ts` finds
`INCLUDE_ASM("asm/nonmatchings/<m>", Name);` statements and top-level function definitions
(`ident ( … ) {` at brace depth 0) and returns `TextEdit[]`: add a missing stub at its ROM-order
position, remove a stub whose function left the TOML, move a stub whose module changed; `W_C_ORDER` when
C order differs from ROM order. The `c-stub` writer calls the same planner on an empty file plus the
template header (the `core/emit` → `core/reconcile` edge); `generate` runs it over every existing `src/<module>.c`
and writes its edits as a `reconciled` entry (`core/workflow/c-stubs.ts`, from phase 4: add and remove, a move being
both, D75 b), so a legal TOML edit of a `c` module leaves a project `make` builds. Each wanted chunk is a pair, its
symbol and its stub name (the chunk file's base name, `<Name>_<ADDR>` for a case-folded group member): a definition
holds its chunk by symbol, a stub by stub name (D78 a). The planner never edits anything inside an
`#if`/`#ifdef`/`#ifndef` … `#endif` region and never inserts a stub there (it anchors on the region's outer edge); a
stub inside one holds its chunk, a definition inside one does not. It skips a leading byte order mark, and refuses
what an edit cannot fix, so `generate` writes nothing (D77 a to c, D78 a, D80 a, D81 a): `E_C_UNSCANNABLE` (a file
the scanner cannot split that needs an edit; the scanner reads a conditional as the preprocessor would, each branch
from the state its `#if` found and the first branch's state after the `#endif`, so a branch inside a body may open a
block the other does not, and a file is unscannable when the branches of a file-scope conditional end with other
depths, another open definition or another unfinished head than each other, a branch inside a body closes it, a
definition never closes, or a block at file scope follows a head that names no function, such as a K&R definition;
the definition's name is the identifier before its parameter list, past `(*` declarator groups and GCC attribute and
asm groups; such a file that needs no edit, by the stubs its tokens spell at any depth and the definitions read, is
`W_C_UNSCANNABLE`, a warning, so a committed project that builds also builds from a clone, D81 a), `E_C_STUB_UNPLACED` (no safe place: the text ends inside a comment, a literal, a directive
or an unclosed `#if`, or the stub would go between two chunks one `#if` region holds; or the file `#include`s at file
scope a file romlift does not read whose quoted path does not end in `.h`, which may define the function, D82 b),
`E_C_CONDITIONAL_STUB` (an unwanted stub inside
a conditional region, never removed), `E_C_STALE_DEFINITION` (a definition of a function of the tree romlift last
generated, read from the chunk files on disk, that no module has now: the C of a function the TOML renamed or
deleted, wherever it lies; or a definition where the stub goes of a chunk whose file that tree held in the module's
own directory and that the file neither includes nor defines any more: a function renamed in C only, D80 a; without
chunk files on disk, the first `generate` of a fresh clone or worktree since `asm/` is gitignored (D79 b), a
definition the module no longer has where a missing stub
goes) and `E_C_DEFINITION_MOVED` (a definition of a function the TOML now gives another module, read in every
`src/*.c`, a file of no module included, so a merged module's decompiled C never leaves the build unseen; for an
`asm` or `data` module, the advice is to delete the C or make that module `c`); `W_C_FILE_UNUSED` warns of a
`src/*.c` that is the source of no module. A stub of another `asm/nonmatchings/<m>` directory whose file the new
tree does not write (outside a `generated = false` module's directory) is unwanted like one of the module's own: a
renamed `c` module whose source the user moved keeps no stub of the old directory (D81 a). "What the C defines" is one
predicate, `compiledDefinitions` (a named definition not wholly inside one conditional, or in every branch of one
that has an `#else`, as pret's `#ifdef NONMATCHING <C> #else NAKED <asm> #endif`, the first branch's counted; with
the scanner's verdict: `scannable: false` and why for a file it cannot split, whose definitions are then only what it
read), which the planner (`heldOf`, and for a file it cannot split its check that no edit is needed; the planner tests
the verdict itself, editing nothing in such a file), the C files of no module, the fragments a module's file includes
and the project's `DecompState` read (D80 b, D81 a, D82 b). A `src/*.c` that a module's source `#include`s at file scope
(resolved from `src/`) is part of that module: its definitions hold their chunks at the `#include` line, a function of
another module in it is `E_C_DEFINITION_MOVED` naming it, and it is no `W_C_FILE_UNUSED` (D82 b). A file that gains a
stub and holds no `INCLUDE_ASM` statement, and gets the macro neither from its own lines nor from a header it
includes (D86 a, D87 a), gains `#include "include_asm.h"`
(`C_STUB_HEADER`) above its first line of code, so the file a user creates with only the C that `E_C_DEFINITION_MOVED`
(which names the module's source path) sent there builds (D82 b). Every insertion takes the file's line terminator
(D82 b). Since fix round 7 the fragment's `INCLUDE_ASM` statements, and what the `src/*.c` files it includes in turn
hold, count too, at the module file's `#include` line (`IncludeAsmStatement.via`), so `generate` never inserts a stub
a fragment already holds; romlift never edits a fragment, so a stub in one that would go (unwanted, or naming a file
the tree no longer writes) is `E_C_FRAGMENT_STUB` naming it, an insertion whose ROM-order place lies between two
chunks one `#include` holds is `E_C_STUB_UNPLACED` naming the fragment, and a fragment the scanner cannot split is
`W_C_UNSCANNABLE` naming it, `E_C_UNSCANNABLE` when the module's file needs an edit (D83 a). Since fix round 8
(D84 a to d): an include of another module's source, from the module's file or a fragment, is `E_C_MODULE_INCLUDED`,
an error whether or not the file needs an edit, since make compiles that source on its own and would build its
functions twice (a fragment made a module by a split named after it), even under `#if 0` (D85 b); a file whose every
stub the plan replaces (such a fragment, whose stubs the including file's header served, or a renamed module's source
moved with `git mv`) gains the header with its new stubs unless the macro reaches it some other way: since fix round 10
(D86 a) the planner follows the file's includes (`IncludeAsmWanted.headers`, which the shell reads with
`readHeaderTexts`: every file under `include/` and, since fix round 11, every `.h` under `src/`; since fix round 12, D88 a, through a
symbolic link to a directory, a cycle ending at a directory the walk is already inside or at the project directory;
not exactly as cpp follows links, D89 a: a `..` in an include behind a linked directory is resolved against the link's
path, not its target; a link whose target is the project directory, or a directory the walk is already inside (one of
the link's own parent directories), is not entered; a link to a directory above the project is entered, all of it but
the project directory below it, and every file there is read, D90 a), and since fix round 11
(D87 a, b) those of the `src/*.c` fragments it includes too, resolved as the scaffold's `cpp -nostdinc -I include`
does (`#include "…"` from the including file's own directory first, then `include/`; `#include <…>` from `include/`
alone), transitively and each file once, and adds nothing when the file, a fragment or one of those headers
`#define`s `INCLUDE_ASM` or includes `include_asm.h`; an `#if` around an `#include`, an `#include` spelled with a
macro and an include directory added to `CPPFLAGS` are not evaluated, nor are those two link layouts resolved as cpp
resolves them (the scaffold's `AGENTS.md` names the remedy, deleting the added line). Which `#include` the file has decides nothing by itself (D85 a: a `global.h` of types alone still
brings the header); the generated header's guard does not cover a `global.h` that defines the macro and includes
`macros.inc` itself, whose second inclusion the assembler refuses (`Macro … was already defined`); a message about a nested fragment names the include chain from the
file that includes it directly to the module's file (`CDefinition.chain`, `IncludeAsmStatement.chain`, `CIncludeLink`);
`W_C_ORDER` compares a fragment's chunks by their place in it (`order`) and names the fragment, or both files when the
two chunks lie in different files of the chain (D85 c); a fragment the scanner cannot split is `E_C_UNSCANNABLE`
whenever the module's file needs an edit, planned or refused. Only a `src/*.c` directly under `src/` is read
(`readCTexts`), so an include of `src/inner/x.c` is an unread file. Fix round 4's rescan of the planned text for an insertion out of ROM order is gone: no layout reached it
(D82 c). An `edit` is written only
while its file still has its planned sha1, checked again right before the write (`E_STALE_EDIT`, D80 b, D81 b). `generate --out <dir>` writes the C files as generated files of that tree,
so a second run into it rewrites them (D77 d). `rename-tokens.ts` renames identifier tokens
only, never comments or strings.

**Data defined in C fails loudly outside a data range** (D21, D92). The phase-4 `ldscript` places only `.text` from
`src/*.o`, collects every other section of each C object into a `NOLOAD` check section, and asserts that
it is empty:

```
.c_data_<module> (NOLOAD) : { *src/<module>.o(.rodata* .data* .bss* COMMON) }
ASSERT(SIZEOF(.c_data_<module>) == 0, "src/<module>.c defines data; see AGENTS.md (romlift does not place C data yet)")
```

The leading `*` matches the object ld is given, `build/src/<module>.o` (D74 f).

`g4.c-data-fails-loud` builds a fixture whose C file defines a `const` array and expects that message.
Phase 6 replaces the assertion, for a `c` module that declares a range (`[[modules]] data_start`, §6.5), with a data
range: the module's bytes from `data_start` to its end are its C object's data, so a C array replaces its slice of the
ROM and the build still matches (`g6.c-data-ranges`, on the c-data fixture; the object is `build/src/<module>.o`). A
module without `data_start` keeps the assertion. The range's semantic checks (inside its module, word-aligned, past
its code) are the model's (p6-c-data-expected, D93); the config reads the key as syntax only.

**`rename <old> <new>`** (phase 6, D92). `core/workflow/rename.ts` (`planRename`) plans a one-line patch of the TOML entry
named `old` (the new name, its `from` removed: the name is now the user's, D9) and, with `rename-tokens.ts`, edits of
identifier tokens equal to `old` in `src/` and `include/` (never a comment, string or character literal), as
`reconciled` entries; it refuses when `new` is already a name of the project or `old` names nothing (exit 1, no file
changed, `g6.rename`). The `c` stubs then follow from `generate`.

### 6.7 Code that runs from RAM (`runs_at`)

An `[[overrides]]` entry with `runs_at`, written by hand (the gba-kit trace that would have proposed one was dropped by
the owner, D91), makes `AddressMap` non-identity for its range (D46). The analysis walks those bytes with run-space
targets; `FunctionFact.runAt`, `Chunk.runAt` and `Module.runAt` record it; labels inside it carry run
addresses. The range is its own `asm` module: `init` and `analyze --update` propose its two borders,
and a `runs_at` range whose start and end are not module borders is `E_OVERRIDE_INVALID`. The
`ldscript` writer emits the module as `.<module> <runAt> : AT(<load>) { asm/<module>.o(.text) }` and defines `__load_<module> =
LOADADDR(.<module>)`, so ROM code that copies the bytes names their source and code that calls them names
their run address. Branches inside the range assemble to the same bytes either way, and the text-layout
check lays the module out at its load address with run-space symbols. The types land as the identity in
phase 2 and the model and writers handle `runAt` from phase 3, so phase 6 only fills them;
`g6.ram-code-mapped` proves it on the RAM-copy fixture (its `expect.json`'s `ramCopy`) and on Klonoa, whose
`0x0804F318 → 0x03000388` range the bench config `bench/overrides/klonoa.json` gives as an `[[overrides]]` entry the gate
appends after `init` (D91 c): one module spans exactly the range with that `runAt`, and the build reaches the SHA-1.

### 6.8 `expected/` and `objdiff.json` (phase 6, D92)

The `expected` writer emits `expected/<module>.s` for each generated module: the whole module at its exact offsets,
every item as its own bytes (`.inst*`, `.4byte`, `.byte`, `.incbin`) with global, typed, sized function labels, so
`make expected` assembles it without agbcc into an `expected/<module>.o` with no relocation, the target objdiff
compares a decompiled function's object with. The `objdiff` writer emits `objdiff.json` (objdiff-cli 3.7.2), one unit
per `c` module with its target and base objects (`build/src/<module>.o`, D74 f) and `options.functionRelocDiffs =
"none"`, since the target carries no relocation. Both are generated files under the generated roots (§6.4).

`g6.expected-bytes` judges `expected/<module>.s` by the ROM, never by another project's own `expected/` (Klonoa's `make
expected` is best effort and marks wrong symbols in `.tainted` files): in a project `init` wrote, every `c` module has
an `expected/<module>.s`, each is assembled, and its `.text` must equal its module's ROM range byte for byte, the
symbols covering a first difference named. It runs on every fixture (ci) and every tuning ROM (real).

The design phase 5 had for migrating a legacy repository (the Klonoa switch-over pinned by commit, D52, and
`import-legacy`'s counts at `693ccb7`, D51) was dropped by the owner (D92) and is not built; the Klonoa repository is
not touched.

## 7. Library signatures

### 7.1 Format: schema 3 and specs

Frozen by the phase-6 lead (D93):

```ts
// core/signatures/schema.ts
export type MemberId = `${string}@${string}.o`;        // '_fpadd_parts@dp-bit.o': object-qualified, unique
export type SignatureRuleId = 'sig.unique-fit' | 'sig.link-order-run' | 'sig.neighbour-spacing'
  | 'sig.pinned-both-sides' | 'sig.short-member-window';   // SIGNATURE_RULE_IDS, strongest first
export interface SignatureFile {
  readonly schema: 3;
  readonly library: string;                            // 'm4a', 'libgcc', 'libagbsyscall', 'agb_flash', …
  readonly builtWith: string;                          // romlift version that built it; no comparison reads it
  readonly versions: readonly LibraryVersion[];
}
export interface SignatureReference { readonly dataset: string; readonly commit: string; readonly romSha1: string }
export interface LinkOrderMember { readonly id: MemberId; readonly addr: Addr }   // its address in that reference
export interface LibraryVersion {
  readonly id: string;                                 // earliest known release that ships these bytes
  readonly idNote: string;                             // what the id rests on
  readonly references: readonly SignatureReference[];
  readonly linkOrder: readonly { readonly reference: string; readonly members: readonly LinkOrderMember[] }[];
  readonly functions: readonly SignatureFunction[];
  readonly tables: readonly SignatureTable[];
}
export interface SignatureFunction { readonly id: MemberId; readonly name: string; readonly mode: Mode;
  readonly size: number; readonly bytes: string; readonly mask: string }   // lower-case hex, two digits per byte
export interface SignatureTable { readonly id: MemberId; readonly name: string; readonly size: number;
  readonly bytes: string; readonly mask: string;
  readonly names?: readonly (MemberId | null)[] }      // per whole aligned word: the member a pointer names
export interface SignaturePlacement {                  // what the matcher reports for one member on a ROM
  readonly library: string; readonly version: string; readonly member: MemberId; readonly name: string;
  readonly kind: 'function' | 'table'; readonly addr: Addr; readonly size: number; readonly mode?: Mode;
  readonly rule: SignatureRuleId;
  readonly constants?: readonly { readonly offset: number; readonly reference: number; readonly rom: number }[];
}
export function parseSignatureFile(json: unknown):
  { readonly ok: true; readonly value: SignatureFile } | { readonly ok: false; readonly error: string };

// core/signatures/spec.ts: committed; contains no bytes
export interface SignatureSpec {
  readonly library: string;
  readonly versions: readonly { readonly id: string; readonly idNote: string;
    readonly references: readonly { readonly dataset: string; readonly objects: readonly string[];
      readonly tables?: readonly string[] }[] }[];
  readonly reviewedNames: Readonly<Record<MemberId, { readonly name: string; readonly reason: string }>>;
}
export function parseSignatureSpec(json: unknown):
  { readonly ok: true; readonly value: SignatureSpec } | { readonly ok: false; readonly error: string };
```

Both validators are written by hand (core/signatures may not import zod), refuse unknown keys and never throw. A
reference is named by its bench dataset (revision 2 wrote a `project`), and a link-order member carries its address in
that reference, which fixes the spacing the placement rules read (D93).

The display `name` is the reviewed name when the spec has one, else the reference's symbol; the `id`
is unique across objects, which replaces the PoC's ad hoc `_dp` suffix (D31). A spec names references by
dataset; `g6.no-heldout-references` fails when a spec names a dataset whose `heldout` is true and whose
`revealed` is empty, so held-out ROMs never become signature references (D32).

**Where the files live** (D40). Built signature files contain masked bytes read from commercial ROMs, so
until the owner rules they are not committed and not published: `romlift signatures build
signatures/specs/<library>.json` writes them to `signatures/<library>.json`, which `.gitignore`
covers, and `shell/signatures/locate.ts` reads them from there or from `ROMLIFT_SIGNATURES`. When none
is found, `init` reports the shell's `W_SIGNATURES_ABSENT` and proceeds without them. Explain goldens for `sig.*`
rules come from a self-authored library fixture (§8.1) whose signature file is built from the fixture's
own ELF; no golden ever contains bytes from a real ROM.

### 7.2 Builder and matcher

- **Builder**: `shell/signatures/build-from-references.ts` reads a spec and each reference's ELF, map and
  ROM (from the bench datasets), parses them with `foundation/formats`, and calls the pure
  `core/signatures/extract.ts` (mask `bl` targets, branches leaving the function, and every aligned word
  outside instructions that looks like a RAM or ROM address; merge references by member id; apply the
  reviewed names).
- **Matcher**: `core/signatures/match.ts` takes the `Rom` and a discover-mode `AnalysisResult` and returns
  `SignaturePlacement[]`, each with its `sig.*` rule id from the signature registry
  (`core/signatures/rules/`, one file per placement rule with its `RuleMeta`, in `SIGNATURE_RULES`; exported from
  `romlift/internal` like `RULES`), strongest first:
  `sig.unique-fit` (≥ `policy.minUnmaskedBytes` = 12 and one fit), `sig.link-order-run`,
  `sig.neighbour-spacing` (spacing, adjacency, or the only fit within `policy.window` = 64 bytes, same
  reference only), `sig.pinned-both-sides` (at most `policy.maxDiffWords` = 2 differing words, reported
  as game constants, `W_SIGNATURE_CONSTANT`), `sig.short-member-window`. Pointer tables are accepted only
  when every word naming a matched function points at it. `resolve.ts` settles overlaps: per module, the
  version or library that matched more wins; ties by `library@version` in code-unit order.

### 7.3 Signatures propose; the TOML decides (D9)

`propose.ts` turns placements into `Proposal`s with source `{kind: 'signature', library, version,
rule}`; it does not know the config. `init` folds them into the config it serialises, and `analyze
--update` passes them to `planPatch`:

- every placed function becomes its `[functions]` entry with the signature's name, `from =
  "sig:<library>@<version>"` and, where the signature restores an extent the analysis split, `size`;
  entries the fold puts inside that extent become `label = true`;
- tables become `[symbols]` entries with `size`, `type` and `from`;
- `infer-modules` receives the placements' `LibraryRegion`s and proposes the library `[[modules]]`
  with `library` and `version`, cut on legal borders;
- `analyze --update --write` renames only entries that still carry a default name.

Before `init` folds them or `analyze --update` patches them, the proposals pass the screen of §7.4. `generate` never
loads signatures, so labels cannot drift from the TOML and a tool upgrade cannot rename anything. `--no-signatures` on
`init` (`InitOptions.signatures: false`) and `[signatures] enabled = false` skip the layer; with no built file found
the shell raises `W_SIGNATURES_ABSENT` and `init` proceeds without them.

### 7.4 Proposals and conflicts

The plan's evidence importers are gone: the gba-kit trace was dropped by the owner (D91) and the legacy, ELF and map
importers with phase 5 (D92), so `core/evidence`, `core/legacy`, `shell/evidence`, `mergeEvidence` and the trace fact
kinds are not built. Library signatures are the one external source of proposals left, and they can still contradict
what the analysis found or what the config says, so every one passes a screen (`core/workflow/proposals.ts`,
p6-proposals; the contract is frozen in `core/workflow/types.ts`, D93):

```ts
export interface CheckProposalsContext { readonly analysis: AnalysisResult; readonly config?: RomliftConfig }
export interface ProposalCheck { readonly kept: readonly Proposal[]; readonly conflicts: readonly Diagnostic[] }
export type CheckProposals = (proposals: readonly Proposal[], cx: CheckProposalsContext) => ProposalCheck;
```

A proposal that contradicts the discover analysis (a function at a found entry in the other mode) or the config (a
listed function in the other mode, a function under a `data` override) is dropped and reported as
`W_EVIDENCE_CONFLICT` at its address, span or cites; the kept proposals are exactly those kept without it, in their
input order. A contradiction is never resolved silently (`g6.evidence-conflict`). Like everything else, signatures
reach `generate` only through the TOML.

**Signature sets built in phase 6**: `m4a` (2001, 2004), `libagbsyscall` (the BIOS call stubs),
`libgcc`, and the serial libraries the tuning references link (`agb_flash`, `siirtc`, `librfu` from
Emerald). Each version names its references; a library with a single reference has one version from it.

## 8. Benchmark and CI

### 8.1 Tiers and fixtures

| Tier | Inputs | Truth | Runs |
| --- | --- | --- | --- |
| Synthetic | `bench/dataset/synthetic/<name>/`: one phenomenon each, built from our C and asm with agbcc, binutils and a shared tiny `crt0.s` | `expect.json` (entries, extents, code end, and for negative fixtures zero extra entries) plus the fixture's ELF | every CI run, from the committed builds (D28) |
| Real, tuning | the six pairs of benchmark-roms.md under `ROMLIFT_BENCH_ROOT` (default `..`): the PoC's five and tmc, revealed by the owner's decision (D60) | ELF `FUNC` symbols counted from the end of the startup region, minus `labels`, plus `untyped` | locally; CI checks the artifact's provenance and its gate record |
| Real, held-out | pokefirered, pokeruby (each once its build reproduces its SHA-1; tmc until its reveal, D60), and the reserve pool of benchmark-roms.md | the same ELF symbols, judged by classifiers only (§8.4) | locally, sealed |

**Fixtures.** Each directory holds the sources, `build.mk`, `expect.json` and `build/<name>.gba`,
`build/<name>.elf` (a few KiB, self-authored, committed; `.gitignore` re-includes exactly
`bench/dataset/synthetic/*/build/`). `build.mk` records the agbcc commit and the `as --version` string
it was built with.

- **Positive** (phase 2; the plan's twelve plus the unreferenced leaf of its Verification section): far jump, table jump with hoisted instructions, leaf-handler
  pointer table, never-returning call then the next function, `bx lr` stub chain, ARM with pools in
  front, `bx pc` veneer, code copied to RAM, `swi` reset, shared tail, data table between functions,
  hand-written function at a 2-mod-4 address, and an unreferenced leaf. Rules that none of them makes
  decisive get their own fixture (a local subroutine for `bl.near-is-call`, a callee that pops an
  unpushed frame, `mov lr, pc; bx rN`, an `adr`-named handler block, dead code inside an extent, a
  prologue-less Thumb reading over ARM, a mixer-style tiled hole).
- **Negative** (phase 2), each expecting zero extra entries: data that decodes as Thumb with
  push and pop, a run of Thumb pointers that decodes as code, a pool word that decodes as `push {lr}`, a
  pool padded with `0x46C0`, code-end data that decodes, a 2-byte false stub.
- **Composite** (phase 4): several objects linked into one ROM and scaffolded with `--module-size 0x200`,
  so it has several modules, a cross-module `bl`, a pool word naming a function of another module (its label
  printed global; a PC-relative load never crosses a border, D63), a short branch that `init` must not cut, and a TOML with an illegal border that must fail with
  `E_MODULE_BORDER`.
- **Multi-compiler** (phase 4): two C modules, one built with `agbcc` and one with `old_agbcc` and extra
  flags (`g4.multi-compiler`).
- **C data** (phase 4): a C file that defines a `const` array (`g4.c-data-fails-loud`), then a data range
  (phase 6, D92; `g6.c-data-ranges`, with `expect-ranges.json` and the decompiled C under `overlay/`).
- **RAM copy** (phase 2): code copied to IWRAM; from phase 6 its `expect.json` gives the range as `ramCopy`
  (`start`, `size`, `runAt`, `mode`?), which `g6.ram-code-mapped` writes as a hand-written override (D91 c).
- **Library** (phase 6): a small self-authored library linked into two fixture ROMs in different orders,
  the source of the `sig.*` explain goldens and of the signature builder's CI test.

Unit and golden tests read the committed builds and need no toolchain. `fixtures.yml` builds agbcc at
the pinned commit, rebuilds every fixture, and compares the `.gba` bytes and the sorted
`(name, value, size, type)` list of the ELF symbol table, not the raw ELF, whose metadata legitimately
differs between binutils builds; it also checks the `build.mk` toolchain record (D28).

### 8.2 Datasets and artifact

`bench/dataset/real/<rom>.json`:

```ts
interface Dataset {
  name: string; rom: string; elf: string; map?: string; sha1: string; elfCommit: string;
  elfSha256: string;                                  // `bench run` refuses an ELF with another digest
  objectsDir?: string; objectsDigest?: string;        // the reference build's objects, the objdiff targets (§8.4)
  family: string;                                     // codebase family (D55): 'kleod', 'sat-r', 'fe-gba', 'pret-gen3', 'zeldaret-tmc', …
  buildNote: string;                                  // local changes needed to rebuild it (research-notes.md)
  heldout: boolean;                                   // set when the dataset is created; never edited
  revealed: { at: string; commit: string; reason: string }[];   // append-only; non-empty ⇒ tuning
  labels: { addr: string; name: string; category: ExceptionCategory; note: string }[];   // empty while sealed
  untyped: { addr: string; category: ExceptionCategory; note: string }[];               // empty while sealed
}
```

`bench/results.json`, refreshed only by a phase lead on the phase branch after a component merges (D43):

- `meta`: `commit`, `dirty`, `sourceDigest` (§8.6), `inputs` (per ROM: ROM sha1, ELF sha256, objects
  digest; the PoC source digest), `toolchain` (agbcc commit, `as --version`, `ld --version`, objdiff-cli
  version), Node major version, `romliftVersion`, `profile`, signature digests, and `families` (per ROM,
  the metric families that ran);
- `gates`: the verdict of every real-tier gate, written by `bench gates --tier real` (§8.6);
- per tuning ROM: the summary, `analysisDigest`, `treeDigest`, every exception row (misses with reason,
  false entries with origin, extent mismatches, the code end), the ablation rows, and the printer,
  readability and objdiff summaries;
- per held-out ROM: **counts and gate verdicts only**.

Volatile values (wall and CPU times, RSS, `generatedAt`, the machine) go to `bench/timings.json`, which
is gitignored, so the artifact changes only when a result changes. The speed ratchet reads
`bench/baseline/speed.json` (§8.4). The PR diff of `results.json` is the review of a change's effect.

### 8.3 Vocabularies and the exception debt

Three closed lists. Miss reasons and origins are emitted by rules and live in
`core/provenance/vocabulary.ts`; exception categories describe how a reference ELF types its symbols, a
dataset concern, and live in `bench/src/vocabulary.ts`. A unit test fails on an id with no definition;
`g2.vocabulary-emitted` fails on a miss reason or origin that no rule emits; a bench test fails on an
exception category that no dataset row and no classifier carries. A listed row the run no longer needs
fails as `stale-exception`, so lists stay exact.

**Dataset against ELF** (`bench/src/dataset-check.ts`, `g1.dataset-elf`, a precondition of
`g2.entries`): every `labels` address must be a `FUNC` symbol inside a function the run found, and every
`untyped` address must not be a `FUNC` symbol.

Phase 2 milestone M5 retires the six `unreviewed` rows with the classification the 16 October review
made, and fixes one misnamed category (D26):

| Dataset | Row | Category |
| --- | --- | --- |
| klonoa | untyped `0x0804F73E` (second entry of the m4a `ldrb_r3_r2` helper) | `second-entry` (new) |
| fe7j | the same helper's second entry | `second-entry` |
| fe7j | three mixer-local targets | `mixer-internal` |
| fe7j | untyped `0x080889FC` (a 34-byte leaf the ELF only labels) | `untyped-leaf` (new) |
| fe7j | the six labels after `bl _call_via_r0` | `split-after-returning-call` (replaces `continuation-after-noreturn-call`, which no row then carries and which is removed) |

The implementing agent confirms each assignment with `bench explain` before the commit, and the commit
message states the reason, as the working rule requires.

### 8.4 Gates per family

| Family | Gate | Live from |
| --- | --- | --- |
| Printer | 100% round-trip; raw share never rises; both alignments and every offset extreme agree | 1 |
| Entries (tuning) | dataset-against-ELF check passes; every miss in `labels`, every false entry in `untyped`; raw precision ≥ 99.7% on every ROM; raw true-positive count never drops; lists only shrink; zero `unreviewed` | 2 |
| Extents | no agreeing function stops agreeing; ≥ 99.9% of sized functions agree | 2 |
| Code end | within 16 bytes of the ELF's code end (`bench/src/truth.ts` `elfCodeEnd`): the largest end of its functions, a sized function at addr + size and an unsized one (hand-written asm without `.size`) at the `$d` mapping symbol or typed symbol that closes its last code run before the next typed symbol (an inline pool followed by more of its code does not end it), one convention for every ROM, tuning and sealed, in every scorer, the rescoring of the PoC's own dumps included (the owner's answer to Q5, "Use $d for every ROM", D61 a). The PoC's pinned rows keep the PoC's own convention (`pocCodeEnd`, addr + size): `bench poc-check` compares the rescored row with them as the scorer measures them and checks separately that they carry the PoC's convention | 2 |
| Held-out | per sealed ROM: raw precision ≥ 99.7%, raw recall ≥ 99.46%, zero `glued` misses, label candidates ≤ 11, extents ≥ 99.9%, code end within 16 bytes; at least two sealed ROMs pass, from at least two codebase families, one of them absent from the tuning set (both family conditions waived by the owner, the fresh-family one by the decision of D60 and the two-families one by the answer to Q4, "Waive both" (D61 b), for the sealed pokefirered and pokeruby and the tuning families of D60, and for nothing else) | 2 |
| Determinism | two processes with a varied environment, identical analysis and tree digests; Linux and macOS, Node 22.18 and 24 agree | 2, 3 |
| Speed | median CPU time of the analysis, over nine serial runs, ≤ 1.5 × `bench/baseline/speed.json` per ROM (`g2.speed`; nine since the owner's answer to Q2 of phase 4, D76 b); ≤ 3 s CPU analysis per tuning ROM (the median of the first five of those runs, the five it was measured over before D76 b, D77 f), `generate` ≤ 10 s and `init` ≤ 15 s on Emerald (`g3.speed-budget`); both scaled by the calibration ratio on another machine | 2, 3 |
| Scaffold | the PoC's scaffold reproduces the SHA-1 on all five (phase-1 harness); the raw printer links to the SHA-1 on every tuning ROM and every fixture (`g3.raw-link`); the readable printer on every fixture and at least three tuning ROMs, target all six (`g3.link`, D62 h); `init`, `setup.sh`, `make` on every fixture and every tuning ROM (`g4.e2e-*`); build time recorded per ROM in `timings.json` | 1, 3, 4 |
| Readability | per-ROM shares of mnemonics, symbolic branches and symbolic pool loads only increase, computed on every tuning ROM (from phase 3); objdiff score 0 (below; `g6.objdiff`, moved to phase 5 by the owner's answer to Q1 of phase-3.md, D68 a, and into phase 6 with the `expected/` writers when he skipped phase 5, D92; phase 3 records the classified counts) | 3, 6 |
| Memory | `init` and `generate` on the deterministic 32 MiB synthetic ROM complete under the `romlift` bin's heap cap (`--max-old-space-size=1024`, the owner's answer to Q7 of phase-3.md, D72, replacing Q6's 384) with peak RSS below 1,536 MiB, the budget set again from the recorded runs under that cap with a 25% margin (`g3.large-rom`, D68 b, D72 b); the six tuning ROMs and the code-dense doubled ROM are measured under the same cap and recorded; the bin's own commands complete on the synthetic ROM under the cap (`test/local/large-rom-bin.test.ts`, D70 b; not a gate) | 3 |
| Signatures | every placement at an ELF `FUNC` or a listed untyped address; every table an `OBJECT` of that size or a label; every proposed `size` equals the ELF size (4-byte padding allowance); on a reference ROM every placed member's symbol (its `MemberId` before '@') equals that reference's own symbol, a reviewed display name being reported, not gated; the PoC's placements as a floor on its five ROMs, none on tmc; leave-one-reference-out adds or moves no placement; sealed held-out counts | 6 |

The bench always scores a **seedless discover run** (no TOML, signature or evidence seeds) and judges
signatures afterwards, so library knowledge never flatters the library-agnostic numbers (D24). Every
dataset, tuning and held-out alike, counts entries and ELF functions from the end of the startup
region, as the PoC does, because each project types its startup labels by its own convention.

**objdiff** (`g6.objdiff`, D34; `g3.objdiff` until the owner's answer to Q1 of phase-3.md moved it to phase 5, where
the `expected/` objects and objdiff targets are built, D68 a, and `g5.objdiff` until he skipped phase 5 and moved it
into phase 6 with those writers, D92: it applies there as D34 writes it unless the owner amends it, and its baseline is
phase-3.md Q1's table, the counts the committed classifier, `bench/src/objdiff-classes.ts`, sorts the differences
into: gated fe7j 200, klonoa 320, pokeemerald 13,788, sa2 1,374, sa3 564, tmc 895). The oracle is objdiff-cli at the version pinned in
`bench/tools/objdiff.version`, which is part of the source digest. For each tuning ROM whose readable
build links, the target of each unit is the reference project's own relocatable object from its build
directory (`objectsDir`, digest recorded), and the base is the emitted function `.s`, assembled, with its
function and data labels renamed to the reference ELF's names by address. Only functions whose entry
and extent agree with the ELF are scored; the others are already rows of the entries and extents
families. Score 0 means 100.0% match with zero relocation differences. A relocation whose reference
side targets a section symbol rather than a named symbol is counted as `unnamed-target` and reported,
not gated; every other difference fails. A fixture test misnames one pool word and requires the gate to
fail.

**Held-out runs** (`bench/src/seal.ts` and `classify.ts` for the sealed counts of one ROM, `test/gates/held-out-verdict.ts` for the verdict across the sealed ROMs and the D60 waiver, D25, D53). A dataset with `heldout: true` and an
empty `revealed` runs sealed: `bench run` stores and prints only counts and gate verdicts, never an
address or a name. Its exceptions are judged by ELF-checkable classifiers, not lists. A miss M (an ELF
`FUNC` the run did not report) is:

- `label-candidate` when it lies strictly inside the extent of a found function F whose entry is itself
  an ELF `FUNC`, M does not open with the profile's prologue, and one of these holds: (a) M follows a
  `bl` or `swi` site of F that the run judged never-returning; (b) M is the target of a `b` or `bcc`
  inside F (never of a `bl`, since a misjudged far `bl` is how a real function gets glued); (c) M lies in
  one of F's `holes` (a tiled hole or ARM mixer code). These are the plan's three meanings of a label;
- `glued` otherwise. A single `glued` miss fails the ROM.

The label-candidate count is gated at 11 per ROM (the tuning set's maximum, FE7J), and raw recall at
99.46% (Klonoa's 556 of 559, the tuning floor). A false entry is classified `startup`, `veneer` (origin
`veneer`), `adr-callback` (origin `adr`) or `inside-elf-function` (inside another ELF `FUNC`'s
`[value, value + size)`), and counted per class; startup entries are excluded as on the tuning set, the
others stay in raw precision. A synthetic test suppresses a split with `--disable` and requires the miss
to classify as `glued`.

`bench run --reveal <rom> --reason <text>` prints rows to stdout only, never into `results.json`, and
appends `{at, commit, reason}` to the dataset's `revealed`; from then on the dataset is tuning data and
never counts toward `g2.held-out` again. The provenance check fails if `results.json` holds rows for a
held-out dataset. If `g2.held-out` fails, phase 2 does not land unless the owner records a decision that
accepts the failure (§12); the failure is then fixed by a rule change justified by its `restsOn` and
validated on the tuning set alone, and a fresh sealed pair from the reserve pool is needed before any
claim of generality (D53). The owner answered §12 item 4 on 17 October 2026 (D60): tmc is revealed and
tuned on, and the owner's words record the gate as having no held-out ROM of a family absent from the
tuning set, so `g2.held-out` (through `test/gates/held-out-verdict.ts`) waives the fresh-family condition
for the sealed pokefirered and pokeruby (bound by name, ROM SHA-1 and ELF SHA-256) and the tuning families
of D60, printing the waiver with its grounds; any change to either needs a new decision. The owner's answer
to Q4 of phase-2.md on 18 October 2026 (D61 b), the option chosen: "Waive both", waives the two-families
condition too (both sealed ROMs are `pret-gen3`), under the same binding and printed with those words; the
per-ROM thresholds and "at least two sealed ROMs pass" still decide.

### 8.5 Commands

`npm run bench -- <command>`:

| Command | Does |
| --- | --- |
| `run [--only <rom>] [--scaffold] [--cpu-prof]` | scores each dataset, optionally scaffolds and builds in a temporary directory, writes `results.json` (lead only) and `timings.json`; `--cpu-prof` writes the top self-time functions per ROM |
| `speed [--only <rom>]` | serial, one ROM at a time, no workers: a warm-up run, then the median of 9 CPU times of the analysis (`process.cpuUsage`; 9 since D76 b, 5 before; the calibration and the emission timings stay the median of 5), wall time for information; compares with `baseline/speed.json` and the calibration ratio; the `--json` line names its run counts, each the samples measured (`runs`: the calibration's, the analysis count the fewest samples any ROM measured with `analysisRuns` per ROM, D77 g, and the emission count the fewest behind any `generateCpuMs` or `initCpuMs`, 0 when none was measured, D78 e) and each ROM's `budgetAnalysisCpuMs`, the median of the first five analysis runs, which `g3.speed-budget` reads (D77 f) |
| `regression [--base <ref\|file>] [--fresh <file>]` | compares two artifacts and their datasets; default base `git merge-base origin/main HEAD`, never HEAD; fails on fewer true positives, a new extent mismatch, a higher raw share, a lower readability share, or a `labels`/`untyped` row added without a `Bench-Exception: <rom> <addr> <reason>` commit trailer |
| `diff --base <ref\|file>` | prints the rows that moved, newly missed and newly false first |
| `stale-check` | fails when the source digest differs from the artifact's |
| `baseline <rom>` | prints what the committed artifact says |
| `adopt <rom>` | seeds a new tuning dataset's lists (refuses a sealed dataset) |
| `explain <rom> <addr>` | the public `explain` |
| `ablate <rule> [--only <rom>] [--tier synthetic\|real]` | re-runs with one rule disabled and prints what moves |
| `dataset-check` | the dataset-against-ELF check |
| `doctor-real` | checks every ROM, ELF, object directory, the PoC checkout and the toolchain against their recorded digests, before a run |
| `web [--port 4173] [--base]` | serves the report |
| `gates [--require <phase>] [--tier ci\|real]` | runs the gate tests and prints every gate with its verdict and input digests; `--tier real` writes the gate record into `results.json` |
| `signatures [--only <rom>] [--loo] [--json]` | phase 6: the signatures family (§8.4) after a seedless discover run, per tuning ROM (`romlift/bench-signatures@1`), sealed ROMs by counts only; `--loo` rebuilds each multi-reference version without each reference (`romlift/bench-signatures-loo@1`); `g6.signatures-judged`, `-heldout`, `-loo` read it |

npm scripts: `typecheck` (`tsc --noEmit`), `test` (unit, golden, architecture, property and mutation
tests, `node --conditions=source --test`), `corpus` (generate and assemble the corpus), `fixtures`
(`rebuild` and `check`), `bench`, `export-poc` (`--mode scored|parity|queries`; runs
`bench/tools/export-poc.ts`, which spawns the PoC's own `tsx` from `ROMLIFT_POC`), `test:local` (needs ROMs
and the PoC), `build` (`dist/`).

### 8.6 Provenance and CI

**Provenance by content** (D27). `meta.sourceDigest` is the sha256 over the sorted contents of
`src/**`, `signatures/specs/**`, `templates/**`, `bench/src/**`, `bench/tools/**`, `bench/dataset/**`,
`bench/baseline/**`, `test/gates/**`, `test/corpus/**` (D55), `package.json`, `package-lock.json` and
`tsconfig*.json`, plus the Node major version. `provenance.yml` recomputes it at the PR head and fails with "re-run the real
tier" when it differs from the committed artifact. It also fails when a real-tier gate of a phase ≤
`phase.json.landed` is not `pass` or `historical` in the artifact's gate record, when a family gated at
the current phase is absent from `meta.families` for a tuning ROM, when a dataset row has no matching row
in the artifact, or when the artifact holds rows of a held-out dataset. `commit` and `dirty` are kept as
information.

**Workflows** (`.github/workflows/`):

- `ci.yml` (matrix `ubuntu-latest` and `macos-latest`, Node 22.18 and 24): `npm run typecheck`,
  `npm test`, `npm run bench -- gates --require $(phase) --tier ci`, the determinism runs with a varied
  environment, `npm run bench -- regression` against the merge-base (from phase 2), and the
  synthetic-tier analysis and tree digests uploaded per job and compared by a final job (D30).
- `printer.yml`: the corpus on apt binutils and on Homebrew binutils.
- `fixtures.yml`: builds agbcc at the pinned commit, rebuilds every fixture and compares as above, then
  `init`, `setup.sh` and `make` per fixture (from phase 4).
- `packed.yml` (from phase 4): `npm pack`, install the tarball into an empty directory with
  `--ignore-scripts`, run `npx romlift init <fixture>.gba` there, `./setup.sh`, `make`, and expect the
  SHA-1; run `npx romlift doctor` from the tarball; assert that `npm pack --dry-run` lists `templates/**`
  and `dist/**` and no `.gba`, `.elf`, `.map` or built signature file (`g4.packed-e2e`).
- `provenance.yml`: the checks above.

## 9. Errors, logging, explain, performance, memory

### 9.1 Diagnostics and errors

Each module's `codes.ts` lists its codes with a one-line meaning; `core/diagnostic-codes.ts` unions them
(D45). A unit test fails on a code that is defined but never raised in its module, or raised but not
defined. The codes:

| Code | Module |
| --- | --- |
| `E_ROM_NOT_GBA` | `foundation/rom` |
| `E_TOML_PARSE`, `E_TOML_SCHEMA`, `E_TOML_KEY_SPELLING`, `E_DUPLICATE_ADDRESS`, `E_FUNCTION_MISALIGNED`, `E_TOML_PATCH_REFUSED`, `E_UNKNOWN_COMPILER`, `E_DECOMP_YAML_INVALID`, `E_ROM_SHA1_MISMATCH` | `core/config` |
| `E_MODULE_BORDER`, `E_MODULE_ORDER`, `E_MODULE_NAME_DUPLICATE`, `E_NAME_COLLISION`, `E_NAME_INVALID`, `E_OVERRIDE_INVALID`, `W_CROSS_MODULE_SHORT_BRANCH`, `W_INTERWORKING_BRANCH`, `W_FUNCTION_OUTSIDE_ROM`, `W_OVERRIDE_OUTSIDE_ROM`, `W_OVERRIDE_IGNORED`, `W_SYMBOL_UNPLACED` | `core/model` |
| `W_UNLISTED_FUNCTION`, `W_LISTED_INVALID`, `W_SEED_MALFORMED`, `W_PROFILE_MISFIT`, `W_UNDECODED_GAP`, `W_SETTLE_LIMIT`, `W_FIXPOINT_LIMIT`, `W_CANDIDATE_BUDGET`, `W_WALK_LIMIT`, `W_READING_BUDGET` | `core/analysis` |
| `E_SELF_CHECK_TILING`, `E_SELF_CHECK_REENCODE`, `E_MODULE_SIZE`, `E_SELF_CHECK_TEXT`, `E_PATH_CASE_COLLISION`, `E_PATH_INVALID`, `E_PATH_TOO_LONG` | `core/verify` |
| `E_PATH_NOT_OWNED`, `E_STALE_EDIT`, `W_UNOWNED_FILE` | `core/write-plan` (`E_STALE_EDIT` through `staleEdit`, which the shell's `applyWrites` also calls at write time, D81 b) |
| `W_C_ORDER`, `E_C_STUB_UNPLACED`, `E_C_STALE_DEFINITION`, `E_C_CONDITIONAL_STUB`, `E_C_FRAGMENT_STUB`, `E_C_MODULE_INCLUDED`, `E_C_UNSCANNABLE`, `W_C_UNSCANNABLE` | `core/reconcile` (`W_C_UNSCANNABLE` also through `unscannableWarning`, which `core/workflow/c-stubs.ts` calls for a C file of no module, D81 a; `E_C_FRAGMENT_STUB` since fix round 7, D83 a) |
| `E_DIR_NOT_EMPTY`, `E_STALE_CONFIG`, `E_C_DEFINITION_MOVED`, `W_C_FILE_UNUSED` | `core/workflow` (`init`'s verdict on its directory, D75 j, checked under the project lock, D77 j; `analyze --update --write` over a changed config, D75 m; the reconciliation of a project's C files, D77 a) |
| `W_EVIDENCE_CONFLICT` | `core/workflow` (the proposal screen, `checkProposals`, §7.4; `core/evidence` and the legacy codes were dropped with their importers, D91, D92) |
| `W_SIGNATURE_CONSTANT` | `core/signatures` (`codes.ts`, empty until its first raiser, D93) |
| `E_IO_READ`, `E_IO_WRITE`, `E_TOOLCHAIN_MISSING`, `E_TOOLCHAIN_FAILED`, `E_PROJECT_NOT_FOUND`, `E_PROJECT_LOCKED`, `W_STALE_LOCK`, `W_LOCKFILE_DEFERRED`, `W_SIGNATURES_ABSENT` | `shell` (its own `codes.ts`, outside the core union) |

Core never throws for content: it returns diagnostics, and a config error returns all errors at once.
It throws only `RomliftInvariantError` on a broken internal invariant (exit 70). The shell wraps I/O
failures into `E_IO_*`. The CLI prints text or, with `--json`, NDJSON (one diagnostic per line, then a
summary object). Nothing prompts.

### 9.2 Logging and explain

Core has no logger. It accepts an optional `TrailSink`; `--verbose` streams trail events, `--json`
emits them as NDJSON. The trail level is `off` by default, so a normal run stores only rejections.

`explain(addr)` re-runs the analysis the user's command would run (confirm mode inside a project, so it
explains what `generate` emitted; discover mode on a bare ROM) with `trail: 'full'` and `trailFilter`
set to the 256-byte bucket around `addr` and the extents that cite it (D35). The report is composed by
layer, each part added in the phase whose module produces it (D35):

```ts
// core/analysis/explain.ts (phase 2)
export interface AnalysisExplanation {
  readonly addr: Addr; readonly claim: ClaimKind;
  readonly owner?: { readonly entry: Addr; readonly origin: Origin; readonly provenance: readonly Provenance[] };
  readonly events: readonly TrailEvent[];          // proposals, rejections with MissReason, bl verdicts, waits
  readonly rules: readonly RuleMeta[];             // the meta of every rule id that appears above
}
// core/workflow/explain.ts
export type ExplainReport = AnalysisExplanation & {
  readonly item?: Item;                                                               // phase 3
  readonly chunk?: { readonly name: string; readonly kind: ChunkKind; readonly module: string };   // phase 3
  readonly name?: { readonly value: string; readonly source: NameSource };            // phase 4
  readonly signature?: ExplainSignature;                                              // phase 6, from `from` (D93)
};
export interface ExplainSignature { readonly library: string; readonly version: string; readonly name: string;
  readonly rule?: SignatureRuleId }
```

The signature part is read from the TOML's `from` key, so `explain` never re-runs the matcher; with
`--rom` on a bare ROM in phase 6 it may run the matcher on the discover result it already has.
Re-running costs one analysis; the filtered trail keeps memory bounded. `g6.explain-coverage` asserts
the composed type over goldens built only from fixtures.

### 9.3 Performance

Measured baseline (PoC, this Mac, `node --cpu-prof`, by the 17 October review): sa3 18.6 s, FE7J 10.6 s,
Emerald 6.0 s. On sa3 92.5% of self time is `looksLikePointerTable`, whose loop re-runs the `codeEnd`
getter on every pass; the whole run makes only 8,542 `analyzeThumb` calls. FE7J is the only ROM with
heavy re-reading (248,725 `analyzeThumb` and 173,556 `whyInvalid` calls), and still spends 59.5% in the
same function. Budget: analysis ≤ 3 s CPU per tuning ROM, `generate` ≤ 10 s and `init` ≤ 15 s on
Emerald (`g3.speed-budget`). Levers, in the order milestone M2 applies them (D13):

1. **Computed-once facts.** A `Reading` is immutable, so its `codeEnd`, `end` and extent are computed
   when it is built, which removes the measured quadratic loop without changing a result.
2. **Indexed lookups.** `owner()` uses a nesting-aware interval index (`foundation/util/interval-index.ts`)
   and returns the innermost extent covering an address (the PoC took the first match; the lockstep of
   milestone M1 compared the two on every query of its log). The
   pointer index is CSR (sorted target `Uint32Array` plus offsets, `foundation/util/csr.ts`).
3. **Epoch reuse**, only if a ROM still misses the budget after a re-measure: `cache: 'epoch-reuse'`
   (§4.2), with digest equality to `'epoch'` on every tuning ROM.

There is no LRU and no capacity-based eviction: a reading cache that evicted and recomputed under newer
claims would make results depend on the capacity. `bench run --cpu-prof` and `bench speed` back every
performance claim. The bench fans out one ROM per `worker_thread` for scoring; `bench speed` never does.
The analysis itself is single-threaded.

### 9.4 Memory and size

For a 32 MiB ROM: ROM 32 MiB, claim kinds 32 MiB (`Uint8Array`), two decode caches (Thumb, one byte
per halfword, 16 MiB; ARM, one byte per word, 8 MiB; 255 meaning not yet decoded), because the gap scan
decodes the same address in both modes; the pointer index under 8 MiB typical (64 MiB worst case);
readings retained for accepted functions plus the current epoch's candidates; provenance with `cites`
capped at four; rejections kept as the last one per `(addr, mode)` with a count. The model's items are
a struct of arrays (`ItemTable`, about 17 bytes per item) decoded lazily, not one object per
instruction. Canonical JSON is produced as a stream of string chunks (`foundation/formats/canonical-json.ts`)
and hashed incrementally by the shell, so no artifact is ever one string; `model --json` is NDJSON per
chunk; writers produce one module's files at a time, and the check and write passes keep only paths and
digests (§6.4). `g3.large-rom` builds a deterministic synthetic 32 MiB ROM by tiling fixture code with
seeded data and runs `init` and `generate` each in its own process under the heap cap the `romlift` bin passes
(`--max-old-space-size=1024`: the bin's first line is `#!/usr/bin/env -S node --max-old-space-size=1024`, the owner's
answers to Q2, Q6 and Q7 of phase-3.md, D68 b, D69, D72; Q7's 1,024 MiB replaces Q6's 384, which replaced Q2's 256), so
it measures what those workflows hold under the bin's cap rather than how far V8 lets its heap grow; it requires both to
complete under the cap and their peak RSS to stay below the budget, recording `maxRssMiB` (and, recorded only,
`peakLiveHeapMiB`, the heap live after a full GC, which is what meets the cap first: about 288 to 349 MiB, D72 b). The
budget, 1,536 MiB, is the largest peak of the eight runs recorded under the 1,024 MiB cap (1,210.1 MiB, `generate`) plus
25%, rounded up to a multiple of 64 MiB (D72 b); it replaces the 1,088 MiB set the same way under 384 MiB (D69 b). The
bin's own commands (`analyze`, `explain`, `model`, `verify` with `--assemble` and `--link`) take other paths than those
workflows; `bench large-rom --bin` runs each of them under the cap, recording each one's peak RSS and live heap, and
`test/local/large-rom-bin.test.ts` requires all to complete on the synthetic ROM (D70 b, D71 b, e): the discover
analysis is dropped before the confirm analysis runs, and `analyze`'s text table, `analyze --json` and `model --json`
stream their output, waiting for stdout to drain. Under the 1,024 MiB cap (D72 c, d) the bin's commands complete on the
synthetic ROM (peak RSS 940.0 to 1,217.6 MiB, live heap at most 422.6 MiB), on the six tuning ROMs (4 to 16 MiB; 212.7
to 847.5 MiB) and on a 32 MiB ROM of real code density, pokeemerald twice over (29,084 functions; 951.6 to 1,376.0 MiB,
live heap at most 922.7 MiB); that ROM is measured by `bench large-rom --bin --rom`, not gated. Its readable tree fails
the text-layout check on two `adr` lines naming a function label (`verify` exit 3, nothing written), a phase-4 work
item (roadmap.md, phase 4, "Carried from phase 3"); its raw tree links to its SHA-1.

## 10. Testing strategy

| Kind | Where | ROM needed | CI |
| --- | --- | --- | --- |
| Unit, per module and per rule (rules on hand-assembled bytes) | `test/unit/**` | no | yes |
| Architecture: layer edges, globals allowlist, Map iteration, rule-file isolation, barrels | `test/architecture.test.ts` | no | yes |
| Golden: printer text, every writer, TOML serializer and patcher, reconciler (C in, C out), setup.sh duties, explain | `test/golden/**`; `UPDATE_GOLDEN=1` rewrites, the diff is the review | committed fixtures | yes |
| Property (seeded, no dependency): `decode∘encode` identity per row; `roundTrips` or raw for every decoded word; seed and TOML order permutation gives the same analysis digest (after M4); random legal TOML edits keep the self-checks and the link green (`g4.toml-mutations`) | `test/unit/**/*.prop.test.ts`, gates | no | yes |
| Mutation: each checker is shown to fail on an injected fault (tiling overlap, a flipped byte in a `FileEntry`, a dataset row the run no longer needs, a held-out row in `results.json`, `bench adopt` on a sealed dataset, a reconciled file whose sha1 changed, a stale digest, an illegal import) with the exact code and exit code | `test/mutation/**`; gates `g1.checks-fail`, `g2.checks-fail`, `g3.checks-fail`, `g4.checks-fail` | no | yes |
| Round-trip corpus against `as` | `printer.yml` | no | yes |
| Synthetic analysis and end to end | `fixtures.yml`, `packed.yml`, `g2.synthetic-analysis`, `g4.e2e-fixtures` | committed fixtures | yes |
| Local: the PoC decoder differential, the committed PoC-parity evidence, cache modes | `test/local/**` | local ROMs and the PoC | no |
| Real tier and real gates | `bench run`, `bench gates --tier real` | local ROMs | provenance and gate record only |

**Gates as tests.** Each `test/gates/gN.<name>.test.ts` calls `gate()` from `test/gates/gate.ts`:

```ts
export interface GateSpec {
  readonly id: `g${1 | 2 | 3 | 4 | 5 | 6}.${string}`;
  readonly phase: 1 | 2 | 3 | 4 | 5 | 6;
  readonly tier: 'ci' | 'real';
  readonly needs: readonly string[];      // public exports the gate calls, e.g. ['analyze', 'explain']
  readonly inputs?: readonly ('roms' | 'elfs' | 'objects' | 'poc' | 'toolchain')[];   // 'klonoa' went with phase 5's gates (D92)
  readonly historicalAfter?: 2;           // PoC-parity gates: `historical` once that phase lands; run still runs
  run(cx: GateContext): Promise<void>;    // throws on failure
}
export type Verdict = 'pass' | 'fail' | 'pending' | 'unavailable' | 'historical';
```

`gate()` reports `pending` when a name in `needs` is not exported yet, and `unavailable` (with the
missing input named) when an input is absent or its digest differs from the dataset's (D50). `bench gates
--require N --tier T` fails when any gate of phase ≤ N and tier T is `pending`, `fail` or `unavailable`;
its output lists every gate with its verdict and input digests. `test/gates/phase.json` holds
`{ "landed": N }`; raising it is the act that closes a phase, so a later phase can never regress an
earlier gate. Capability is detected inside the test, so the product API carries nothing for tests
(D29).

## 11. Phase-by-phase delivery

The components of each phase, their files, APIs, tests, ported PoC code and dependencies, and the exact
exit commands, are in [roadmap.md](roadmap.md). The rules here govern all of them.

**Git** (D39). One branch `phase/<n>-<name>` per phase, with component branches `phase/<n>/<component>`,
each in its own `git worktree`. The phase branch merges to `main` and is pushed only when `npm run bench
-- gates --require <n>` passes for both tiers and `phase.json` is raised in the same merge. Every commit
message ends with the two attribution lines of `AGENTS.md`.

**Parallel work** (D43). Each phase opens with component 0, by the phase lead: it freezes the phase's
types, creates the empty barrels (`src/api/<component>.ts`, `cli/commands/lists/<component>.ts`), the empty
family registries and codes files, updates the phase's gate files (written in phase 1) to the frozen API,
and must typecheck. Then three to five
components run in parallel in separate worktrees, each owning a disjoint set of files (roadmap.md lists
them), and each proven alone: by its unit tests, its goldens, and, in phase 2, by lockstep against the
PoC with the other families answered from the log (§4.5; deleted once its evidence was committed, D59). A component changes a frozen type only through
a commit to the phase branch that all components rebase on. A last component, the integrator, merges
them, runs the milestones that need everything together, regenerates `bench/results.json` (no component
commits it), and runs the exit commands.

**Entry and exit.** Phase n opens when phase n − 1 has landed; it exits when the commands listed for it
in roadmap.md pass. The gates per phase are those of §1.

## 12. Risks and open questions

| Risk | Effect | Mitigation |
| --- | --- | --- |
| The rules overfit the tuning ROMs | wrong splits on a new game | sealed held-out runs with ELF-checkable classifiers that cannot hide a glued function (§8.4); two codebase families must pass; `bench ablate` and `g2.rule-coverage` per rule; every rule carries `restsOn` |
| Semantics-first porting keeps PoC quirks (LIFO order, a 40-instruction table window, windows of 4,096, 16 and 64 bytes) | behaviour rests on accidents | every constant is a named profile field; the table window is replaced by register tracking at M3 and the order at M4, each one reviewed commit with its diff (D10, D12) |
| The driver cannot reach parity | phase 2 stalls | the driver ports the PoC's control flow verbatim and lockstep reports the first divergent query (D48) |
| Confirm mode diverges from discover mode | `generate` splits differently from `init` | `g2.confirm-equals-discover` in the phase that builds the driver; `g4.generate-idempotent` on the files |
| GNU `as` versions disagree on an encoding | mismatch at first build | corpus on two binutils versions at both alignments, `doctor`, raw fallback, the text-layout self-check |
| The 3 s budget is not reached | slow `generate` on large ROMs | M2 starts from a profile; the measured hotspot is a quadratic getter; `g3.speed-budget` |
| A held-out ROM gets revealed during diagnosis, or fails | it stops counting; phase 2 blocks | the reveal is recorded in Git; a reserve pool is named in benchmark-roms.md; landing on a failure needs an owner decision (D53) |
| Signatures arrive in phase 6 | phase-4 scaffolds have no library modules | still byte-exact: unrecognised library code stays in game modules as `INCLUDE_ASM` stubs, and its hand-written parts land in `asm`-only modules by the rule of §6.2; moving signatures earlier touches only `core/signatures`, `propose.ts` and the `LibraryRegion` input of `infer-modules` |
| Node type stripping | no enums or parameter properties; Node ≥ 22.18 | enforced by `erasableSyntaxOnly`; CI runs Node 22.18 and 24 |

**Decisions that need the owner** (each is built with the safe default until answered):

1. Signature files carry masked bytes of m4a, libgcc and the other libraries, taken from commercial
   ROMs. The plan ships them beside the tool; benchmark-roms.md forbids committing anything derived from
   ROM bytes. Default: not committed, not published, built locally (D40). Alternative: hashed windows
   plus short anchors.
2. Should a migrated repository adopt the recovered boundaries (for Klonoa at `693ccb7`: 282 legacy
   entries inside found functions, one failing validation, 183 ELF functions the list lacks), in one pull
   request or module by module? **Moot** since the owner skipped phase 5 and dropped legacy import (D92); D51 is
   superseded.
3. A border the user moves across a short Thumb branch prints that branch raw (D15). The plan says no
   branch is left raw; `init` never produces such a border. Approve the exception, or make such a border
   an error?
4. If `g2.held-out` fails, may phase 2 land with the failure recorded, while release 1 stays blocked until
   a fresh sealed pair passes (D53)? **Answered by the owner on 17 October 2026: "Tune on tmc, no new
   ROM"** (D60). tmc is revealed and tuned on with general rules; pokefirered and pokeruby stay sealed and
   pass; `g2.held-out` is recorded as having no held-out ROM of a family absent from the tuning set.
   Release 1 still needs a fresh sealed pair of such a family before it claims generality (D53). Fix
   rounds 1 and 2 of D60 withdrew every gate reading the decision did not cover and asked the owner five
   questions (phase-2.md, Q1 to Q5); **the owner answered them on 18 October 2026** (D61): Q1 and Q2,
   "Keep tmc as 99.94%. It's a benchmark row that we can improve later" (`g2.poc-parity` scoped to the five
   ROMs of the M1 evidence, tmc printed as not applicable; tmc a benchmark row in `g2.baseline-rows`, its
   rows listed with a category accepted and tp 8,631 a floor); Q3, "Build resettle, else accept" (the
   `resettle` stage was built, changed rows on the other ROMs and the sealed pair, and was reverted; tmc's
   six differences of Q3 are a printed known limitation); Q4, "Waive both" (both family conditions of
   `g2.held-out` waived, printed, for the sealed pair and tuning families of D60 only); Q5, "Use $d for
   every ROM" (the code-end convention of §8.4). `g2.confirm-equals-discover` then failed on two more tmc
   functions (0x080B255C, 0x080B2874) that Q3's count of six, taken before `95b257b`, did not include
   (phase-2.md, Q6); the owner answered Q6 on 18 October 2026, "Yes, cover all 8", and the known limitation
   covers the eight with their records. Nothing else is waived.
5. Whether `[functions]` moves into an included `romlift.functions.toml` above some size (Emerald is
   about 16,000 lines).
6. Whether `romlift/isa` becomes its own package shared with gba-kit, or stays a subpath export.
7. Windows: the tool only, or the scaffolded build too.
8. The Transmuter block in `decomp.yaml`.
9. Which compiler built the other Klonoa GBA games, which decides whether a second analysis profile
   belongs in release 1.
10. The phase-3 owner questions (phase-3.md, Q1 to Q8), **answered by the owner on 19 October 2026** (D68, D69, D72, D73):
    Q1, "Move gate to phase 5" (`g3.objdiff` is `g5.objdiff`, `g6.objdiff` since D92; phase 3 records the classified counts and keeps the
    classifier); Q2, "Measure under a heap cap" (the `romlift` bin and `g3.large-rom` run Node with
    `--max-old-space-size=256`, §9.4, raised to 384 by Q6 and to 1,024 by Q7); Q3, "Accept, don't flush generated" (§6.4, D64 d); Q4, "Accept" (the
    narrowed raw-printer PoC parity of D65 l is roadmap 3.B's gate); Q5, "Accept Q5a; fix Q5b, c in phase 4" (the
    alignment refusal is a release-1 limitation; padding-only orphans folded into the next function, and confirm
    not re-validating the functions discover listed, are phase-4 work items in roadmap.md). Applying Q2 found that
    no run of the 32 MiB synthetic ROM completes under 256 MiB; Q6, "384 MiB for bin and gate" (D69: the bin and
    `g3.large-rom` use `--max-old-space-size=384`, the budget 1,088 MiB set from the runs then recorded under it with a
    25% margin, 15.1% over the largest peak recorded since, D70 c);
    the review of that landing found the bin's own commands out of memory on the synthetic ROM under the cap, which
    fix round 4 resolved without a gate change (D70). Fix round 5 found a code-dense 32 MiB ROM that does not complete
    under 384 MiB (D71); Q7, "Raise cap to 1,024 MiB" (D72: the bin and `g3.large-rom` use `--max-old-space-size=1024`,
    the budget 1,536 MiB set again from the runs under it with the same margin; every bin command completes on that
    ROM under the cap, its readable `verify`'s text-layout failure on two `adr` lines being a phase-4 work item and a
    recorded phase-3 limitation; no dense ROM is added to the gate). The landing run after that answer failed `g2.speed`
    by 0.5 ms on sa2 with the analysis unchanged; Q8, "Re-run the gate list" (D73: the whole closing list runs again
    unchanged at a commit raising `phase.json` again; no gate change; a further failure is a new owner question), and
    that run passed every command at `0784b4e`.

## 13. Gate index

Every gate of §1, with its tier and what it asserts. "ci" gates need no local input; "real" gates need
the local ROMs, ELFs, reference objects, the PoC or the Klonoa checkout, and report `unavailable` when
one is missing.

| Gate | Tier | Asserts |
| --- | --- | --- |
| `g1.architecture` | ci | import edges of §2 (type-only imports included), globals allowlist, Map/Set iteration, rule-file isolation, barrel shape; `tsc --noEmit` passes |
| `g1.runtime-deps` | ci | `dependencies` is exactly smol-toml, zod, @match-kit/decomp-yaml; no install script, `.node` or `binding.gyp` in the production tree |
| `g1.thumb-roundtrip` | ci | every printed Thumb mnemonic of the corpus assembles to its bytes |
| `g1.bl-sample` | ci | the same for the `bl` pair corpus |
| `g1.arm-sample` | ci | the same for the ARM corpus, with per-row coverage classes recorded |
| `g1.encoder-agrees` | ci | `assemble` equals `as` on every printed text |
| `g1.context-corpus` | ci | every PC-relative and branch form agrees with `as` at both alignments and at its offset extremes, under the shared dialect preamble |
| `g1.doctor` | ci | `doctor` reports the toolchain and re-assembles the corpus |
| `g1.bench-harness` | real | rescoring the PoC's `scored.json` reproduces `bench/baseline/poc-2026-10-16.json` row for row; the PoC's scaffold reproduces the SHA-1 on all five; two PoC runs give one digest |
| `g1.dataset-elf` | real | every `labels` row is an ELF `FUNC` inside a found function, every `untyped` row is not a `FUNC` |
| `g1.provenance` | ci | the source digest, gate record, family and held-out checks of §8.6 run and agree with the committed artifact |
| `g1.checks-fail` | ci | mutation tests of the phase-1 checkers (architecture, corpus comparator, dataset check, provenance) |
| `g2.poc-parity` | real (historical after phase 2) | M1: parity-view digests equal `poc-digests.json`; rows equal the PoC baseline; the same check runs once historical; scope the five M1 ROMs, tmc not applicable (D61 c) |
| `g2.baseline-rows` | real | rows equal the baseline except the improvements in `accepted-diffs.json`; no stale improvement; tmc a benchmark row (rows listed with a category accepted, tp 8,631 a floor; D61 d) |
| `g2.entries` | real | the entries family of §8.4 |
| `g2.extents` | real | the extents family |
| `g2.code-end` | real | the code-end family |
| `g2.no-unreviewed` | real | no dataset row has category `unreviewed` |
| `g2.confirm-equals-discover` | real | §4.2; tmc's eight differences of Q3 and Q6 a known phase-2 limitation, printed, nothing else accepted (D61 e) |
| `g2.determinism` | ci and real | two processes with a varied environment give one analysis digest; Linux, macOS and both Node versions agree |
| `g2.synthetic-analysis` | ci | every fixture's `expect.json` holds, negative fixtures included |
| `g2.rule-registry` | ci | §4.1 registry checks |
| `g2.rule-coverage` | ci | every analysis rule is cited as decisive in at least one fixture trail, and `bench ablate <rule> --tier synthetic` changes at least one fixture outcome, or a decision record names why the rule stays |
| `g2.vocabulary-emitted` | ci | every miss reason and origin is emitted by some rule |
| `g2.second-profile` | ci | the dummy profile of §4.3 typechecks and runs on every fixture |
| `g2.held-out` | real (sealed) | the held-out family of §8.4 |
| `g2.speed` | real | `bench speed` within 1.5 × `baseline/speed.json` (calibrated), each ROM's analysis the median of nine serial runs, nine samples measured per ROM (D76 b, D77 g) |
| `g2.regression` | ci | `bench regression` against the merge-base passes on the committed artifacts and datasets |
| `g2.checks-fail` | ci | mutation tests of the classifier, seal, stale-exception and regression reporters (the lockstep reporter was deleted with the oracle, D59) |
| `g3.self-check` | ci and real | tiling, re-encode and module-size checks pass on every fixture and tuning ROM |
| `g3.text-layout` | ci and real | the text-layout check, and the paths check of the same pass, pass on every fixture and tuning ROM |
| `g3.raw-link` | ci and real | the raw printer links to the SHA-1 on every fixture and every tuning ROM |
| `g3.link` | ci and real | the readable printer links to the SHA-1 on every fixture and on at least three tuning ROMs (target all six, D62 h) |
| `g3.readability` | real | readability shares only increase, on every tuning ROM |
| `g3.tree-determinism` | ci and real | two processes with a varied environment give one tree digest; no generated file contains the project path; Linux and macOS agree |
| `g3.golden-writers` | ci | every writer's output on every fixture equals its golden |
| `g3.speed-budget` | real | the budgets of §9.3 (calibrated); the analysis budget reads the median of the first five of `g2.speed`'s nine runs, as many as before D76 b (D77 f) |
| `g3.large-rom` | ci | §9.4: under the `romlift` bin's heap cap, 1,024 MiB (D68 b, D72) |
| `g3.checks-fail` | ci | mutation tests of the four self-checks and of `planWrites` |
| `g4.e2e-fixtures` | ci | in a directory holding only the fixture ROM, `npx romlift init <rom> && ./setup.sh && make` ends at the SHA-1; the composite fixture's illegal border fails with `E_MODULE_BORDER` |
| `g4.e2e-real` | real | the same command on every tuning ROM; sealed ROMs report counts only |
| `g4.packed-e2e` | ci | the same command from the packed and installed tarball (`packed.yml`) |
| `g4.generate-idempotent` | ci and real | `generate` right after `init` gives an identical tree on every fixture and every tuning ROM |
| `g4.toml-mutations` | ci and real | seeded random legal TOML edits (move a module start to another legal border, rename, delete a listed function, add a valid override, split a module) keep the self-checks and the link green; each illegal edit (unaligned start, duplicate key, bad key spelling) gives its documented code and writes nothing |
| `g4.no-toml-write` | ci | `generate` never opens the TOML for writing |
| `g4.worktree` | ci and real | in a fresh `git worktree` of an initialised project, `./setup.sh` copies the ROM from the main checkout and `make` ends at the SHA-1 |
| `g4.toml-canonical` | ci | `serialize∘parse` is the identity on canonical files; patches keep comments and re-parse |
| `g4.c-data-fails-loud` | ci | §6.6 |
| `g4.multi-compiler` | ci | the multi-compiler fixture builds with two compilers from `modules.mk` |
| `g4.cli-contract` | ci | every command runs with stdin closed; `--json` output parses line by line; exit codes follow §2.1 |
| `g4.checks-fail` | ci | mutation tests of the lock, the journal (failure after the k-th op) and the patch planner |
| `g6.signatures-judged` | real | the signatures family of §8.4, with the PoC's table as floor on its five ROMs (Klonoa 94/6/20/10 and so on, `bench/baseline/poc-2026-10-16.json`); tmc by the ELF checks with no floor |
| `g6.signatures-rebuild` | ci and real | building twice from the specs gives identical files; the local build equals the PoC's files converted to schema 3; the library fixture's file equals its golden |
| `g6.signatures-heldout` | real (sealed) | on every sealed ROM, every placement is at an ELF `FUNC` or classified untyped, every table an `OBJECT` or a label; counts only |
| `g6.signatures-loo` | real | for each multi-reference version, rebuilding without reference R and applying it to R's ROM adds and moves no placement, and places every member another reference also has |
| `g6.no-heldout-references` | ci | no spec names a sealed dataset |
| `g6.ram-code-mapped` | ci and real | §6.7, with no trace (D91): a hand-written `runs_at` override, from a fixture's `ramCopy` (ci) and from `bench/overrides/klonoa.json` on Klonoa (real, `0x0804F318 → 0x03000388`), is one module spanning exactly the range at its run address, placed with `AT(...)` and `__load_<module>`, and the build reaches the SHA-1 |
| `g6.evidence-conflict` | ci | a signature proposal that contradicts the analysis or the config gives `W_EVIDENCE_CONFLICT` from `checkProposals` and changes nothing: the kept proposals are those kept without it (§7.4, D91 d) |
| `g6.explain-coverage` | ci | every analysis and `sig.*` rule id appears in at least one explain golden, all built from fixtures; `SIGNATURE_RULES` holds exactly the five `SignatureRuleId`s |
| `g6.reconciler` | ci | C in, C out goldens: add, remove, move stubs; comments and strings untouched (`g5.reconciler` until D92) |
| `g6.rename` | ci | identifier-only renames; refusals (`g5.rename` until D92) |
| `g6.expected-bytes` | ci and real | §6.8: every `expected/<module>.s` assembles to its module's ROM range (`g5.expected-bytes` until D92) |
| `g6.objdiff` | real | §8.4 objdiff, on every tuning ROM whose readable build links, baseline phase-3.md Q1 (`g3.objdiff` until D68 a, `g5.objdiff` until D92) |
| `g6.c-data-ranges` | ci | §6.6: with `data_start`, a C array replaces its slice of the ROM and the build still matches (`g5.c-data-ranges` until D92) |
