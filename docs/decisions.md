# romlift decisions

Architecture decision records for [architecture.md](architecture.md). Each entry states the context,
the decision, its consequences and the alternatives rejected, with the reason. A decision changes
only through a new commit to this file that says what replaced it and why. The last section maps
every weakness the design review raised to the decision that answers it.

Revision 2 (17 October 2026) revises the decisions the four adversarial reviews of that day contested and adds
D45 to D53 (D54 records how phase 1 was split as executed, D55 what the phase-1 review changed, D56 how phase 2 is split and which contract members its driver added); each revised decision carries a **Revision** paragraph naming the findings and what it replaced.
The disposition of every finding is in [architecture-review.md](architecture-review.md).

Sources of the alternatives: the three architecture proposals of 17 October 2026 (layered core,
pipeline and artifacts, user workflows and phase gates first), [plan.md](plan.md) revision 26 and the
proof of concept.

---

## D1. One npm package with four entry points

**Context.** The plan asks for one package. gba-kit may share the decoder. asmlift and Mizuchi need the
model without parsing `.s` files, and a scaffolded project pins one version. The bench needs tuning knobs
that must not become public API.

**Decision.** One package `romlift` with exports `romlift` (pure API), `romlift/node` (file-backed API),
`romlift/isa` (instruction set) and `romlift/internal` (analysis tuning and the lockstep oracle, outside
semver, D37). Templates and signature specs ship in the package; built signature files ship only if the
owner approves (D40).

**Consequences.** One version pin fixes analysis, printer, signature specs and templates together.
`foundation/isa` imports nothing outside `foundation`, so extracting it later is mechanical.

**Revision (17 October 2026, findings clean-architecture-9, plan-fidelity-5).** Added `romlift/internal`
and stopped shipping built signature files by default.

**Rejected.** Separate packages now (two pins that drift; frozen APIs between layers that change together
through phase 4). A single `"."` export that mixes pure and file code (breaks browser use and hides the
layer boundary).

## D2. Node 24 type stripping, `node --test`, no build step in development

**Context.** Node 24 runs TypeScript by stripping types. The PoC uses `tsx` and constructor parameter
properties. One proposal used `const enum`, another vitest and fast-check. Node refuses to strip types
under `node_modules`, so an installed package must run built JavaScript.

**Decision.** `erasableSyntaxOnly`, `verbatimModuleSyntax`, `rewriteRelativeImportExtensions`; tests
run with `node --test`; `tsc` typechecks and builds `dist/` for publishing. Every export has a
`"source"` condition pointing at `src/*.ts` and a `"default"` condition pointing at `dist/*.js`, and every
npm script and CI job runs Node with `--conditions=source`. No `enum`, `namespace` or parameter
properties: closed sets are `as const` objects or literal unions. Seeded property tests use an in-repo
PRNG. `engines.node` is `>=22.18`, and CI runs Node 22.18 and 24.

**Consequences.** Zero runtime or test framework dependency beyond TypeScript itself; the PoC's classes
are rewritten, not copied. Development and the bench never need a build, while an installed package runs
`dist/`, which `g4.packed-e2e` proves from the tarball.

**Revision (17 October 2026, findings feasibility-and-performance-15, testing-and-verification-6,
testing-and-verification-13).** The first version said "no build step" without saying how the package
self-reference used by the bench resolves, and tested only one Node version. Added the `source`
condition, the packed end-to-end gate and the Node matrix.

**Rejected.** `tsx` (an extra loader for what Node does natively), vitest and fast-check (dependencies
for features `node:test` and a 20-line PRNG cover), `const enum` (not erasable). Exports pointing at
`src/*.ts` (break every consumer, since Node will not strip types under `node_modules`). A package.json
`imports` alias for the bench only (the gates would still not test what users install).

## D3. Four layers named as in the plan; each plan module split into a pure part and an I/O part

**Context.** The plan's diagram puts `config`, `scaffold`, `reconcile` and `evidence` in the shell
layer, and states "files are touched only in the shell layer; the core is pure". Those modules contain
mostly pure logic (schema validation, template rendering, tokenizing, parsing). One proposal put all of
it in one `core/project` grab-bag; another left parsers and the config schema in the shell, so the core
would import a shell type.

**Decision.** Layers `foundation`, `core`, `shell`, `cli`. Each plan module is split by purity:
`core/config` with `shell/config`; `core/scaffold` with `templates/` and `shell/project/templates.ts`;
`core/reconcile` with the `edit` operations of `core/write-plan`, applied by `shell/project`; every pure
file-format parser in `foundation/formats` (ELF, GNU map, canonical JSON, Luvdis cfg, ldscript symbols,
thumb aliases, trace JSON) with `shell/evidence` reading the files; `core/legacy` mapping legacy files to
evidence facts; `core/evidence` (facts and merge). Small single-concern core modules hold what several
consumers share: `core/proposals` (the proposal union), `core/layout` (legal borders, module inference,
the config built from a discover run), `core/profile` (the compiler profile type and registry) and
`core/write-plan` (the write policy). There is no overlay module. The dependency table of architecture §2
fixes every allowed edge.

**Consequences.** The plan's rule holds exactly: logic is testable on in-memory strings and bytes, and
the shell only moves bytes. `RomliftConfig` lives in `core/config`, below every module that needs it.
Format parsers have one home. The diagram's placement is deviated from in letter, not in intent.

**Revision (17 October 2026, findings clean-architecture-5, -8, -11, -12).** Parsers had three homes
(`foundation/formats`, `core/legacy`, `core/evidence/trace-json.ts`); they now have one. Write policy
moved out of the shell into `core/write-plan`. `core/overlay` was a single-caller pass-through and its
name collided with the community's term for RAM-loaded code; it is deleted. Module inference moved out
of `core/model` into `core/layout`, removing the model's edge to signatures.

**Rejected.** A `core/project` module holding seven concerns (low cohesion). Parsers and the config
schema in the shell (logic in the I/O layer). Folding `foundation` under `src/core/` and calling the
shell `node/` (vocabulary drift from the plan). Keeping `core/overlay` (two sources for names and
modules in every writer).

## D4. ELF, map and canonical JSON parsers are pure foundation code

**Context.** The bench, the signature builder and evidence import all parse ELF and GNU ld map files.

**Decision.** Every pure parser of a file format lives in `foundation/formats/` (`elf`, `gnu-map`,
`canonical-json`, from phase 5 `luvdis-cfg`, `ldscript-symbols` and `thumb-aliases`, from phase 6
`trace-json`); each takes `Uint8Array` or `string`;
`shell/evidence/read-*.ts` only read files and call them.

**Consequences.** Parsers are unit-tested on committed fixture ELFs; the plan's `evidence` module
becomes "read files (shell) + parse (foundation) + facts (core)".

**Rejected.** `node/elf.ts` in the shell (pure logic leaking into I/O). Parsers in `core/evidence`
(the bench and signature builder would import an evidence module for a file format).

## D5. Layer rules enforced by a test using the TypeScript compiler API, with a globals allowlist

**Context.** R7 demands lint-enforced layer rules. Options: dependency-cruiser, ESLint, or a test. A
denylist of banned identifiers misses `crypto`, `Intl`, `globalThis`, timers and argument-less sorts,
and iteration order of a `Map` silently becomes output order.

**Decision.** `test/architecture.test.ts` parses every import of `src/`, `bench/src/` and `test/gates/`
with the TypeScript compiler API and checks each edge, type-only imports included, against the table of
architecture §2; it also runs the typechecker. Under `foundation` and `core`, every identifier that
resolves to a global must be on the allowlist of architecture §2, and `localeCompare`,
`toLocaleString` and an argument-less `.sort()` fail. A type-checker pass fails when `core/analysis`,
`core/model`, `core/emit`, `core/layout` or `core/signatures` iterates a `Map` or `Set` except through
`sortedKeys`/`sortedEntries`. In the shell, only `shell/fs.ts` may call `readdir`, and it sorts. A rule
file importing another rule file, `core/profile/agbcc.ts` or `core/profile/registry.ts` fails.

**Consequences.** No extra dependency or config format; the rules are TypeScript data next to the
test; a violation fails `npm test` and CI.

**Revision (17 October 2026, findings feasibility-and-performance-11, clean-architecture-1,
clean-architecture-4, testing-and-verification-13).** Replaced the denylist with an allowlist; added the
Map iteration check, the sorted directory listing, and the rule-to-profile restriction; stated that
type-only imports are edges. The review's proposal to shuffle directory listings under a runtime test
flag was not taken: a test flag in the product is what D29 rejects, and a single sorted `listDir`
removes the variable instead of testing it.

**Rejected.** dependency-cruiser (an extra dependency and a `.cjs` config, and it cannot ban globals).
ESLint `no-restricted-imports` (per-directory config sprawl). A denylist (incomplete by construction).

## D6. "Provenance" for rule records, "evidence" for external facts, "accept" for the acceptance rules

**Context.** The plan uses "evidence" for the importers of traces, ELFs, maps and cfgs, and also for
one row of its rule table ("Evidence: a valid candidate starts where accepted bytes end…"). Two
proposals named a rule registry `core/evidence` or a rule interface `Evidence`, then needed another
word for the importers.

**Decision.** `core/evidence` and `EvidenceFact`/`EvidenceSource` mean external facts only. A rule's
record of a decision is a `Provenance`, kept in `core/provenance` with the rule registry, rejections
and the trail. The plan's "Evidence" rule family is the `accept.*` family (`AcceptRule`).

**Consequences.** Each word has one meaning across layers. `explain` prints "accepted by
`accept.prologue-and-loaded`", never "evidence" for a rule.

**Rejected.** Keeping "evidence" for both (two meanings in one codebase). `core/trail` for the
registry (the registry is more than the trail).

## D7. One file per rule, metadata in the rule file, and every order in the profile

**Context.** The PoC's `Analyzer` mixes walking, judging, scheduling and bookkeeping in `if` chains
switched by environment variables. The first version kept rule metadata in `core/provenance/rules.ts`,
implementations in rule files, registration in `rules/index.ts` and only part of the order in a
`PIPELINE` constant, so the order of walk policies, validity checks and accept rules came from registry
import order.

**Decision.** Every rule is one file `core/analysis/rules/<family>/<name>.ts` exporting a value built by
`defineRule({ meta, kind, … })`. `RuleMeta` carries `id`, `summary`, `restsOn`, `recovers`, `reads`,
`adds` (the plan: "each pass declares what it reads from the model and what it adds") and, for seed and
gap rules, `origin`. Each family's `index.ts` exports an unordered record; `rules/index.ts` concatenates
them. Every ordered list lives in the profile's `Pipeline`: `seed`, `harvest`, `queue`, `walk`, `bl`,
`validity`, `accept`, `claim`, the gap slots and `region`. A registry test requires every rule to sit in
exactly one slot. Signature placement rules have their own registry in `core/signatures/rules/`, merged
with the analysis registry only for `explain`. A rule file never imports another rule file.
`bench ablate <rule>` re-runs without one rule.

**Consequences.** About 60 small files with one unit test each. Adding a rule touches its file, its
family index and one profile slot. Reordering is a diff of profile data, and nothing depends on import
order. `core/provenance` keeps only the `RuleId`, `Provenance` and trail types.

**Revision (17 October 2026, findings clean-architecture-10, -13, plan-fidelity-15a).** Moved metadata
into the rule file, made every order explicit profile data, added `reads`/`adds`, and gave signatures
their own registry.

**Rejected.** One file per family (the most complex PoC logic stays in one growing file). Untyped
proposer interfaces. Rules with no rationale field. Order by registry position (hidden, changes bench
rows on an import reorder).

## D8. One driver, two modes: `discover` and `confirm`

**Context.** The plan: "every function entry is listed" in the TOML, and "discovery still runs on every
`generate`, but only to report". Treating TOML entries as just another seed lets a tool upgrade add or
drop a split silently. In the PoC a reading stops at an accepted function and a `bl` is a call when its
target is accepted, so both depend on what has been accepted when the reading is taken.

**Decision.** `discover` (analyze, init, analyze --update, bench) accepts what the rules accept.
`confirm` (generate, model, verify, explain in a project) seeds exactly the TOML's `[functions]`, and
`isFunction(a)` is true for every listed entry from round 0. A listed entry's extent is its TOML `size`
when given, else its reading under that fixed set, cut at the next listed entry that is not a label.
A listed entry that fails validity is honoured (`W_LISTED_INVALID`); harvest and gap rules run and their
acceptances become `UnlistedFinding`s and `W_UNLISTED_FUNCTION` without claiming anything.
`g2.confirm-equals-discover` compares the two on all five tuning ROMs in phase 2; if they differ, a final
`resettle` stage in discover, run in both modes, is the remedy.

**Consequences.** The split of a project changes only through a TOML edit, and the equivalence of the
two modes is proven in the phase that builds the driver, not two phases later.

**Revision (17 October 2026, finding feasibility-and-performance-9).** The first version left
`isFunction` undefined in confirm mode and tested confirm only at phase 4 through
`g4.generate-idempotent`. Added the definition and the phase-2 gate.

**Rejected.** Config entries as ordinary seeds in one mode (silent split changes). A `settle` stage that
resumes discovery with seeds (reorders acceptance inside the phase-2 port).

## D9. One proposal shape; the TOML decides and records the source

**Context.** The PoC applies signatures at every `generate` and rewrites the TOML. The first version of
this architecture had three proposal shapes (a TOML patch from signatures, seeds and overrides from
evidence, module configs from inference) and kept the source only as a TOML comment, so `explain` could
not say where a name came from without re-running the matcher.

**Decision.** Signatures, evidence, legacy import and module inference all return `Proposal[]`
(`core/proposals`), each with a `ProposalSource`. `core/config/patch.ts` is the only `planPatch(text,
config, proposals)`; `init` folds proposals into the config it serialises. A persisted source is a
`from` key (`from = "sig:m4a@2001"`, `"evidence:trace"`, `"legacy"`), data rather than a comment.
`NameSource` carries it, and `explain` reads it. `analyze --update --write` renames only entries that
still carry a default name; `rename` removes `from` because the name is then the user's. `generate`
never loads signatures or evidence.

**Consequences.** The TOML is the single source of decisions and of their provenance; labels cannot
drift; a rename survives every run; signatures no longer import the config module.

**Revision (17 October 2026, finding clean-architecture-7).** Replaced the comment `# m4a 2001` with the
`from` key and unified the proposal shapes.

**Rejected.** Precedence "TOML unless default, then signature" at generate time (drift, R3 conflict).
Applying signatures at generate and writing the TOML (R3 violation). Renaming by recorded source
(a hand rename that kept `from` would be overwritten).

## D10. Port semantics first under the PoC's LIFO order, then switch order in one commit that may only improve

**Context.** The PoC's worklists use `work.pop()` (LIFO). Proposals said both "worklists are ascending"
and "parity with the PoC", which cannot hold at once.

**Decision.** `AnalysisTuning.worklist` is `'poc-lifo' | 'ascending'` (internal API). Phase 2 reaches
parity under `'poc-lifo'`; milestone M4 switches the default to `'ascending'`, a min-heap whose key is the
total order `(addr, modeRank, ruleRank, seq)`, and enables the property test that permutes seed and
TOML order. M3 (register-tracked table jumps), M4 and every later rule change must pass `bench regression
--base <previous milestone>` with no exemption; `bench/baseline/accepted-diffs.json` may record only
improvements against the PoC baseline (a row removed, an extent that now agrees), each with commit and
reason, and an improvement that no longer differs from the baseline fails as stale. `'poc-lifo'` is
deleted before phase 2 lands.

**Consequences.** "The refactor broke something" and "the order changed something" are separate,
reviewable events, and neither can trade a regression for an improvement. Ties are ordered, so the heap
implementation cannot choose an origin.

**Revision (17 October 2026, findings plan-fidelity-7, feasibility-and-performance-11).** The first
version accepted every moved row with a reason, a third exception channel the plan does not have, and
left heap ties unordered.

**Rejected.** Ascending from the start (parity unprovable). Keeping LIFO forever (results depend on seed
insertion order). Accepting any moved row with a reason (contradicts "raw numbers only improve").

## D11. A frozen results baseline and local PoC dumps, not a copy of the PoC in the repository

**Context.** One proposal copied the PoC sources into `test/oracle/`; another exported baselines to a
gitignored cache nobody else could review.

**Decision.** `bench/baseline/poc-2026-10-16.json` (the PoC's `results.json` rows) is committed.
`bench/tools/export-poc.ts`, run with the PoC's own `tsx` from its read-only checkout, writes the
PoC's runs to the gitignored `bench/.local/poc/`; the sha256 of each parity view is committed in
`bench/baseline/poc-digests.json`. Differential checks against the PoC's decoders run in
`test/local/` when `ROMLIFT_POC` is set.

**Consequences.** No throwaway code in the clean repository; the equivalence bar is reviewable (rows)
and reproducible (digests) by anyone with the ROMs. The dumps stay local because they are derived
from ROMs.

**Rejected.** `test/oracle/` copy (commits throwaway code). Uncommitted baselines (not reviewable).

## D12. Compiler knowledge is a profile: named fields, idioms as functions, order as data

**Context.** The PoC spreads constants through `analysis.ts` (`FAR_MIN = 1536`, a 40-instruction table
look-behind, `0x400`, `2048`, `0x10000`, `extent >> 4` with a floor of 8, a 4,096-byte backward window,
16-word ARM front pools, slack 3, pointer-table run 3, a 600-round settle cap). The first version typed
these fields as literals (`minDistance: 1536`), so no second profile could typecheck, put the profile
type inside the analysis where the model could not read alignment, and kept the PoC's table look-behind
under the plan's name for register tracking.

**Decision.** `core/profile/types.ts` defines `CompilerProfile` with `number` and `boolean` fields
(`farJump`, `tableJump`, `density`, `gapScan`, `pointerTableRun`, `tinyFunctionInsns`, `alignment`,
`misfitThreshold`), the `Pipeline` of every rule order (D7), and idioms as functions over context
(`isPrologue`, `isPadding(rom, addr, next)`, `matchTableJump(insns, cursor, rom)`, `matchFarJump`).
`ProfileId` is a string key of `core/profile/registry.ts`; `agbcc` ships. Rules read the profile only
through the view. The parity rule is named for what it does, `walk.table-nearest-pool-load`; milestone
M3 replaces it with `walk.table-by-register`, which tracks the register that reaches `mov pc`/`add pc`
back to its pool load, and deletes `lookBehindInsns`. Safety bounds that are not compiler knowledge live
in `core/analysis/limits.ts` and raise diagnostics (`W_SETTLE_LIMIT` keeps the last reading, as the PoC
does); invariant errors are reserved for broken internal invariants. Signature matching constants live
in `core/signatures/policy.ts`. `g2.second-profile` runs a dummy profile with other numbers and another
validity order on every fixture.

**Consequences.** A second compiler profile is a new object, not a code search; changing a constant is a
one-line diff with its bench diff; the plan's table-jump rule is actually implemented.

**Revision (17 October 2026, findings clean-architecture-4, plan-fidelity-2,
feasibility-and-performance-13).** Widened the types, moved the type below the analysis, made the
idioms functions, added the registry and the dummy-profile gate, renamed the parity table rule and
scheduled register tracking, and turned the settle cap from a crash into a diagnostic.

**Rejected.** Constants inline in rules (invisible to review). A TOML `[analysis]` table for them
(per-project tuning hides overfitting, see D22). Literal-typed fields (a profile in name only).

## D13. Performance from the measured hotspot first; epoch semantics; no capacity-bound cache

**Context.** The first version assumed the PoC's 19 s on sa3 came from `forgetCandidates()` dropping
readings each round, and planned dependency-tracked readings in 256-byte buckets, anchor subscriptions
and a 50,000-entry LRU, with "the same digests" as the wholesale mode. The review profiled the PoC with
`node --cpu-prof`: on sa3, 17.35 s of 18.6 s is `looksLikePointerTable`, whose loop condition re-runs the
`codeEnd` getter (which iterates every instruction) on each pass; the run makes only 8,542
`analyzeThumb` calls. FE7J (10.6 s) and Emerald (6.0 s) spend 59.5% and 39.6% there. The PoC also
deliberately reuses a reading within a round after later acceptances, and its dependencies are not
local (`bl` verdicts read the whole function set, `couldBeCode` settles callees recursively,
`inPointerTable` reads neighbours' validity), so bucket invalidation or LRU eviction changes results.

**Decision.** Epochs are the semantics: an epoch begins at every `grow` round and every `fillGaps`
call; within it a reading or validity verdict is reused; at its boundary non-accepted readings and the
validity memo are dropped, intrinsic failures and accepted readings kept. Milestone M2 is
profile-driven: (a) compute `codeEnd`, `end` and the extent once per immutable reading, a change that
keeps the digests; (b) re-measure with `bench speed`; (c) only if a ROM still misses the budget, the
internal `epoch-reuse` mode carries a reading across a boundary when every fact it read is unchanged,
with digest equality to `epoch` on all five tuning ROMs. No cache evicts by capacity. `bench run
--cpu-prof` backs every performance claim.

**Consequences.** Digest equality between cache modes is a real invariant. The riskiest machinery is
built only if a measurement asks for it.

**Revision (17 October 2026, findings feasibility-and-performance-1, -3).** Replaced the bucket
invalidation, anchor subscriptions and LRU of the first version, whose "same digests" claim could not
hold, with the measured fix and epoch semantics.

**Rejected.** Dependency buckets and anchor subscriptions as the default (they fix a problem the profile
does not show and change results). An LRU (results depend on its capacity). Declaring incremental
invalidation a semantic change with accepted diffs (would reopen the exception channel D10 closes).

## D14. A text parser and in-process round trip; no separate "select" re-implementation

**Context.** The plan: "a mnemonic is printed only when the built-in encoder turns that text back into
the same bytes". One proposal had no parser and checked operands through a `select.ts` that
re-implements GNU `as`'s encoding choice, so formatter text bugs would surface only in the CI corpus.

**Decision.** `parse.ts` reads exactly the grammar `format.ts` writes; `assemble.ts` chooses the
encoding GNU `as` would choose for the parsed text (row `asPriority` and constraints);
`roundTrips(insn) = assemble(parse(format(insn))) === insn.word` runs in process for every printed
instruction. The corpus proves `assemble` agrees with real `as` on two binutils versions.

**Consequences.** The printed string itself is verified at every run; a formatter bug becomes a raw
fallback, not a wrong build. The GNU `as` choice model lives in one place and is tested against `as`.

**Rejected.** Operand-only checks (miss text bugs). Shelling out to `as` at every run (slow, makes
output depend on the user's binutils).

## D15. A short Thumb branch across a user-moved border prints raw, pending the owner's approval

**Context.** Thumb `b`/`bcc` across objects needs `R_ARM_THM_JUMP11`/`JUMP8` relocations, whose support
and range differ by binutils version. The plan's printing rule says "every branch target, pool word and
table gets a label, so no branch or load is left as raw data". The first version justified printing such
branches raw by citing R4, which is about regeneration and gitignore, not about branches.

**Decision.** `core/layout/borders.ts` makes a border that a short branch crosses illegal, so `init` and
`analyze --update` never create one and every branch they produce is symbolic, as the plan says. Only a
border the user moves by hand can split a short branch; that branch prints as `.inst.n` with the target in
the comment (`'cross-module-short-branch'`, `W_CROSS_MODULE_SHORT_BRANCH`) and is counted in the
readability family. This exception is listed for the owner's approval in architecture §12; the
alternative is to make such a border an error.

**Consequences.** The plan's rule holds for everything romlift generates by itself; the one exception is
caused by a hand edit, visible, counted, and awaiting a decision.

**Revision (17 October 2026, finding plan-fidelity-15b).** Re-based the rationale on the plan's printing
rule, added the border-legality condition, and listed the exception for approval.

**Rejected.** Always symbolic (a link that may fail on some toolchains). Printing depending on the
`doctor` probe (output would depend on the machine). The R4 rationale (cites the wrong requirement).

## D16. Zero padding prints as `.align 2, 0`

**Context.** One proposal printed alignment directives only "where the layout proves they reproduce
the padding". The plan prints zero padding as `.align 2, 0` so pools stay aligned while a neighbouring
C function has the wrong size.

**Decision.** Follow the plan. Zero bytes up to a word boundary print as `.align 2, 0`; any other
padding is data with a comment.

**Consequences.** During decompilation, a C function of the wrong size shifts following code but loads
stay encodable; the final SHA-1 still decides.

**Rejected.** Raw padding unless proven (breaks pool alignment as soon as a C function changes size,
reversing a plan rule).

## D17. One emission stream, a pure write plan, and a mechanical shell with lock and journal

**Context.** Generated files, scaffold files and user C files need three different write policies. The
first version put the policy (manifest diff, generated roots, ownership refusals) and the self-checks in
`shell/project/write-tree.ts`, so the plan could not be tested without a file system, and it did not say
when the manifest is written or what happens when two runs or a crash interleave.

**Decision.** `FileEntry` is a discriminated union over `ownership: 'generated' | 'scaffold' |
'reconciled'`, plain data. `emitTree` produces entries module by module. The pure
`core/write-plan/plan-writes.ts` turns entries, the manifest, a digest snapshot of the disk and the
reconciled files' texts into `WriteOp`s, owning every policy (the generated roots, `E_PATH_NOT_OWNED`,
`W_UNOWNED_FILE`, the no-manifest rule, scaffold write-if-absent, reconciled edits only on an unchanged
base). The shell snapshots, calls it and applies the ops: it takes an exclusive `.romlift/lock`
(`E_PROJECT_LOCKED`), writes a journal before the first op, applies each op through temp and rename,
writes the manifest last, and deletes the journal; a later run finishes an interrupted one from the
journal. `--dry-run --json` prints the ops; `--out <dir>` applies them elsewhere. `DecompState` is
derived by the workflow from C texts the shell passes in.

**Consequences.** Every policy has unit tests without a disk; the shell is mechanical; a crash or a
concurrent run cannot leave the manifest out of step; a test injects a failure after every k-th op.

**Revision (17 October 2026, findings clean-architecture-8, feasibility-and-performance-14).** Moved the
policy and the checks out of the shell, and added the lock and the journal.

**Rejected.** Render closures (not serialisable). Rebuilding the manifest from disk (adopts stale files
as owned). C state in the layout stage. Policy in the shell (untestable without files).

## D18. No stage cache, artifact replay or structural `diff` command

**Context.** One proposal added replayable stages (`--from model.json`), a `romlift diff` command and
a `.romlift/cache/<stage>/<key>.json` cache in user projects, all built in phase 1.

**Decision.** None of the three. Speed comes from the analysis itself (D13); review of changes comes
from `bench diff` over the committed results.

**Consequences.** No codecs, cache keys or stage versions to keep correct; one less source of wrong
output. `generate` on Emerald re-runs the analysis each time (budget ≤ 10 s).

**Rejected.** The stage pipeline (scope the plan does not contain, infrastructure before parity, and
cache-key correctness as a new failure mode).

## D19. Plain-data public types, streamed canonical JSON, and a struct-of-arrays model

**Context.** Phase 3 work should start before phase 2's port is finished, and the plan makes the model a
public API (`model --json`). The first version's `Model` held the `Rom` (methods and the whole byte
array) and items holding `InsnSpec` (functions), so the JSON differed from the exported type; it built
one object per instruction and one JSON string per artifact, which a 32 MiB ROM would push towards V8's
string limit.

**Decision.** `core/analysis/codec.ts` and `core/model/codec.ts` encode `AnalysisResult` and `Model` as
canonical JSON (sorted keys, hex addresses), produced as a stream of string chunks and hashed
incrementally by the shell. Every public type is plain data: `Model.rom` is `{sha1, end}` and the `Rom`
is passed separately; an `Insn` names its row by `specId`; items live in an `ItemTable` (struct of
typed arrays) decoded lazily by `itemAt`; `model --json` is NDJSON (a header, then one line per chunk),
with `ModelJsonHeader` and `ModelJsonChunk` exported as the public contract. `AnalysisResult` is a union
discriminated on `mode`. `FunctionFact` is span-level; instructions are re-decoded by the model. Fixture
analyses are committed as goldens and are the phase-2/3 seam.

**Consequences.** The TypeScript type and the JSON agree; asmlift and Mizuchi read the same contract;
memory stays bounded on large ROMs (`g3.large-rom`).

**Revision (17 October 2026, findings clean-architecture-14, feasibility-and-performance-10).** It replaces the first version, whose shape the context above describes.

**Rejected.** Codecs for every intermediate (D18). One object per instruction (memory). One JSON string
per artifact (string-length limit).

## D20. Module inference in `core/layout`: libraries, assembly-only ranges, then measured C chunks

**Context.** The plan: a module per recognised library, ARM code, unaligned entries and shared tails as
assembly-only modules, the rest "cut into chunks at function boundaries". The first version put
inference in `core/model` (forcing a model-to-signatures edge) and scheduled it in phase 4, while phase 3
already needed modules.

**Decision.** `core/layout/infer-modules.ts` returns module proposals: `rom_header`, `crt0`, one `asm`
module per `LibraryRegion` it is given (signatures pass them from phase 6), an `asm`-only module for
every range of ARM code, 2-mod-4 entries, shared tails or tiled holes, and `c` modules cut at legal
borders, closing a module at the first legal border past `--module-size` (default `0x10000`, measured on
the five tuning maps: the 90th percentile of C translation-unit size is 0xFF70 (kleod), 0x3D40
(Emerald), 0x20AC (sa3), 0x1840 (sa2) and 0x1228 (FE7J); the largest unit is 0x1D284 (sa3)). Legal
borders are word-aligned chunk starts that no short branch crosses (`core/layout/borders.ts`). With
`config-from-discover.ts` it lands in phase 3; phase 4 writes the same config to disk.

**Consequences.** A C module never contains code agbcc cannot produce; module size is an init option,
never an analysis constant; `start` stays easy to move; no circular phase dependency.

**Revision (17 October 2026, findings clean-architecture-12, feasibility-and-performance-8).** It replaces the first version, whose shape the context above describes.

**Rejected.** The PoC's `main`/`main_2` split. An unmeasured default. One C module per contiguous agbcc
run. Inference inside the model.

## D21. C-defined data fails the link until phase 5

**Context.** The plan: "the first linker script places only `.text` … and the build fails loudly if a
C file emits `.rodata`, `.data` or `.bss`"; no proposal specified the mechanism.

**Decision.** The phase-4 `ldscript` collects each C object's non-text sections in a `NOLOAD` check
section and `ASSERT`s it is empty, with a message pointing at `AGENTS.md`. Phase 5 replaces it with a
data range per module.

**Consequences.** A decompiler who adds a C array gets a clear link error instead of a moved or
dropped section. `g4.c-data-fails-loud` proves the message.

**Rejected.** `/DISCARD/` (silently drops data). Placing C data anywhere (moves the ROM).

## D22. TOML schema 1: `[symbols]` absorbs `[data]`, `size` on functions, no `[analysis]` table

**Context.** The PoC added a `[data]` table and kept extents in its rewritten TOML; one proposal added
`[analysis] disable = []`.

**Decision.** Schema 1 as in architecture §6.5: `[symbols]` with `size` and `type` replaces `[data]`;
`[functions]` entries accept `size` (written by `init` for signature-restored extents); `[[overrides]]`
carry `kind`; `[signatures] enabled` is read only by `init` and `analyze --update`. Rules can be
disabled only on the command line of `analyze` and `bench`.

**Consequences.** One table per kind of name. No project can quietly switch a rule off to make its own
numbers look right.

**Rejected.** `[analysis] disable` (per-project tuning hides overfitting). Separate `[data]` and
`[symbols]` (two tables for one concept).

## D23. A line-level TOML patch planner that refuses rather than guesses

**Context.** `analyze --update`, `rename` and `import-legacy` must edit the TOML and keep comments;
smol-toml does not preserve comments.

**Decision.** `core/config/patch.ts` plans line edits of single-line entries against the canonical
layout `init` writes, re-parses the result and compares it with the intended config. A hand-restructured
table yields `E_TOML_PATCH_REFUSED` with the entries to paste.

**Consequences.** Comments and hand formatting survive; an unusual layout costs a manual paste, never a
corrupted file.

**Rejected.** Re-serialising the whole file (loses comments). A full comment-preserving TOML library
(none is mature enough to depend on).

## D24. The bench scores a seedless discover run and judges signatures afterwards

**Context.** The PoC README: "the benchmark scores the analysis first and the signatures after, so
library knowledge never flatters the agnostic numbers."

**Decision.** `bench run` scores `discover` with no TOML, signature or evidence seeds; signature
placements are judged in a second step against the same ELFs. Every dataset counts entries and ELF
functions from the end of the startup region.

**Consequences.** Precision and recall measure the library-agnostic rules only.

**Revision (17 October 2026, findings plan-fidelity-15f, plan-fidelity-12).** "Engine-agnostic" replaced
by the owner's term; the startup exclusion is stated for every dataset, held-out included.

**Rejected.** Scoring `init`'s output (signature names and extents would inflate the numbers).

## D25. Held-out ROMs run sealed and are judged by classifiers that cannot hide a glued function

**Context.** The plan's phase-2 gate: "the same gates on at least two ROMs never used to tune the
rules". A sealed ROM has no exception lists, so a sealed run needs classifiers. The first version called
any miss inside a found extent a `label-candidate`, which is exactly the geometry of the failure the plan
fears most: a missed split that glues a real function onto its neighbour.

**Decision.** A dataset has `heldout: true` from creation and an append-only `revealed[]` log; it counts
as held-out only while `revealed` is empty. Sealed runs store counts and verdicts only. A miss M is a
`label-candidate` only when it lies inside the extent of a found function F whose entry is an ELF
`FUNC`, M does not open with the profile's prologue, and (a) M follows a `bl`/`swi` of F judged
never-returning, or (b) M is the target of a `b`/`bcc` (never a `bl`) inside F, or (c) M lies in one of
F's tiled holes or ARM mixer ranges: the plan's three meanings of a label. Every other miss is `glued`
and fails the ROM. Per ROM: raw precision ≥ 99.7%, raw recall ≥ 99.46% (the tuning floor), zero
`glued`, label candidates ≤ 11 (the tuning maximum), extents ≥ 99.9%, code end within 16 bytes, with
startup entries excluded as on the tuning set. False entries are classified (`startup`, `veneer`,
`adr-callback`, `inside-elf-function`). `--reveal` prints rows to stdout only and appends to `revealed`;
the provenance check rejects held-out rows in `results.json`; `bench adopt` refuses a sealed dataset. A
synthetic test suppresses a split and requires the miss to classify as `glued`.

**Consequences.** `g2.held-out` is passable without anyone looking at the ROM's addresses, cannot be
passed by gluing, and tuning on a held-out ROM is visible in Git.

**Revision (17 October 2026, findings plan-fidelity-1, testing-and-verification-2, plan-fidelity-12).**
The plan-fidelity reviewer also asked that "the containing function's ELF-sized prefix agrees"; that is
replaced by "F's entry is an ELF `FUNC`", because the ELF sizes of hand-written parents (kleod's
`SoundMainRAM`) end at the very labels being judged, so a size condition would reject the plan's own
example of a label.

**Rejected.** Sealed runs judged by the tuning lists (unpassable). Precision-only held-out gates. The
first version's inside-extent rule (passes glued functions).

## D26. The six unreviewed rows are classified in phase 2 and a misnamed category is replaced

**Context.** The plan requires zero `unreviewed` exceptions. Six rows remain (Klonoa `0x0804F73E`,
five on FE7J); the 16 October review classified them but the lists were not rewritten, and it found
that FE7J's six `continuation-after-noreturn-call` labels follow `bl _call_via_r0`, which returns.

**Decision.** Phase 2 milestone M5 adds categories `second-entry` and `untyped-leaf`, replaces
`continuation-after-noreturn-call` with `split-after-returning-call` ("the truth's own disassembler
split after a `bl` whose callee returns"), and rewrites the rows as architecture §8.3 lists, each
confirmed with `bench explain`. `g2.no-unreviewed` gates it.

**Consequences.** Categories describe what the rows are; the vocabulary test removes a definition no
row carries.

**Rejected.** Copying the rows verbatim and leaving the debt (fails the plan's goal 4). Keeping the
misnamed category (it describes the truth's error as a continuation).

## D27. Provenance by content digest over every input of a verdict, and a committed gate record

**Context.** The plan's CI check compares `meta.commit` with the PR head and treats any change under the
PoC's `src/` (scorer included) as invalidating. The first version's digest covered `src/**`,
`signatures/**`, `templates/**` and `package-lock.json` only, so editing the scorer, a classifier, an
exception list or a gate left an old artifact "valid", and CI could not tell whether the real-tier gates
had passed at all.

**Decision.** `meta.sourceDigest` = sha256 over the sorted contents of `src/**`, `signatures/specs/**`,
`templates/**`, `bench/src/**`, `bench/tools/**`, `bench/dataset/**`, `bench/baseline/**`,
`test/gates/**`, `package.json`, `package-lock.json`, `tsconfig*.json`, plus the Node major version.
`meta.toolchain` and `meta.inputs` record the agbcc commit, binutils and objdiff-cli versions, ROM sha1s,
ELF and object digests and the PoC source digest; `meta.families` records which families ran per ROM.
`bench gates --tier real` writes every real gate's verdict into the artifact. `provenance.yml` fails on a
digest mismatch, on a real gate of a landed phase that is not `pass` or `historical`, on a gated family
missing for a tuning ROM, on a dataset row the artifact never judged, and on held-out rows. Volatile
values go to the gitignored `bench/timings.json`.

**Consequences.** A rebase that does not change any verdict input keeps the artifact valid; a change to
the scorer or a list forces a re-run; `main` carries a verifiable record that the real gates passed.

**Revision (17 October 2026, findings plan-fidelity-6, feasibility-and-performance-6,
testing-and-verification-4).** It replaces the first version, whose shape the context above describes.

**Rejected.** Commit diff plus dirty failure (brittle across rebases). A digest of the product sources
only (a loosened scorer passes).

## D28. Synthetic fixture builds are committed and re-verified by a CI rebuild of what matters

**Context.** Building agbcc on every CI run slows every job and makes unit tests depend on the toolchain.
ELF bytes include metadata (`.comment`, section and string-table order) that differ between Ubuntu apt
and Homebrew binutils while the `.gba` bytes stay equal.

**Decision.** Each self-authored fixture's `build/<name>.gba` and `.elf` (a few KiB) is committed, and
`build.mk` records the agbcc commit and the `as --version` string. `fixtures.yml` builds agbcc at the
pinned commit, rebuilds every fixture, and compares the `.gba` bytes and the sorted
`(name, value, size, type)` list of the ELF symbol table, and checks the toolchain record.

**Consequences.** Unit and golden tests need no toolchain; the committed bytes are proven reproducible
without false failures from binutils metadata. These are our own sources, so the no-ROM rule does not
apply.

**Revision (17 October 2026, findings feasibility-and-performance-15, testing-and-verification-15).** It replaces the first version, whose shape the context above describes.

**Rejected.** Building on every run (slow). Committing without a rebuild check (drift). Raw ELF
comparison (fails across binutils builds for no reason).

## D29. Gates are executable tests from day one, with five verdicts

**Context.** A gate written as prose leaves "is the phase done?" to judgement. One proposal exported a
`capabilities` list from `src/index.ts`. The first version had no verdict for a missing local input, and
its CLI registry read `test/gates/phase.json`, a test file the published package does not contain.

**Decision.** Each gate is `test/gates/gN.<name>.test.ts` with `{id, phase, tier, needs, inputs,
historicalAfter, run}`. Verdicts: `pass`, `fail`, `pending` (a name in `needs` is not exported),
`unavailable` (an input is absent or its digest differs; the input is named) and `historical`
(PoC-parity gates after phase 2 lands, evidence committed). `bench gates --require N --tier T` fails on
any `pending`, `fail` or `unavailable` gate of phase ≤ N and prints every verdict with its input digests.
`phase.json` holds `landed`; raising it is the merge act of a phase. The CLI registry lists implemented
commands and knows nothing of phases; vocabulary and code checks that depend on later phases are gates
with `needs`, so they report `pending` rather than fail.

**Consequences.** Phase completion is a command's exit code; a clean clone without ROMs cannot pass the
real tier vacuously; the product API and the shipped CLI carry nothing for tests.

**Revision (17 October 2026, findings testing-and-verification-5, clean-architecture-9,
feasibility-and-performance-5, feasibility-and-performance-6).** It replaces the first version, whose shape the context above describes.

**Rejected.** Prose gates. A `capabilities` export. A `phase` field on `CommandSpec` (the shipped CLI
would depend on a test file). Skipping a gate whose input is absent (passes vacuously).

## D30. CI runs on Linux and macOS, two Node versions, and a varied environment

**Context.** The plan requires byte-identical output on Linux and macOS. Varying only the process misses
leaks through the working directory, time zone, locale and paths.

**Decision.** `ci.yml` runs on `ubuntu-latest` and `macos-latest` with Node 22.18 and 24. The determinism
gates run the second process with another working directory and project path, `TZ=Pacific/Kiritimati`
and `LANG=tr_TR.UTF-8`, and assert that no generated file contains the project's absolute path. Each job
uploads the synthetic-tier analysis and tree digests, including the deterministic 32 MiB synthetic ROM,
and a final job fails when they differ.

**Consequences.** Cross-OS and environment determinism is checked on every PR on inputs large enough to
exercise sorting and caches.

**Revision (17 October 2026, finding testing-and-verification-13).** It replaces the first version, whose shape the context above describes.

**Rejected.** Recording `treeHash` for manual comparison (nobody compares). Shuffling directory listings
under a product test flag (D5).

## D31. Signature schema 3 with object-qualified member ids; the PoC's files converted, then rebuilt to match

**Context.** Statics repeat across libgcc objects (`_fpadd_parts` in `fp-bit.o` and `dp-bit.o`); the PoC
suffixes one ad hoc. One proposal rebuilt signature files from scratch, discarding the PoC's validated
files.

**Decision.** Schema 3: members keyed by `MemberId = name@object.o`, display `name` separate (the
reviewed name from the spec when there is one), `builtWith` recorded. The PoC's files are converted
mechanically to schema 3 into the gitignored `bench/.local/`; `g6.signatures-rebuild` requires `signatures
build` on the specs to reproduce those converted files exactly (apart from reviewed names, which the spec
lists), to be deterministic across two builds, and to reproduce the library fixture's committed golden.

**Consequences.** Validated data is kept and the builder is proven against it without committing bytes
read from commercial ROMs (D40).

**Revision (17 October 2026, findings plan-fidelity-5, plan-fidelity-14).** The comparison target moved
from committed files to local converted files, and reviewed names were added.

**Rejected.** Schema 2 with suffixes (ad hoc, collides again). Rebuilding without a comparison (loses the
PoC's validation).

## D32. Signatures stay in phase 6, with serial libraries and BIOS stubs, from tuning references only

**Context.** The plan places signatures in phase 6 and allows moving m4a earlier. The plan's phase-6 work
items include the serial libraries and the BIOS call stubs. The first version planned serial-library
signatures from FireRed's references "when they become tuning data", which rewards revealing a held-out
ROM.

**Decision.** Phase 6 builds `m4a`, `libagbsyscall`, `libgcc`, and the serial libraries the tuning
references link (`agb_flash`, `siirtc`, `librfu` from Emerald). `g6.no-heldout-references` fails when a
spec names a sealed dataset. Specs carry reviewed names (member id to chosen name, with a reason), applied
by the builder, so `g6.signatures-rebuild` still holds after a review; reviewing names across references
(for example `ply_*` against `MP2K_event_*`) is a phase-6 work item. Moving signatures to phase 2 or 3
touches only `core/signatures`, `propose.ts` and the `LibraryRegion` input of `infer-modules`.

**Consequences.** Phase-4 scaffolds are byte-exact without library modules; library names arrive in
phase 6; no held-out ROM is ever a reference.

**Revision (17 October 2026, findings plan-fidelity-11, plan-fidelity-14).** It replaces the first version, whose shape the context above describes.

**Rejected.** Pulling signatures into phase 2 by default. Building from held-out references.

## D33. Closed diagnostic codes with symbolic names; four exit codes

**Context.** Agents read diagnostics as JSON; proposals used either `RLnnnn` numbers or symbolic names
and different exit codes.

**Decision.** Codes are symbolic (`E_…`, `W_…`) from one closed list with documented meanings; exit
codes 0 ok, 1 error diagnostics (including a refused write), 2 usage, 3 verification failure, 70
internal invariant.

**Consequences.** A code reads without a lookup table; scripts can tell "your input is wrong" from
"the tool is wrong".

**Rejected.** Numeric codes (opaque). Exit 2 for refusals (conflates usage and safety).

## D34. The objdiff readability gate stays in phase 3, with a defined oracle

**Context.** The plan puts "objdiff score 0 on every function" in the phase-3 readability family. objdiff
compares relocatable objects symbol by symbol; the first version named neither the target objects nor the
pairing, and romlift's default names would pair with nothing in the reference.

**Decision.** `g3.objdiff` runs objdiff-cli at the version pinned in `bench/tools/objdiff.version` (part of
the source digest). Targets are the reference project's own relocatable objects from its build directory
(the dataset records `objectsDir` and its digest); the base is the emitted function `.s`, assembled, with
labels renamed to the reference ELF's names by address. Only functions that agree in entry and extent are
scored. Score 0 means 100.0% match and zero relocation differences; a relocation whose reference side
targets a section symbol is counted `unnamed-target` and reported; any other difference fails. A fixture
test misnames a pool word and requires a failure. The gate runs on every tuning ROM whose readable build
links; the share metrics run on all five. The text-layout self-check (D49) is the per-function proof on
every run.

**Consequences.** The plan's phase table holds, and the gate means something precise.

**Revision (17 October 2026, findings testing-and-verification-10, feasibility-and-performance-8,
plan-fidelity-8).** One reviewer proposed moving objdiff to phase 5, where `expected/` exists; that is
not needed, because the targets come from the reference build, not from romlift's `expected/` writer.

**Rejected.** Deferring to phase 5 (reinterprets the plan's phase table). Targets built from the linked
ELF without relocations (every relocated word would differ).

## D35. `explain` re-runs the analysis the command would run, and is composed by layer

**Context.** Storing a full trail costs memory on Emerald-size ROMs; replaying discover explains the wrong
run when the project is in confirm mode. The first version defined one `ExplainReport` in the analysis
layer with fields from the model, the names and the signatures, which are later layers and phases.

**Decision.** `explain` re-runs confirm mode inside a project (discover on a bare ROM) with
`trail: 'full'` and a `trailFilter` around the address. `core/analysis/explain.ts` returns
`AnalysisExplanation {addr, claim, owner, events, rules}`; `core/workflow/explain.ts` composes
`ExplainReport` by adding `item` and `chunk` (phase 3), `name` (phase 4) and `signature` (phase 6, read from
the TOML's `from` key, never by re-running the matcher in a project).

**Consequences.** It explains exactly what `generate` emitted, with bounded memory, and each part ships in
the phase of the module that produces it.

**Revision (17 October 2026, finding clean-architecture-2).** It replaces the first version, whose shape the context above describes.

**Rejected.** A persistent trail (memory). Replaying discover for a project. One report type in the
analysis layer (breaks the layer rule and "nothing ships before its phase").

## D36. `core/workflow` composes, and nothing in core imports it

**Context.** Commands compose analysis, model, emit, verify and the write plan. One proposal's
`core/pipeline` imported everything and owned every named pipeline, the shape of a future god module.

**Decision.** `core/workflow/` holds one file per command workflow (`init`, `generate`,
`analyze-update`, `rename`, `import-legacy`, `explain`, `discover`), composition only; no core module
imports it. Workflows return plans (an emission stream with its checks, a TOML patch, an edit list, a
report). The shell reads inputs, calls one workflow, calls `planWrites`, and applies the ops; it decides
nothing.

**Consequences.** Every workflow and every write policy is testable in memory; logic cannot accumulate in
a hub because hubs have no importers inside core and each file does one command.

**Revision (17 October 2026, finding clean-architecture-8).** Stated that policy lives in
`core/write-plan`, not in the shell.

**Rejected.** Composition in the CLI (untestable without files). A shared pipeline module with stage
registries (D18).

## D37. The bench and the gate tests use only the public entry points, including `romlift/internal`

**Context.** One proposal let the bench import shell internals. The first version then forced every bench
need (ablation, PoC-parity modes, trail filters) into the public, semver-covered API.

**Decision.** `bench/src/*`, `test/gates/*` and `test/local/*` import `romlift`, `romlift/node`,
`romlift/isa` and `romlift/internal` by package self-reference, nothing else from `src/`.
`romlift/internal` exports `AnalysisTuning` (worklist, cache mode, disabled rules, the lockstep oracle)
and `analyzeTuned`, documented as outside semver; the CLI uses it only for `--disable`. The public
`AnalysisOptions` carries mode, seeds, overrides and trail only, and `AnalysisResult.options` records only
those.

**Consequences.** The public API is enough for asmlift and Mizuchi and carries no test machinery; the
bench still never reaches into private modules.

**Revision (17 October 2026, finding clean-architecture-9).** It replaces the first version, whose shape the context above describes.

**Rejected.** Shell imports from the bench (private API dependence). Tuning knobs in the public API.

## D38. Runtime dependencies: smol-toml, zod, @match-kit/decomp-yaml

**Context.** The plan: "runtime dependencies stay at a TOML library and little else".

**Decision.** `smol-toml` (parse), `zod` (schema), `@match-kit/decomp-yaml` (the decomp_settings
validator the PoC already uses). `@gba-kit/gba-node` is an optional peer dependency from phase 6. Core
may import these three because they are pure.

**Consequences.** Three small pure dependencies; everything else is in-repo.

**Rejected.** A comment-preserving TOML editor library (D23). Capstone or any native decoder (R2).

## D39. Branch per phase; merge to main only when the phase's gates pass

**Context.** The owner's git policy: work on a branch, merge to main and push only when a phase gate
passes.

**Decision.** `phase/<n>-<name>` branches with work-package branches under them; the merge to `main`
raises `phase.json` and requires `gates --require <n>` on both tiers. Commit messages end with the two
attribution lines in `AGENTS.md`.

**Consequences.** `main` always passes every landed gate.

**Rejected.** Trunk-based commits to `main` (an unfinished phase would be visible as landed).

## D40. Signature files are not committed until the owner decides

**Context.** The plan says signature files ship beside the tool. benchmark-roms.md forbids committing any
file derived from ROM bytes. Signature files contain masked bytes of m4a, libgcc and other libraries read
from commercial ROMs (the same code is public as source in the pret decomps). The first version shipped
them by default while the question was open.

**Decision.** Default to the safe side. Specs (references, object globs, reviewed names; no bytes) are
committed. `romlift signatures build` writes the files locally to the gitignored `signatures/*.json`,
from the reference checkouts named in the bench datasets; the package does not publish them; `init`
proceeds without them (`W_SIGNATURES_ABSENT`). `sig.*` explain goldens come from a self-authored library
fixture; no golden contains bytes from a real ROM. If the owner approves shipping, the files are added to
the package; the fallback the owner may prefer is hashed windows plus short unmasked anchors, which the
matcher can support without changing its placement ladder.

**Consequences.** Phase 6 can land without breaking an owner rule; users get library names only by
building signatures locally until the owner decides.

**Revision (17 October 2026, finding plan-fidelity-5).** Reversed the default from "ship" to "do not
commit".

**Rejected.** Deciding silently to ship (breaks benchmark-roms.md). Dropping signatures (breaks the plan).

## D41. Speed: a serial CPU-time ratchet in phase 2, an absolute budget in phase 3

**Context.** The plan's speed family is "within 1.5 times the committed time, a gate from phase 2". The
first version added an absolute 3 s per ROM on "the reference machine" to the phase-2 gate, measured wall
time while the bench runs ROMs in parallel threads and agents share the machine, and ratcheted against a
time every `bench run` rewrote.

**Decision.** `bench speed` measures one ROM at a time with no workers: a warm-up, then the median of five
runs, CPU time gated and wall time for information. `g2.speed` requires ≤ 1.5 × `bench/baseline/speed.json`,
which only the phase lead raises, only by a decision. `g3.speed-budget` requires ≤ 3 s CPU analysis per
tuning ROM, `generate` ≤ 10 s and `init` ≤ 15 s on Emerald. `speed.json` records a calibration workload's
CPU time; on another machine the thresholds scale by the ratio, so a reviewer can reproduce them.

**Consequences.** Performance has a measured target, a reproducible measurement, and does not block
phase 2 on a budget the profile-driven fix of D13 has not yet been shown to reach.

**Revision (17 October 2026, findings feasibility-and-performance-7, testing-and-verification-15).** It replaces the first version, whose shape the context above describes.

**Rejected.** A regression-only gate (the PoC's 19 s would become the norm). Wall time under parallel
load. A ratchet against the last run (drifts by 1.5^n).

## D42. Memory: bounded by structure, gated on a 32 MiB synthetic ROM

**Context.** The plan targets ROMs up to 32 MiB; no tuning ROM is larger than 16 MiB. The first version
bounded only the analysis arrays and measured the large ROM for information.

**Decision.** Accepted functions keep their readings; candidate readings live for one epoch (D13);
`cites` are capped at four; rejections keep the last per `(addr, mode)` with a count; two decode caches
(Thumb per halfword, ARM per word); the model's items are a struct of arrays decoded lazily; canonical
JSON is streamed and hashed incrementally; writers produce one module at a time and the write passes
keep only paths and digests. `g3.large-rom` requires peak RSS < 512 MiB for `init` and `generate` on a
deterministic synthetic 32 MiB ROM.

**Consequences.** Memory scales with ROM size plus accepted code, not with candidate churn or text size.

**Revision (17 October 2026, findings feasibility-and-performance-10, -13).** It replaces the first version, whose shape the context above describes.

**Rejected.** 1 GiB budgets (hide leaks). Gzip of in-memory artifacts (D18). An information-only
measurement (nothing would stop a regression).

## D43. Each phase opens with a frozen-interface component, then parallel components, then an integrator

**Context.** The first version's packages shared `src/index.ts`, `src/node.ts`, the CLI registry, a single
rule registry, a closed codes list and `bench/results.json`, so the "disjoint files" promise did not hold.

**Decision.** Component 0 (the phase lead) commits the phase's types, empty per-component barrels
(`src/api/<component>.ts`, `cli/commands/lists/<component>.ts`), empty family registries and codes files, and
the pending gate files; it must typecheck. Three to five components then own disjoint files, each in its
own `git worktree`, as roadmap.md lists, and each is proven alone (in phase 2 by lockstep against the PoC,
D48). Interface changes go through the phase branch. Only the phase lead, acting as integrator,
regenerates `bench/results.json` and `bench/baseline/speed.json`; no component commits them. Readability
scoring has its own file (`bench/src/readability.ts`).

**Consequences.** Merge conflicts concentrate in component 0 and the integrator; components can start the
day the phase opens.

**Revision (17 October 2026, finding feasibility-and-performance-4).** It replaces the first version, whose shape the context above describes.

**Rejected.** Sequential phases with one agent (slow). Parallel work without frozen types. Shared barrels
and registries edited by every package (constant conflicts).

## D44. Core never hashes; the shell computes and injects digests

**Context.** The ROM SHA-1, manifest hashes and artifact digests are needed; `node:crypto` is a Node
import, and a pure-TypeScript hash adds code to maintain. The write plan must compare new texts with disk
digests.

**Decision.** `shell/hash.ts` uses `node:crypto`, incrementally. `Rom.sha1` is passed in; core works with
digests as strings; where a pure plan needs to hash a text (`planWrites`), the shell injects a `hash`
function, and canonical JSON is a stream of chunks the shell hashes.

**Consequences.** `foundation` and `core` have no `node:*` import at all and stay browser-safe.

**Revision (17 October 2026, findings clean-architecture-8, feasibility-and-performance-10).** Added the
injected hash and streamed hashing.

**Rejected.** `node:crypto` in `foundation/util`. A pure-TypeScript SHA implementation.

## D45. Diagnostics: the mechanism in foundation, the codes in each module

**Context.** The first version froze `Diagnostic` in phase 1 with `provenance?: Provenance[]`, a core type
arriving in phase 2, and a closed `DiagnosticCode` list in foundation naming config, model, legacy and
signature codes, so foundation knew the project and the phase-1 package could not typecheck. A test that
fails on unused codes would have failed until phase 6.

**Decision.** `foundation/diagnostics` defines `Diagnostic<C>` with `cites?: Addr[]` and `rule?: string`,
and `defineCodes`. Each raising module owns `codes.ts`, landing with its first raiser;
`core/diagnostic-codes.ts` unions the core codes; the shell has its own. `RawReason` in the ISA holds
encoding reasons only; the model adds `'cross-module-short-branch'`, and unreached bytes are `data` items
with a note.

**Consequences.** Foundation has no project knowledge; every frozen phase-1 type typechecks; the
unused-code test never sees a code whose module has not landed.

**Rejected.** A generic payload parameter on `Diagnostic` (more type machinery than two plain fields). A
closed list with phase annotations (test data inside the product).

## D46. Load and run addresses from phase 2

**Context.** Code copied to RAM (Klonoa's `SoundMainRAM`, ROM 0x0804F318, runs at 0x03000388) is a phase-6
gate. With one address per instruction, a PC-relative load or a branch in that code resolves to the
wrong address, and retrofitting it would change types frozen in phases 1 to 3.

**Decision.** `AddressMap` (load ranges with their run address) lands in phase 2 as the identity. The walk
reads bytes at load addresses and computes targets in run space; `FunctionFact`, `Chunk` and `Module`
carry an optional `runAt`; a `Label` holds the run address. The `ldscript` writer links such a module at
its run address with `AT(<load>)` and defines `__load_<module>`. Phase 6 only fills the map from
overrides and traces.

**Consequences.** No frozen type changes when RAM code arrives; `g6.ram-code-mapped` tests behaviour, not
a retrofit.

**Rejected.** Adding run addresses in phase 6 (breaks frozen types). Linking RAM code at its load address
with run-space references printed as numbers (unreadable, and absolute self-references would not
relocate).

## D47. Build compilers per module

**Context.** The Klonoa repository compiles m4a with `old_agbcc`, eeprom with `old_agbcc -O1`, and has
per-function units with `-ftst` and `-fprologue-bugfix`. The first version had one global
`build.compiler = 'agbcc'` literal, so the `modules-mk` writer had nothing to write and the phase-5 switch
could not be expressed.

**Decision.** `[build] compiler` is the default; `[[modules]]` accept `compiler` and `cflags`.
`BuildCompilerId` is a key of an open registry (`core/config/compilers.ts`: `cc1` path, default flags,
Makefile rule template); `agbcc` and `old_agbcc` ship. `modules.mk` sets per-object target-specific
variables. An explicit rule in the user's `Makefile` (a scaffold file, the user's after `init`) takes
precedence over the pattern rule, which is how a legacy project keeps hand-written steps such as
Klonoa's `.include`d per-function units. `g4.multi-compiler` builds a two-compiler fixture. This is
separate from the analysis profile (D12).

**Consequences.** The plan's "per-module compiler choice" exists; Klonoa's switch keeps its special rules
in its own Makefile.

**Rejected.** Having `import-legacy` parse the legacy Makefile for compiler assignments (fragile; the
explicit rules already exist in that Makefile and keep working). Merging build compilers into the
analysis profile (different concerns: how to build against how the code looks).

## D48. The driver ports the PoC's control flow; rules are predicates and proposers at its call sites

**Context.** The first version froze a stage pipeline (`harvest` steps, gap rules returning one
`take` or `wait`, absorption as a claim rule at accept time) that cannot express the PoC: `grow()` is its
own until-stable loop over one candidate snapshot; `fillGaps()` keeps a cursor, a head, a shrinking end and
absorb steps inside the gap; validity has an optimistic memo and an intrinsic set that feeds harvesting.
Parity, the first milestone, depends on all of it.

**Decision.** `core/analysis/driver/` ports `run`, `grow`, `fillGaps`, `accept`, `settle` and `valid` nearly
verbatim. Rule contracts are the predicates and proposers those functions evaluate (§4.1 of the
architecture), each called at the PoC's call site; absorption is a gap step. The view exposes the driver's
validity service with the PoC's memo semantics. Only the slot orders are data (D7); stage control stays
code. export-poc records every rule-level query of the PoC (by wrapping its prototype methods at run time,
without editing a PoC file), and lockstep replays it: a family not yet implemented is answered from the
log, an implemented family is compared, and the first divergence is reported. Each component proves its
family alone on all five ROMs before integration.

**Consequences.** Parity is reachable without reopening frozen interfaces; packages are independent; the
order of stages can change only in a reviewed commit after parity.

**Rejected.** A data-only pipeline before parity (cannot express the PoC). Copying the PoC into the
repository as an oracle (D11). Per-rule replays with captured state snapshots (heavy, and lockstep gives
the same isolation).

## D49. A fourth self-check re-reads every emitted file

**Context.** The first version's three self-checks (tiling, re-encode, module size) run on the model,
before the writers; what writers add around an instruction (labels, `.4byte Func`, table entries,
`.align`, `.incbin` offsets, macro choice, mode directives) was proven only by a link, which CI runs on
tiny fixtures only. Plan R5: "every run self-checks it".

**Decision.** `core/verify/text-layout.ts` parses every `FileEntry` with `foundation/asm/statements.ts`,
resolves symbols from the model, lays each module out with `foundation/asm/layout.ts`, and requires the
bytes to equal the ROM range and each `.align` to emit exactly its padding; failure is
`E_SELF_CHECK_TEXT` and exit 3. Paths are checked for case-folded collisions in the same pass. The corpus,
the writers and the check share one dialect definition (`foundation/asm/dialect.ts`).

**Consequences.** Every `generate` on every ROM is a link-equivalent check without a toolchain; `verify
--link` and the SHA-1 remain the final proof.

**Rejected.** Relying on the link alone (a writer bug would surface first in a user's `make`). Running
`as` at every `generate` (makes output checks depend on the user's toolchain, D14).

## D50. Missing inputs are a verdict, and the PoC is pinned by content

**Context.** The PoC checkout has no commits; the first version had no verdict for a missing ROM or PoC,
so the real tier could pass vacuously from a clean clone or never again once the PoC moved; datasets
recorded no ELF digest although the reference builds carry local changes.

**Decision.** `unavailable` and `historical` verdicts (D29). `bench/baseline/poc-source.json` records the
sha256 of every PoC source file, and export-poc refuses another checkout. Datasets carry `elfSha256`,
`objectsDigest` and a build note; `bench run` refuses a mismatching ELF; `bench doctor-real` checks every
local input before a run. After phase 2 lands, the PoC gates are `historical`.

**Consequences.** A review can see exactly what ran and on which inputs; later phases never depend on the
PoC staying put.

**Rejected.** Committing the PoC (D11). Skipping absent inputs silently.

## D51. `import-legacy` keeps every legacy entry by default

**Context.** The plan lists, as the owner's decision, whether this repository should adopt the recovered
boundaries (drop the 283 cfg entries that are not ELF functions, add the 183 the list lacks), in one pull
request or module by module. The first version reported legacy entries inside found functions and did not
import them, which decides the question and would drop entries where Klonoa's decompiled C functions sit.

**Decision.** Keep mode is the default: every legacy entry is listed with `from = "legacy"`, nothing is
added, and the report names entries inside found functions, entries failing validation and unlisted
discoveries. In confirm mode every listed entry starts a chunk. `--adopt-boundaries` applies the recovered
boundaries when the owner chooses it. `g5.import-legacy` states its expectation in counts the tool can see
at Klonoa commit `693ccb7` (282 inside, 1 failing validation, 183 unlisted discoveries that are ELF
functions).

**Consequences.** The switch-over cannot break already decompiled functions, and the owner's question stays
open.

**Rejected.** Adopting by default (decides an owner question). Silently dropping or importing entries.

## D52. The Klonoa switch-over pull request is a phase-5 deliverable, pinned by commit

**Context.** The plan's phase-5 gate is that this repository builds without `generate_asm.py` and Luvdis,
and its work items include the pull request that switches it over. The first version gated a rehearsal in
a temporary copy of a moving, dirty working tree and called the pull request a separate deliverable.

**Decision.** `bench/migration/klonoa.json` pins `base` (`693ccb7`) and `switch` (the switch-over commit).
Both are checked out with `git worktree add`, never copied. `g5.klonoa-rehearsal` runs import, generate and
make at `base`; `g5.klonoa-switch` requires the `switch` commit to lack the four legacy tools and to build to
`klonoa-eod.gba: OK`. Re-pinning needs a commit that says why.

**Consequences.** Phase 5 cannot land while Klonoa still depends on the legacy tools; the result does not
depend on the day it runs.

**Rejected.** Copying the working tree (dirty, moving). Leaving the pull request outside the phase.

## D53. Held-out failure needs the owner; independence of the sealed ROMs is required

**Context.** `g2.held-out` needs two sealed ROMs to pass. Two of the three (pokefirered, pokeruby) are pret
Gen-3 siblings of a tuning ROM. Diagnosing a failure requires revealing the ROM, which makes it tuning data,
and the first version named no source of fresh pairs.

**Decision.** Every dataset records its engine `family`. At least two sealed ROMs must pass, from at least
two families, one of them absent from the tuning set (tmc, or a reserve-pool ROM listed in
benchmark-roms.md). If the gate fails, phase 2 does not land unless the owner records a decision that
accepts the failure (architecture §12); the failure is fixed by a rule change justified by its `restsOn`
and validated on the tuning set alone, and a fresh sealed pair is needed before release 1 claims
generality.

**Consequences.** Two Emerald siblings alone cannot pass the gate; the failure path is defined instead of
improvised.

**Rejected.** Landing automatically on a recorded failure (weakens the plan's gate without the owner).
Counting siblings of a tuning ROM as independent.

## D54. Phase-1 component boundaries as executed

**Context.** Roadmap 1.0–1.D splits phase 1 into a lead, four parallel components and an integrator.
Executing it with parallel agents exposed dependencies the split did not allow for: 1.D calls
`parseElf`, `parseGnuMap` and `canonicalJson`, and a parallel component cannot typecheck against
exports that are not merged yet; the corpus is the proof of the encoder, but it sat with the CLI;
`doctor` needs the finished ISA and corpus; the gate files are too many for the lead alone; and a few
files the work needs were in no listing.

**Decision.** Phase 1 runs as nine components in three waves plus the integrator (the table is in
roadmap.md, "As executed"). The deviations from roadmap 1.0–1.D:

- (a) 1.B's files move into wave 0, as component `p1-foundation`, beside the lead's `p1-infra`,
  because 1.D calls `parseElf` and `canonicalJson`, and parallel components cannot typecheck against
  unmerged exports.
- (b) `src/foundation/isa/types.ts` is created and owned by the ISA component (`p1-isa`), not by the
  lead: no other wave-1 component uses it.
- (c) The binutils runner (`src/shell/toolchain/binutils.ts`, `assembleWithBinutils`) and the corpus
  (`test/corpus/generate.ts` plus a new pure `src/foundation/isa/corpus.ts`) belong to the ISA
  component, so the author of the encoder proves it against `as`. The corpus core lives in `src`
  because `doctor` (shell) must re-assemble it and the shell may not import `test/`.
- (d) `doctor` and its command move to wave 2 (`p1-doctor`), once the ISA and corpus have merged.
- (e) The gate files are written by two gate components, `p1-gates-early` (g1–g3, wave 1) and
  `p1-gates-late` (g4–g6, wave 2), on the `test/gates/gate.ts` contract that `p1-infra` freezes.
- (f) New files: `src/api/files.ts` (the `romlift/node` file helpers), `src/foundation/util/prng.ts`
  (the corpus's seeded sample is needed by `doctor` in `src`, so the PRNG cannot live only in
  `test/helpers`), and `test/helpers/architecture.ts` (the checker, reused by the mutation test).
- (g) The CLI's `CommandSpec`, `OptionSpec`, `ParsedArgs`, `CliIo` and `ExitCode` are frozen in wave 0,
  because every phase's command lists depend on them; `p1-cli` adds the parser and helpers in wave 1.
- (h) `GateSpec.tier` accepts `'both'` for the gates architecture §13 marks "ci and real".
- (i) The exit commands run the real tier before the ci tier, because `g1.provenance` (ci) checks the
  real gate record once `phase.json.landed` is 1.
- (j) `npm run lint` runs only the architecture checker (`test/architecture.test.ts` and
  `test/mutation/phase1/architecture.test.ts`), so the phase exit commands can name lint without a
  separate linter (D5 stands: the checker is the lint, and `npm test` still runs it).

The architecture checker reads a dynamic `import()` whose specifier's type is a string literal or a
union of string literals as one edge per literal, so `test/gates/gate.ts` can load the four entry points
without naming files that do not exist yet in a partial tree; any other non-literal specifier fails
outside the PoC loaders.

**Consequences.** Every component typechecks alone against merged code only; the encoder's author
also owns its external proof; the lead's files stay small and frozen early. Roadmap 1.0–1.D remains
the description of what phase 1 delivers; the "As executed" table is who built which part.

**Rejected.** Running 1.D against stubs of 1.B's exports (stubs are what "nothing is stubbed early"
forbids, and they would hide interface drift). Keeping the corpus with the CLI (the CLI author would
prove an encoder they did not write). Putting the PRNG in `test/helpers` only (`doctor` in `src` could
not import it). One gate component for all six phases (too large to finish in one wave).

## D55. Phase-1 review: one corpus run, one verdict, one digest

**Context.** The first review of phase 1 (docs/phase-1.md, "Review") found the doctor and corpus
verdict decided in three layers (foundation hard-coded the phase-1 threshold, the shell set
`report.ok`, the CLI recomputed it from the statuses); the corpus pipeline copied between the shell
doctor and the corpus driver; two incompatible definitions of the summary's `inputsDigest`; a digest
that left out modules the corpus imports, so `npm run corpus -- --reuse` accepted stale summaries;
test-harness files inside `foundation/isa` beyond what D54 (c) admitted, behind an injection seam no
test used; a frozen `ParsedInsn` that could not hold a reading per candidate; a `Flow` that called a
pc load through a base register `mov-pc`; a `CommandSpec` without positional arity; and the term
"engine family", which the naming rule forbids.

**Decision.**

- (a) **The corpus has its own directory**, `src/foundation/corpus/` (`corpus.ts` the entry,
  `types.ts`, `cases.ts`, `layout.ts`, `compare.ts`, `parse-summary.ts`), outside `foundation/isa`, so
  nothing of it ships beside `romlift/isa`. It imports the isa functions directly: the `CorpusIsa`
  seam is removed, because no test injected an isa (the mutation test flips assembled bytes). The
  corpus produces **counts only** (`CorpusCounts`); `corpusSummary(head, counts, ok)` builds the
  persisted `romlift/corpus-summary@1`, whose shape and key order are unchanged, and
  `parseCorpusSummary` reads one back field by field.
- (b) **The policy is one pure module**, `src/core/workflow/doctor.ts`, live from phase 1:
  `DOCTOR_CHECK_IDS`, `DOCTOR_REQUIRED`, the corpus threshold `corpusOk(counts, options)` (no
  disagreement; at least 0x10000 Thumb and bl cases and the ARM sample; every ARM row covered; both
  alignments; an extreme) and `doctorVerdict(checks)` → `ok | unusable | disagrees`. The shell
  calls them and decides nothing; `DoctorReport.ok` is replaced by `verdict`, and the CLI maps the
  verdict to an exit code (0, 1, 3) without reading the statuses.
- (c) **One corpus run**, `runCorpus` in `src/shell/toolchain/corpus.ts` (bounded concurrency, file
  order kept, an `onFile` hook), used by `doctor` and by `test/corpus/generate.ts`.
- (d) **One inputs digest**, `corpusInputsDigest` in `src/shell/toolchain/corpus-inputs.ts`: sha256 over
  every repository file reached by the relative imports of `src/foundation/corpus/corpus.ts`,
  `src/core/workflow/doctor.ts`, `src/shell/toolchain/corpus.ts`, `corpus-inputs.ts` itself and
  `test/corpus/generate.ts`, plus the `as --version` line and the options. A module the corpus starts
  to import is covered from that commit; a unit test proves the closure equals the one the TypeScript
  compiler resolves. `doctor` never persists a summary and computes no digest. `test/corpus/**`
  joins the source digest (architecture §8.6). The digest, `runCorpus`, `corpusOk`, the summary
  helpers and `runDoctorWith` (the doctor with explicit corpus options, which the tests use) are
  exported through `romlift/internal` (`src/api/corpus.ts`), not `romlift/node`; `DoctorOptions` no
  longer has `armSample`.
- (e) **The corpus driver** imports only the four entry points and the bench's argument parser
  (`bench/src/args.ts`); `test/corpus/**` is scanned by the architecture checker with that edge row.
- (f) **`ParsedInsn.candidates`** is `readonly ParsedCandidate[]`, each `{specId, operands}`: every row
  that accepts a text keeps its own reading, so `assemble` can no longer lose a row with a better
  `asPriority` whose reading conflicted with an earlier one. **`Flow`** gains `via: 'load-pc'` for pc
  loaded through a base register other than sp (ldr/ldm; base 15 is a pc-relative table read), and
  `pool-load` with `rd` 15 is documented as a transfer of control the walker must check (the PoC
  classifies `ldr pc, [pc, #imm]` the same way, so parity is kept). `roundtrip.ts` exports
  `printing(insn, resolver)`, the rule run once with its text and encoding, which `rawReason` and
  the corpus use.
- (g) **`CommandSpec.positionals`** (`readonly {name, optional?}[]`): the parser rejects an extra or a
  missing positional with exit 2. `romlift doctor extra` is a usage error.
- (h) **The `romlift/isa` surface** is the roadmap 1.A list plus `formatRaw`, `rawReason`,
  `RAW_REASONS` and the types `Assembled`, `ParsedInsn`, `ParsedCandidate`, `FieldKind` and
  `Dialect`, which the corpus, the doctor and gba-kit's printer need; they are public from phase 1.
- (i) **Codebase family** replaces "engine family" for `Dataset.family` (architecture §8.2, §8.4,
  §12, docs/benchmark-roms.md); D53's rule is unchanged.
- (j) **Phase branches and the marker as practised.** The phase branch is `phase-<n>`, its components
  `phase-<n>-<component>` (a flat name; `phase/<n>-<name>` with `phase/<n>/<component>` also works, the
  roadmap's names never clashed, and either is acceptable). `test/gates/phase.json` is raised on the
  phase branch before the closing real-tier run, because it is part of the source digest that run
  records; the merge to `main` carries it. AGENTS.md and roadmap "How a phase runs" say so.
- (k) **Smaller rules**: `elfFunctions` takes an order (`address`, or `symbol-table` for the PoC's
  false-entry owners), and the bench's truth is built on it; the bench's toolchain versions come from
  `romlift/node`'s `binutilsVersions`; `bench gates --tier real` keeps the committed gate record when a
  real-tier gate of a landed phase (or of phase ≤ `--require`) is `unavailable`; `bench dataset-check`
  pins the unsealed datasets to the ROMs of the PoC baseline; `bench poc-check` recomputes the stored
  analysis's digest; export-poc strips every nested `seconds`; `g1.runtime-deps` reads the production
  tree from the lock file, cross-checked with `npm ls --json`, never from paths npm prints.

**Consequences.** One function decides each verdict and one defines the digest; the CLI, the doctor
and the driver cannot drift apart. A corpus change anywhere in its import closure regenerates the
summary. The doctor's NDJSON is unchanged. Phase 2 starts from a `ParsedInsn` and a `Flow` that
carry what the walker needs.

**Rejected.** Keeping `ok` decided inside foundation (policy in the layer that knows no project).
Making `inputsDigest` optional for doctor (a frozen field would lose its meaning in one producer).
A fixed directory list for the digest (it already missed `foundation/util`, `foundation/rom`,
`foundation/diagnostics` and the shell runner). Keeping the `CorpusIsa` seam documented (it had no
user). Rewriting the pool-load into an indirect Flow (it would lose the pool address the walker needs
and break PoC parity).


## D56. Phase-2 component boundaries, and the contract members the driver port needs

**Context.** Roadmap 2.0–2.I splits phase 2 into a lead, five parallel components and an integrator. As
in phase 1 (D54), a parallel component cannot typecheck against exports that are not merged: every
rule component needs a running `analyze` to be proven alone, and lockstep needs the driver. Porting the
PoC's control flow onto the frozen contracts of architecture §4.1 also showed places where its logic
does not fit "first answer wins" or where a rule needs a fact the view did not expose.

**Decision.** Phase 2 runs as thirteen components in three waves (roadmap.md, "As executed"):

- (a) The walk skeleton (`walk/{cursor,thumb,arm}.ts`) and the whole driver are in wave 0, in
  `p2-engine`, with the lead's frozen types, so `analyze` exists for wave 1; the rule files stay with
  the rule components, and `RULES` starts as eight empty family records.
- (b) The codec (`core/analysis/codec.ts`) and the parity view go to `p2-lockstep`, which implements
  `RuleOracle` over the log of `p2-poc-export`; `core/analysis/explain.ts` goes to `p2-bench`; the
  `bench run` rewrite, the held-out datasets and the fixture coverage are components of their own.
  `npm run export-poc -- --mode scored` joins the phase-2 exit list, because `bench run` still reads the
  PoC's scaffold family from its dumps until phase 3.
- (c) Contract members added to architecture §4.1, each the minimum the PoC's logic needs:
  - `WalkStep` gains `continue` (an indirect call: `mov lr, pc; bx rN`) and `padding` (a trailing
    zero halfword at a stop). The walk slot is asked for pool loads, branches, returns, indirect jumps
    and mode switches, and, in Thumb, at a stop on non-code with the run's last instruction
    (`WalkCursor.phase` 'stop', `stop` 'invalid' | 'pool'). Without an answer the decoder's Flow
    decides; an exit no rule decided carries `DECODER_FLOW` ('walk.decoder-flow'); an indirect jump
    other than `bx rN` that no rule explains is not code, so `walk.mov-pc-without-table` decides.
  - `BlVerdictRule.refines`: `bl.noreturn-before-noncode` runs after the verdict, for a call or a
    deferred site in the caller's dead ends, as the PoC's settle() does.
  - `ValidityRule.checkEntry`: `valid.in-rom-unclaimed` judges the entry before any reading, so
    whyInvalid() asks settle() exactly where the PoC does.
  - A rule kind `accept-veto` in the accept slot: `accept.tiny-anchored-at-start` is the tiny-candidate
    veto inside thumbCandidate(); the driver applies the vetoes to the forward proposals.
  - `ClaimRule.extentEnd`: the PoC's `Func.end`, computed by `claim.adjacent-pools` when a reading is
    built (the code end when no claim rule has one); `ClaimEdit.when` ('always' | 'start-free' |
    'free-bytes') states how the PoC's claim() writes. `RegionRule.startup` returns the startup region.
  - `AnalysisView` gains `seeds`, `overrides`, `functions()` (acceptance order, for
    `seed.startup-pointer`), `accepted(entry)`, `whyInvalid(entry)` (for `gap.tiled-hole`),
    `inProgress(entry)` (for the 'defer' of `bl.target-pops-unpushed-frame`) and `adrOwner(a)` (for
    `gap.adr-block-absorb`).
  - Gap slots: forward[0] and forward[1] are the pair asked at one cursor (thumbCandidate, armAhead) and
    compared by `prefer`; the proposers after them see `GapCursor.head`, the head rule's reading at the
    cursor (tryTiledHole); the endAnchor proposer sees the gap's head; the end-anchor and backward
    proposers return one candidate per call and the driver shrinks `end`. `GapProposer.reason` lets
    `gap.arm-scan` emit 'arm-unreached'.
  - The `Reading` carries the walk order of pools and tables, the settle verdicts, the exits, the
    branch targets and the PoC's dense() holes, all computed once by `makeReading` (milestone M2 (a)).
  - Shared reading queries live in `walk/cursor.ts` (`isDense`, `popsCallersFrame`, `anchoredAtStart`,
    `anchoredAtEnd`, `fillsTo`), since rule files may import `walk/` but never each other.
- (d) Profile fields added for the PoC's remaining constants: `pointerWords` (4 pointers, a share of
  1/4), `anchorSlack` (3), `extentPoolGap` (8), `gapScan.minInsns` (3), `gapScan.prologueDistance`
  (4,096, the backward chain's window), and the idiom `opensWithPushLr` (the raw `push {.., lr}` test of
  whyInvalid and the backward chain) beside `isPrologue` (`opensWithPrologue`: also word-aligned).
  `ClaimCode`, `BlSite`, `ReadingSummary` and `JumpTableMatch` are defined in `core/profile/types.ts`
  because the profile may not import the analysis; agbcc's `isPadding` ignores `next` for PoC parity.
- (e) Parity details of the port: an ARM reading is a fresh walk at every read, as the PoC's
  analyzeArm() (only Thumb readings are memoised per epoch); the driver peeks at the reading a proposer
  just computed instead of asking for it again; the calls of an absorbed block are accepted one by one as
  `seed.call` proposals; the ARM walk uses the PoC's class for the encodings the decoder classifies
  otherwise on purpose (test/local/poc-decoder-differential.test.ts).
- (f) The oracle protocol (core/analysis/oracle.ts): one typed query per PoC method in its own units;
  the walk family's answers cover `bl`; `claim` and `forgetCandidates` are markers, never answered;
  couldBeCode() and inPointerTable() live inside rules and are never asked, while the settle and valid
  queries those rules make through the view are; an answered tryTiledHole or absorbBlock still has its
  PoC side effects applied. A rule absent because its family is answered gets its origin from
  `ORACLE_ORIGINS`; a registered rule's origin is always its own `meta.origin`.
- (g) `diagnoseMisses` (romlift/internal) runs the analysis and diagnoses each miss at its final state,
  so the bench needs no access to the driver.
- (h) The component branches are flat (`phase-2-p2-engine`): Git cannot hold `phase-2/<component>`
  beside the branch `phase-2`.

**Consequences.** Every wave-1 component typechecks and runs end to end against merged code; the
per-rule assignments are written next to each contract in `core/analysis/types.ts`, so the rule
components cannot drift; `analyze` with the shipped profile throws `RomliftInvariantError` until the
wave-1 rules register every pipeline id, and runs on any registry through `runAnalysis`.

**Rejected.** Running the driver against stubbed rules in the product (stubs are what "nothing is
stubbed early" forbids). Wrapping the PoC's composite conditions into single rules (the slot orders
would no longer be the PoC's call order). Caching ARM readings per epoch like Thumb ones (the PoC
re-walks them, and a cached reading would miss acceptances within the epoch).

---

## Review findings index

The findings of the four adversarial reviews of the architecture (17 October 2026) are indexed, one row per
finding, in [architecture-review.md](architecture-review.md), with the decision each one changed.

Below, every weakness the earlier design review of the three proposals raised, and the decision that
answers or rejects it.

| Proposal | Weakness | Answer |
| --- | --- | --- |
| layered core | `core/project` grab-bag of seven concerns | D3 |
| layered core | `core/evidence` used for rule evidence, colliding with the plan's importers | D6 |
| layered core | `node/elf.ts`, `node/map.ts` put parsing in the shell | D4 |
| layered core | foundation folded under `core/`, shell named `node/` | D3 |
| layered core | name precedence "TOML unless default, then signature" drifts under R3 | D9 |
| layered core | no report-only discovery in `generate`; signature entries accepted as given | D8, D9 |
| layered core | `const enum`, no runtime or test strategy, mixed readonly | D2; architecture §3 (all exported types deeply readonly) |
| layered core | PoC copied into `test/oracle/`; `[analysis] disable` in the TOML | D11, D22 |
| layered core | held-out gate drops extents and code end | D25 |
| layered core | no plan for the six unreviewed rows or the misnamed category | D26 |
| layered core | readability drops objdiff score 0 | D34 |
| layered core | module inference copies `main`/`main_2`, no asm-only rule | D20 |
| layered core | `.inst.n` for cross-module branches is an unapproved reinterpretation, unmeasured | D15 (kept, counted, with a measured replacement path) |
| layered core | config, scaffold, reconcile in core against the plan's diagram | D3 |
| layered core | no C data fail-loud rule; cross-OS determinism by hand | D21, D30 |
| layered core | gates are prose | D29 |
| layered core | MinHeap worklists contradict PoC LIFO parity | D10 |
| layered core | no split of work among parallel agents | D43 |
| layered core | CI builds agbcc for every run | D28 |
| layered core | 3 s budget without a measurement plan | D41 |
| pipeline | replayable stages, `romlift diff`, stage cache (scope creep) | D18 (rejected) |
| pipeline | untyped `StageContext.options`; `render()` closures | D17; architecture §3 (`AnalysisOptions` fully typed) |
| pipeline | `core/pipeline` hub importing every module | D36 |
| pipeline | rule interfaces without `rests_on`; one file per family; no terminator interface | D7 |
| pipeline | `settle` resumes the fixpoint and changes acceptance order | D8, D10 |
| pipeline | `Evidence` rule interface against `EvidenceBundle` | D6 |
| pipeline | C-derived state inside layout | D17 (`DecompState` at emit only) |
| pipeline | thin printer section; reopens shipping signature bytes | architecture §5, D14, D15, D16; D40 (kept open because of a real conflict between two owner rules) |
| pipeline | `.align` only where proven, reversing the plan | D16 |
| pipeline | `bench adopt` refuses held-out, entries gate unpassable | D25 |
| pipeline | parity baselines in a gitignored cache | D11 |
| pipeline | phase-5 gate without a mechanism; readability without a measure | architecture §11 phase 5 (`bench/migration/klonoa.sh`); D34 |
| pipeline | signatures rebuilt, not copied | D31 |
| pipeline | missing: unreviewed debt, init chunking, `.rodata` rule, serial libraries, worktree gate | D26, D20, D21, D32, `g4.worktree` (D29) |
| pipeline | ELF parser in foundation against the plan's shell placement | D4 (kept: parsing is pure; file reading is in the shell) |
| pipeline | `explain` replays discover, not what generate emitted; ~7 s per query | D35 |
| pipeline | proposer cannot express waiting for an anchor | D7 (`GapRule` returns `{wait}`) |
| pipeline | no per-instruction data; 1 GB memory budget | D19 (span-level facts, re-decoded), D42 |
| pipeline | ascending candidates against PoC parity | D10 |
| user and phase first | config schema in the shell, core overlay depends on it | D3 |
| user and phase first | legacy parsers and scaffold rendering in the shell | D3, D4 |
| user and phase first | signatures/overlay import arrows contradict the data flow | D3 (explicit dependency table), D9 |
| user and phase first | rule families in single files | D7 |
| user and phase first | `capabilities` exported from `src/index.ts` | D29 |
| user and phase first | no text parser; `select.ts` re-implements `as` | D14 |
| user and phase first | bench may import shell; missing manifest rebuilt from owned roots | D37, D17 |
| user and phase first | 64 KiB default unmotivated | D20 (kept, now measured) |
| user and phase first | sealed held-out gate unpassable | D25 |
| user and phase first | unreviewed rows copied verbatim with no work item | D26 |
| user and phase first | objdiff gate moved to phase 5 | D34 |
| user and phase first | cross-object Thumb `b` not covered | D15 |
| user and phase first | commit-based provenance, dirty failure | D27 |
| user and phase first | serial-library and BIOS-stub signatures missing | D32 |
| user and phase first | ascending worklists contradict LIFO parity | D10 |
| user and phase first | 4 KiB page epochs too coarse; trail without memory budget | D13, D35, D42 |
| user and phase first | phase 1 front-loaded, no split among agents | D43 |
| user and phase first | signature schema 2 with ad hoc suffixes | D31 |
