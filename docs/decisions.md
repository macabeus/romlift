# romlift decisions

Architecture decision records for [architecture.md](architecture.md). Each entry states the context,
the decision, its consequences and the alternatives rejected, with the reason. A decision changes
only through a new commit to this file that says what replaced it and why. The last section maps
every weakness the design review raised to the decision that answers it.

Revision 2 (17 October 2026) revises the decisions the four adversarial reviews of that day contested and adds
D45 to D53 (D54 records how phase 1 was split as executed, D55 what the phase-1 review changed, D56 how phase 2 is split and which contract members its driver added, D57 which rules `g2.rule-coverage` exempts, D58 how the trail cites the acceptance, walk and gap-slot rules, D59 what the phase-2 review changed, D60 the owner's answer to §12 item 4 and the tmc tuning it led to, D61 the owner's answers to the phase-2 questions, D62 how phase 3 is split and which contract members emission adds, D63 what the wave-2 integration found, D64 what closing phase 3 changed, D65 to D67, D70 and D71 what the phase-3 review fix rounds changed, D68, D69, D72 and D73 the owner's answers to the phase-3 questions, D74 how phase 4 is split and which contract members it freezes, D75, D77, D78 and D80 to D90 what the phase-4 fix rounds changed, D76 and D79 the owner's answers to the phase-4 questions, D91 and D92 the owner's decisions dropping the gba-kit trace and skipping phase 5, D93 how phase 6 is split and which contracts it freezes, D94 what the phase-6 closing round changed); each revised decision carries a **Revision** paragraph naming the findings and what it replaced.
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

**Revision (18 October 2026, the owner's answer to Q3, D61 e).** The `resettle` stage was built and measured
(`f287b0d`); it changes rows on every other tuning ROM and on the sealed pair, so it was reverted
(`af0f75c`) and tmc's six differences of Q3 are a known phase-2 limitation the gate prints.

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

**Revision (phase 6, p6-ram-code, merged in wave 2).** `analyze --update` proposes the module borders of a hand-written
`runs_at` range (layout reason `runs-at`), so `planPatch` now inserts a new `[[modules]]` block in canonical lines,
before the next module's block (above that block's comment lines) or after the last one. Changing, moving or dropping
a listed module is still refused with `E_TOML_PATCH_REFUSED` ("edits only to insert a new module"); the refusal rule
of this decision is otherwise unchanged.

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

**Revision (19 October 2026, the owner's answer to Q1 of phase-3.md, D68 a).** The owner chose "Move gate to
phase 5": the gate is `g5.objdiff`, judged in phase 5, where the `expected/` objects and objdiff targets are built,
and applies there as this decision writes it unless the owner amends it then. Phase 3 records the classified counts
as its measurement, and the committed classifier stays.

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

**Revision (19 October 2026, the owner's answer to Q2 of phase-3.md, D68 b).** The owner chose "Measure under a heap
cap": the `romlift` bin and the gate run Node with `--max-old-space-size=256`, the gate measures peak RSS under that
cap, and its budget is set from that measurement with a stated margin. No run of the synthetic ROM completes under
the cap (phase-3.md Q6), so the budget is still 512 MiB until the owner answers Q6.

**Revision (19 October 2026, the owner's answer to Q6 of phase-3.md, D69).** The owner chose "384 MiB for bin and
gate": the `romlift` bin and `g3.large-rom` run Node with `--max-old-space-size=384`, replacing Q2's 256. The budget
is set from the recorded runs of the synthetic ROM under that cap plus a stated margin: the largest peak, 866.5 MiB,
plus 25%, rounded up to a multiple of 64 MiB, is **1,088 MiB** (D69 b). The 1 GiB budgets rejected above were
uncapped; under the cap V8's old space cannot grow past 384 MiB, so a leak in it ends in an out-of-memory exit,
which the gate fails.

**Revision (19 October 2026, the review of `d744f5d`, D70).** The gate measures the bench's `init` and `generate`
workflow children, not the bin's commands; those are measured by `bench large-rom --bin` and required by
`test/local/large-rom-bin.test.ts` (D70 b). With the runs recorded since, the largest `init` peak is 945.5 MiB, so
1,088 MiB is 15.1% above it (D70 c); the binding limit is the old space, whose live peak is recorded (D70 d).

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
overrides and traces. (Amended by D91: the trace is dropped, so phase 6 fills the map from hand-written overrides only.)

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

**Superseded by D92**: the owner skipped phase 5 and dropped legacy import; nothing below is built.

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

**Superseded by D92**: the owner skipped phase 5 and dropped the Klonoa migration tooling and switch-over; nothing below is
built, and the Klonoa repository is not touched.

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

**Decision.** Every dataset records its codebase `family` (D55 i). At least two sealed ROMs must pass, from at least
two families, one of them absent from the tuning set (tmc, or a reserve-pool ROM listed in
benchmark-roms.md). If the gate fails, phase 2 does not land unless the owner records a decision that
accepts the failure (architecture §12); the failure is fixed by a rule change justified by its `restsOn`
and validated on the tuning set alone, and a fresh sealed pair is needed before release 1 claims
generality.

**Consequences.** Two Emerald siblings alone cannot pass the gate; the failure path is defined instead of
improvised.

**Rejected.** Landing automatically on a recorded failure (weakens the plan's gate without the owner).
Counting siblings of a tuning ROM as independent.

**Revision (17 October 2026, the owner's decision, D60).** The owner answered architecture §12 item 4:
"Tune on tmc, no new ROM". tmc is revealed and tuned on; while no sealed dataset is of a family absent
from the tuning set, `g2.held-out` waives its two family conditions and prints each waiver; every other
condition stands, and a fresh sealed pair is still needed before release 1 claims generality. Fix round 2
of D60 waived only the fresh-family condition (the owner's words); the owner's answer to Q4 on 18 October
2026, "Waive both" (D61 b), waives the two-families condition too.

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

- (a) The walk skeleton (`walk/{cursor,thumb,arm}.ts`) and the whole driver are in wave 1, in
  `p2-driver` (named `p2-engine` while it ran, D59), with the lead's frozen types, so `analyze` exists
  for wave 2; the rule files stay with the rule components, and `RULES` starts as eight empty family
  records.
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
- (h) The component branches are flat (`phase-2-p2-rules-gap-region`): Git cannot hold `phase-2/<component>`
  beside the branch `phase-2`.

**Consequences.** Every wave-1 component typechecks and runs end to end against merged code; the
per-rule assignments are written next to each contract in `core/analysis/types.ts`, so the rule
components cannot drift; `analyze` with the shipped profile throws `RomliftInvariantError` until the
wave-1 rules register every pipeline id, and runs on any registry through `runAnalysis`.

**Rejected.** Running the driver against stubbed rules in the product (stubs are what "nothing is
stubbed early" forbids). Wrapping the PoC's composite conditions into single rules (the slot orders
would no longer be the PoC's call order). Caching ARM readings per epoch like Thumb ones (the PoC
re-walks them, and a cached reading would miss acceptances within the epoch).

**Revision (phase-2 review, D59).** (c)'s shared reading queries moved from `walk/cursor.ts` to
`walk/predicates.ts`; (d)'s `ClaimCode` and the unread `next` of `isPadding` are gone; (e)'s PoC
classes of the ARM walk are gone (the walk follows the table); (f)'s oracle protocol and
`ORACLE_ORIGINS` are deleted; the waves of (a) are numbered 1 to 3, as the roadmap's table numbers them.


## D57. Eight rules that no seedless fixture run can make load-bearing

**Context.** `g2.rule-coverage` requires every analysis rule to be cited as decisive in a fixture trail
and to move a fixture outcome when `bench ablate <rule> --tier synthetic` disables it, or a decision
record that names the rule and says why it stays. The outcome ablation compares is the entries with
their modes, the extents and the code end of the bench's seedless discover run (D24). Measured on the
29 committed fixtures of phase 2 (bench/dataset/synthetic/index.md, wave 3), and again on all 31 after
D58 added two, eight rules move that
outcome on no fixture, and by construction on no ROM:

- `region.startup`, `region.padding`, `region.data-after-code` run after the passes (driver/run.ts,
  runDriver), when no function or extent can change any more, and write only claims or the startup
  region, which the outcome does not contain. Their effect is judged where it is used: the startup
  region by the startup exclusion of every dataset and the held-out classifier's `startupEnd` (§8.4),
  the padding and data claims by the emission of phase 3 (`.align` and data slices).
- `seed.listed`, `seed.override`, `seed.evidence-hint` seed only from `AnalysisOptions` (the TOML's
  listed functions, overrides, evidence hints), which a seedless discover run never has. They are
  proven by their unit tests, by `g2.confirm-equals-discover` (the listed set) and by the phase-4 to
  phase-6 gates that pass options.
- `valid.in-rom-unclaimed` never fails in discover mode: valid() (driver/validity.ts) answers false
  for an entry outside the ROM, odd or claimed before whyInvalid runs, as the PoC's valid() does, and
  the only rule that asks whyInvalid directly, the gap head, asks only at a free cursor. The rule
  decides in confirm mode, where a listed entry inside other code reaches whyInvalid
  (`W_LISTED_INVALID`), and in diagnoseMisses, which gives a miss inside found code the reason
  'inside-code'.
- `bl.noreturn-before-noncode` re-labels as never-returning a call after which the caller's walk
  already stopped on non-code (the walk records that dead end itself), and the walk with or without
  the mark reads the same instructions, so no entry, extent or code end moves. It is decisive in the
  trail of `noreturn-call-then-next` (a 'verdict' event: the `bl` at 0x08000122 in Abort is 'noreturn';
  disabled, it is 'call' by another bl rule, with identical entries and extents). What it changes is
  the verdict record, from which the held-out classifier reads the never-returning sites of label
  clause (a) (bench/src/analysis-run.ts, noReturnSites): without it a label right after such a call is
  classified glued.

**Decision.** These eight rules stay without a fixture that moves an outcome, and this record exempts
them from `g2.rule-coverage`. It exempts no other rule: a rule that moves an outcome on some fixture
but that no trail event cites is a defect of the trail to fix in the driver, never a reason for a
record here. Three fixtures were added for rules the first 26 fixtures did not make load-bearing
(`pointer-table-before-leaf`, `computed-jump-callback`, `large-data-referenced`); the coverage table
of bench/dataset/synthetic/index.md names the fixture of every other rule.

**Consequences.** test/unit/fixtures/coverage.test.ts asserts that disabling each of the eight moves
no fixture outcome, so a change that makes one load-bearing (a region rule moved before a pass, a
bench run with seeds) fails until its exemption is replaced by a fixture.

**Revision (phase-2 review, D59).** `valid()` no longer repeats `valid.in-rom-unclaimed`'s test: the slot
judges outside, odd and claimed entries in discover mode too, and its rejection names the rule. Disabling
it still moves no fixture outcome (the reading rules reject the same entries), so the exemption stands
on the measurement, which test/unit/fixtures/coverage.test.ts repeats.

**Rejected.** Adding the claims and the startup region to the ablation outcome (every claim edit would
then count, which says nothing about the entries the gate protects). Ablating with TOML seeds or
options (the bench scores a seedless run by D24; the seed rules have their own gates). Fixtures that
reach `valid.in-rom-unclaimed` through confirm mode (ablation runs discover only).


## D58. The trail cites every decision a rule makes, walk steps included

**Context.** g2.rule-coverage requires a decision event of the trail (accept, reject, verdict, claim,
absorb) to name each rule that moves a fixture outcome. After wave 3, fifteen load-bearing rules were
named by none: the driver emitted an acceptance under the proposing rule and named the acceptance rule
only in its note; the gap slots prefer and skip emitted nothing; and a walk-slot answer left no trace
but an exit record, with no rule at all for a pool, a table, an indirect call or dropped padding. D57
says such a rule is a defect of the trail to fix in the driver, never a reason for an exemption.

**Decision.**

- (a) In grow, when an acceptance rule takes a harvested candidate, the driver emits a second 'accept'
  event under that rule beside the proposer's (detail: which proposer's candidate it took).
- (b) The prefer slot's Thumb/ARM choice at a cursor and the skip slot's next cursor are 'verdict' events
  (fill-gaps.ts, `preferred`, `skip`).
- (c) `Reading.steps` (frozen type `WalkDecision {at, rule, step}`) lists the walk-slot answers a walk
  applied, in walk order. The walkers record them only when `WalkEnv.trace` is set, which the driver sets
  when a trail sink is given and the level is not 'off', so a normal run walks and allocates exactly as
  before and no digest moves (FunctionFact and the codec do not carry steps). The settle loop keeps the
  answers of every round, deduplicated: an earlier round's noreturn-call or padding answer decides the
  bl verdict that the last walk only applies. The driver emits one 'verdict' event per step when it
  takes or absorbs a reading, so only the readings that became functions are cited.
- (d) 'verdict' now means a rule's decision at one instruction or cursor: a bl site, a walk step, the
  Thumb/ARM choice or a gap skip. `romlift explain` prints them under "verdicts" (it said "bl
  verdicts").
- (e) Two fixtures make the last two uncovered rules load-bearing: inline-arm-switch (m4a's
  umul3232H32 shape) and recursive-far-call (agbcc C: a recursive call 2.4 KiB past the entry after a
  guard that calls a never-returning function, so the only return follows the call).

**Consequences.** Every rule of RULES is either cited and load-bearing on a named fixture or exempted
by D57; the explain goldens grew by the walk and gap verdicts of their 256-byte buckets.

**Rejected.** Renaming the acceptance event to the acceptance rule (the seed and harvest rules would
lose their citation). Emitting walk events from inside every walk (the readings of rejected candidates
and every settle round would flood a 'decisions' trail with answers that changed nothing). Recording
steps unconditionally (it costs the walk an allocation per pool load with no reader when the trail is
off).

## D59. Phase-2 review: the oracle deleted, every decision through its slot, the walk bounded

**Context.** The adversarial review of phase 2 (17 October 2026; every finding's disposition is in
[phase-2.md](phase-2.md), "Review") found that the driver repeated two rules' predicates inline and
hard-coded rule ids and slot counts, that the retired lockstep oracle was still threaded through the
pure driver and brought back the PoC's LIFO order, that the ARM walk and a profile table kept PoC flow
classes and Thumb register effects outside the ISA rows, that a valid cartridge with a large zero
region ran the analysis out of memory, and that two rules and several contract members had shipped
with no decision record.

**Decision.**

- (a) **The lockstep oracle is deleted.** `RuleOracle`, `consult`, `ORACLE_ORIGINS`, `OracleQueries`,
  the oracle branch of `resolveRules`, `bench/src/lockstep.ts` and their tests are gone; the lockstep of
  architecture §4.5 is historical. Its evidence (milestone M1, the `parity` member of `results.json`)
  stays committed and `g2.poc-parity` checks it, now also that the commit it names is an ancestor of
  HEAD; it is never re-run, because the driver no longer runs in the PoC's order (`'poc-lifo'` was
  deleted by `c608a33`). `export-poc --mode queries` still writes the log and re-reads it through
  `bench/src/poc-log.ts`, which stays as that command's validator. This supersedes D56 (f).
- (b) **Every decision is a slot's.** The driver repeats no rule's predicate and names no rule id: the
  gap's head is accepted only through the proposers after the pair (`gap.tiled-hole-inner`), at the gap
  start and after the end-anchor loop, proposed by the head rule with a second 'accept' event under the
  proposer (D58 a); `valid()` judges outside, odd and claimed entries through the validity slot
  (`valid.in-rom-unclaimed`'s `checkEntry`); `pointerCandidates` returns one list per resolved harvest
  rule; the calls of an absorbed block go through the queue slot; an unanchored candidate is rejected
  under the rule that proposed it. Proposers return a `Proposal` and accept rules an `AcceptHold`; the
  driver stamps the id of the slot it called, so no rule spells its own id, and accept rules judge a
  candidate by its origin (`v.originOf(proposedBy)`), never by another rule's id.
- (c) **The ISA rows are the only source of flow classes and register effects.** The ARM walk and
  `gap.arm-scan` follow the decoder's Flow; the PoC's classes (`add/sub pc, pc, #imm` as adr, the
  ARMv4T-undefined encodings as other or pc_write) are gone. On the five tuning ROMs and the 31 fixtures
  no analysis digest moves; test/local/poc-decoder-differential.test.ts still lists every difference
  from the PoC with its count. `InsnSpec.registers` (`RegisterSpec`: written operands, a written
  register list, fixed clobbers, and the operands a written value is followed to) replaces
  `core/profile/thumb-registers.ts`; `registerEffect` (foundation/isa/registers.ts, `romlift/isa`)
  reads it. This supersedes D56 (e).
- (d) **The walk is bounded.** `LIMITS.zeroRun` (64): a path over more consecutive all-zero
  instructions stops with a 'zero-run' error and no diagnostic (the bytes are not code).
  `LIMITS.walkInsns` (65,536, five times klonoa's largest function): a walk that records that many
  instructions stops with a 'walk-limit' error and raises `W_WALK_LIMIT`. Both are decode errors to
  `valid.decodes`. A unit test analyses a 32 MiB mostly-zero image under a 256 MiB V8 heap. This
  applies D42 to the analysis ahead of phase 3's `g3.large-rom`.
- (e) **The rules and contract members phase 2 added**, now in architecture §4.1:
  `walk.inline-arm-switch` (walk slot, after `walk.bx-pc-veneer`; a Thumb `bx rN` after `add rN, pc, #0`
  enters ARM code right after it, which is this function's tail; restsOn: hand-written code enters ARM
  in place and runs the ARM body as one function; WalkStep `'arm-tail'`, `Reading.armTails`,
  `ReadingShape.armTails`) and `bl.target-beyond-callee` (bl slot, before
  `bl.target-pops-unpushed-frame`; a far `bl` past the entry of another function the caller calls is a
  call; restsOn: a far jump reaches the caller's own tail, and a function never contains the entry of a
  function it calls; it removes the order dependence milestone M4 exposed in `pops-unpushed-frame`);
  `WalkCursor.back`, `InsnLookup` for `Reading.insnAt`; `WalkDecision`, `Reading.steps` and
  `WalkEnv.trace` (D58); `withVerdicts` (reading.ts) builds the settled reading, so only reading.ts
  builds readings; `CLAIM_KINDS` and `claimName` derive from `Claim`, the one claim enumeration;
  `SealedCounts` counts the `other` false entries and splits the glued misses (`gluedWhere`: inside a
  found extent, outside every extent, past the code end), counts only (D25); `shell/rom.ts` `readRom`.
- (f) **Confirm mode's labels** (milestone M6): a listed entry with `label = true` is a walk boundary
  only once it is taken, as discover's walk of the function around it saw it (driver/state.ts
  `isListedBoundary`).
- (g) **Removed until their phase:** the profile's `misfitThreshold` (`W_PROFILE_MISFIT` has no raiser,
  and no rejection rate measured on the tuning ROMs separates a fitting profile: fe7j rejects more
  candidates than it accepts) and `isPadding`'s `next` (never read; "0x46C0 only before a pool" returns
  with the emission that needs it).
- (h) **`defineRule` stays internal** (`romlift/internal`): a rule runs only from the registry of this
  repository, so there is no public extension point to version; roadmap 2.0 lists it there.
- (i) **Names.** The phase-2 component that built the driver is `p2-driver` (it ran as `p2-engine`, a
  term the naming rule forbids); D53 says codebase `family`.

**Consequences.** On the five tuning ROMs and the 31 fixtures functions, extents and claims are
unchanged; rejections change (rule ids, zero-run and walk-limit details) and sa3 raises four
`W_WALK_LIMIT` (tile-map data that decodes as 128 KiB of shifts). Analysis CPU drops on pokeemerald
(4.8 s to 2.9 s) and klonoa (0.70 s to 0.27 s). `g2.checks-fail` has four mutation files (the lockstep
reporter's is gone). `g2.held-out` still fails on tmc ([phase-2.md](phase-2.md)); D53 is unchanged.

**Rejected.** Keeping the oracle behind one driver hook (it would keep the PoC's LIFO order alive in the
product for evidence that is already committed). Keeping the PoC's ARM classes as a table override (no
reading of the tuning set depends on them). An instruction cap alone (klonoa padded with 4 MiB of zeros
still peaked at 2 GB: 294 candidates in the zeros each walked 65,536 instructions). Raising
`W_WALK_LIMIT` for zero runs (every tuning ROM would warn on its data candidates).

**Revision (fix round 2 of the phase-2 review).** The re-review of fix round 1 found that (b) still had
exceptions and that memory was still unbounded in the number of candidates. Added:

- (j) **fillGaps counts what it adds.** Its return value, the fixpoint test of a pass, is the sum of what
  `accept()` reports, the calls an absorbed block adds included (`absorb` returns them). A hole head
  taken mid-gap is accepted under the head rule as at the gap start (the PoC's `tryTiledHole` and
  `fillGaps` both say 'tiled hole'), so its provenance no longer depends on its position. Before, an
  unlisted mid-gap head counted as one function in every round and a confirm run spun to
  `W_FIXPOINT_LIMIT` (10,000 rounds per pass).
- (k) **(b) without exceptions.** `grow` asks the validity slot about every harvest target that is not a
  function, claimed ones included: `valid.in-rom-unclaimed` rejects them before any reading, so
  disabling it changes the verdict; its unanchored rejection names the accept rules that declined,
  not the driver's reading of a prologue. An accept veto's decision is a rejection under the veto's id
  (`AcceptVeto.reason` is read), and `diagnoseMiss` names the veto of a vetoed miss.
- (l) **The gap scan's remaining code is traversal and format.** Stepping over bytes a claim rule
  already claimed, and never standing in the cartridge header (a fact of the GBA format, as `contains`
  is; phase 3 claims the header, correctness-6), are not rule decisions and stay in the driver. The
  absorb retries (a block a claimed halfword or one zero halfword on) moved into `gap.adr-block-absorb`.
  Gap positions are bus addresses. The forward slot is typed `{ thumb, arm, after }` instead of by
  position, with the ranks of the old list (0, 1, 2…), so the worklist order is unchanged.
- (m) **Analysis memory is bounded in the number of candidates.** `LIMITS.candidateBudget` (262,144)
  binds the distinct harvest targets grow judges in a whole run (revised in fix round 3; it bound each
  grow round at first, and since the targets that fail intrinsically leave the next snapshot, every
  later round judged a fresh 262,144, so rejections, time and memory grew with the rounds times the
  budget: fe7j plus a 16 MiB flood left 4.2 M rejections). Past it a fresh target is not judged, a
  target judged before still is, and `W_CANDIDATE_BUDGET` is raised once. The tuning ROMs judge at most
  13,431 distinct targets in a run (pokeemerald; 13,423 on the six at `8fba183`'s successors, measured
  on 18 October 2026, tmc 9,673). `LIMITS.epochReadingBytes` (256 MiB by `readingBytes`' estimate; the
  "about 105 MB at most" first recorded here was wrong: measured on 18 October 2026, pokeemerald holds
  208,344,064 bytes in one epoch, 78% of the budget, and already held 206 MB at `22cbc77`; fe7j 120 MB, tmc
  113 MB): past it the candidate readings an
  epoch holds are dropped, their verdicts staying memoised and their 'epoch-reuse' facts dropped with
  them (`forget` in epoch.ts is the one path out of `settled`), and `W_READING_BUDGET` is raised once;
  a dropped reading asked for again is walked again, so (D13) holds exactly below the budget. A flood's
  rejections and verdicts are bounded by the budget; its time still grows with the grow rounds, because
  each round's harvest enumerates the flood (fe7j plus 16 MiB: 160 s, 1.9 GB peak RSS, 261,475
  rejections). The flood tests are a stress tier in `test:local`.
- (n) **`AnalysisTuning.worklist` is removed**: it had one value and no reader.
- (o) **No hand decoding outside the ISA.** `isConditional` (from the row's `cond` field) and
  `thumbWordAt` (foundation/isa/decode.ts) replace `word >>> 28 !== 0xe` in the ARM walk and
  `gap.arm-scan` and the halfword pairs of the Thumb walk and `accept.tiny-anchored-at-start`.
  `registerEffect` throws `RomliftInvariantError` for an operand name its row lacks, and a table test
  checks every RegisterSpec name of every row.
- (p) **The glued split uses the label classifier's functions**: a glued miss is `insideExtent` only
  inside the extent of a found function that has an ELF entry (`classify.ts` `gluedWhere`).
- (q) **A failing gate keeps its notes.** `failureDetail` (test/gates/gate.ts) appends the notes a gate
  wrote before it failed to its failure message, so the gate record carries the measurements that
  explain a failure (a sealed ROM's counts).
- (r) **Seeds are checked before round 0** (fix round 3). A seed whose entry is not a non-negative safe
  integer, whose mode is neither `thumb` nor `arm`, or whose size is not a positive integer that fits the
  ROM from its entry is left out with `W_SEED_MALFORMED` (new) and is absent from the result's options;
  an entry of NaN ran a confirm run out of heap, a negative size made an extent that misses its entry. An
  entry that is odd, outside the ROM or listed twice is well formed and judged by validity
  (`W_LISTED_INVALID`).
- (s) **`seed.rom-entry` proposes the startup target only when its first ARM word is wholly in the
  ROM** (fix round 3): a truncated image (the header plus a halfword) gave a function with an empty
  extent. The rule cannot raise a diagnostic; the image's single function at 0x08000000 says what was
  found.
- (t) **`bench run` never drops the printer member silently** (fix round 3). It records the local corpus
  summary when it is current; otherwise the previous artifact's member while its inputs digest still
  equals `corpusInputsDigest` (computed from the source tree, no corpus run needed); otherwise it refuses
  to write and says to run `npm run corpus`. The phase-2 exit list runs `npm run corpus` before
  `bench run`.

Consequences: functions, extents, claims and the parity view are unchanged on the five tuning ROMs and
the 31 fixtures; rejections change (claimed harvest targets, veto rejections, the unanchored detail), so
every analysis digest moves in fix round 2; tmc's glued split reads 2 inside an extent, 15 outside, 34
past the code end (its verdict is unchanged). (q) to (t) change no analysis digest of the tuning ROMs:
no tuning run reaches either budget, passes a malformed seed or is truncated.

## D60. The owner's answer to §12 item 4: tune on tmc, with the rules and conventions it needed

**Status (the owner's answers, 18 October 2026).** The owner answered Q1 to Q5 (D61): (j) is restored for
every ROM ("Use $d for every ROM"), the two-families condition is waived ("Waive both"), `g2.poc-parity` is
scoped to the five ROMs of the M1 evidence and tmc is a benchmark row in `g2.baseline-rows` ("Keep tmc as
99.94%. It's a benchmark row that we can improve later"), and D8's `resettle` was built, measured and
reverted, tmc's six differences of Q3 recorded as a known limitation ("Build resettle, else accept"). The
gates D60 left open below are answered there; the rules (a) to (i) are unchanged, but for the
straight-line argument scan of (e) (overfitting-r2-1).

**Status (fix round 2, 17 October 2026).** The adversarial review of `f802822` found one more gate change
the owner had not authorised (the code-end convention of (j), the only reading under which tmc passes
`g2.code-end`) and a waiver applied on an inference (the two-families condition of `g2.held-out`), and
that fix round 1 had claimed generality from preconditions rather than decisions. Fix round 2 withdrew
(j) (owner question Q5), waived only the fresh-family condition (Q4 stays open and the gate fails on the
other), made `g2.poc-parity` check its coverage once historical, recorded each rule's decisive effect
(on tmc only: every rule is single-instance), widened `seed.ram-copy` to end-pointer copies and pool
boundaries with windows set from the measured distribution, added fixtures for the untested clauses, and
pinned tmc's PoC reference by content. Phase 2 does not land until the owner answers Q1 to Q5.

**Status (fix round 1, 17 October 2026).** The adversarial review of `74ec273` found that the landing at
`808513f` rested on three gate changes the owner had not authorised (a `g2.poc-parity` fail frozen by
raising `phase.json`, the `scaffold` family not asked of tmc, a confirm mode that made
`g2.confirm-equals-discover` pass by construction) and on rules whose generality was asserted, not
measured. The fix round reverted the unauthorised changes ((k), (l), `phase.json` back to 1), measured the
PoC on tmc, made the code-end convention uniform (j), rewrote `seed.ram-copy`'s copy recognition (e),
added one fixture per rule branch and recorded each rule's counter-check below. Phase 2 does not land
until the owner answers the questions of phase-2.md ("Owner questions").

**Context.** Phase 2 did not land because `g2.held-out` failed on tmc (zeldaret-tmc, the only sealed ROM
of a codebase family absent from the tuning set): raw recall 99.37% below 99.46%, 51 `glued` misses (2
inside a found extent, 15 outside every extent, 34 past the code end), 3 label candidates, and a code end
4,130 bytes before the ELF's; pokefirered and pokeruby passed but are both `pret-gen3`, a family of the
tuning set. D53's safe default held. On 17 October 2026 the owner, Bruno Macabeus, answered architecture
§12 item 4: **"Tune on tmc, no new ROM."**

**Decision.**

- **The owner's decision.** tmc is revealed (`bench run --reveal tmc`, `306eaf2`) and is tuning data; its
  misses are fixed with general rules and its remaining rows are classified like those of the other five
  tuning datasets. pokefirered and pokeruby stay sealed and must keep passing. `g2.held-out` is recorded as
  having no held-out ROM of a family absent from the tuning set: that waives its fresh-family condition
  (one passing ROM from a family absent from the tuning set), and the gate prints the waived condition with
  its grounds (`WAIVED: …, by the owner … on 2026-10-17 (D60; the owner's words …)`). The two-families
  condition (the passing ROMs span two codebase families) is not in the owner's words: fix round 1 waived
  it by inference (pokefirered and pokeruby, both `pret-gen3`, must pass and phase 2 then lands), and fix
  round 2 withdrew that (gate-honesty-r1-2, code-quality-r1-2), so the condition still applies and the gate
  fails on it, printing that it waits for owner question Q4 (phase-2.md, "Owner questions"). Once the
  owner confirms, the waiver's `grounds` gain the answer and the condition is waived with it. The waiver is bound to the facts it was decided on: the sealed datasets
  pokefirered and pokeruby by name, ROM SHA-1 and ELF SHA-256, and the tuning families fe-gba, kleod,
  pret-gen3, sat-r and zeldaret-tmc; any change to either ends it and needs a new decision. Every per-ROM
  threshold, the seal and "at least two sealed ROMs pass" still decide. The verdict is one function,
  `heldOutVerdict` in `test/gates/held-out-verdict.ts`, which the gate calls and the unit tests cover. This
  is the only gate change the decision authorises. A sealed pair of a fresh family is still needed before release 1 claims
  generality (D53).
Each rule below names its fixture (each `expect.json` fails with the branch reverted, checked by forcing
the branch's condition off) and its counter-check: where on the six tuning ROMs its condition holds, and,
since fix round 2 (overfitting-r1-1), where it decides an outcome (disabling it moves a row). Fix round 1
claimed generality for (e), (g) and (h) from the count of a precondition on several ROMs; that was wrong:
**the measured effect of the whole D60 rule set is on tmc only.** Each branch disabled at `f802822` moves
only tmc rows (review of `f802822`: the veneer array, the 2-mod-4 halfwords, the stub copies, the
forward-chain pointer test, the resume, the adr tests); with `seed.ram-copy` and
`accept.prologue-and-calls-accepted` both disabled, fe7j, klonoa, pokeemerald, sa2 and sa3 keep their
rows (tp 7,724, 556, 15,856, 2,892, 4,693, the same false entries, extents and code end) and tmc drops to
tp 8,597. So every rule (a) to (h) is single-instance in the sense of D53: its decisive conditions hold
on one ROM, its fixtures are self-authored, and tmc's after-numbers are no evidence of generality until a
sealed ROM of a fresh family passes.

- (a) **The gap scan resumes through the profile** (fill-gaps.ts `resume`): after a reading, at the
  halfword where it ends when `alignment.thumbFunction` allows a Thumb function there and the halfword is
  not padding (`idioms.isPadding` on both bytes), else at the next `alignment.cFunction` boundary. The PoC
  always took the next word, so libgcc's `_call_via_r8` … `_call_via_lr` (2-byte stubs at 2 mod 4) and an
  alternative entry `movs r3, #1; b …` right after a function were never candidates. Traversal, not a rule
  (D59 l): the profile decides where a function may start, the proposers what starts there. Fixture
  `gap-resume-2mod4`. Counter-check: fires once on pokeemerald (0x082DF012, found without it too, so it
  decides nothing there) and 9 times on tmc (8 entries recovered): decisive on tmc only, single-instance.
- (b) **`gap.end-anchor` takes a veneer-array element**: a two-instruction `ldr rN, [pc, #k]; bx rN` whose
  code ends exactly where an accepted stub of the same shape starts counts without `gapScan.minInsns` and
  without filling the hole (its pool lies after the array). Fixture `veneer-array`. Counter-check: 5
  times, all on tmc, in one array: single-instance.
- (c) **`gap.end-anchor` takes the halfword between two words** as a candidate when the profile lets Thumb
  functions sit there and it opens with `push {.., lr}` (`idioms.opensWithPushLr`), ranked as a prologue
  with the word candidates by the end anchor's one rule (fix round 1: it no longer skips the word
  candidate). Fixture `push-lr-2mod4` (both readings valid). Counter-check: once, on tmc (0x08007DCE):
  single-instance.
- (d) **`claim.dead-code-in-extent` leaves an unreached copy of the reading's own entry stub free**: when
  the reading opens with `movs rX, #k; b T`, an unreached `movs rX, #k'; b T` (same register, same target)
  inside its extent is another entry of a stub table that shares one tail, not dead code. Fixture
  `entry-stub-table`. Counter-check: once, on tmc (CreateSwampDrownFx): single-instance.
- (e) **`seed.ram-copy`** (new queue rule, origin `ram-copy`, profile field `ramCopy: { argInsns: 12,
  jumpInsns: 8 }`; copy recognition rewritten in fix round 1, `f39242a`, and widened in fix round 2):
  accepted Thumb code that calls a copy names [S, S + L) as the load image of code that runs at D. The
  copy is recognised by what the callee does, never by a fixed argument order: a BIOS CpuSet or
  CpuFastSet (an inline `swi 0x0B/0x0C`, or a `bl` to a stub that is the swi and a return;
  `foundation/rom/bios.ts`: r0 source, r1 destination, r2 a control word whose count and unit give L,
  CpuFastSet's count rounded up to a multiple of 8 words as the BIOS moves it, a fill copying nothing), or
  a copy loop (forward data flow over the callee tags the argument registers; a load through one
  argument's register makes it the source, a store through another's the destination, and the third is
  the size: in bytes when added to a pointer; the end itself when a copy pointer is compared with it,
  `cmp`, so L = end − that pointer's argument (fix round 2, overfitting-r1-3: `CopyWords(src, dest, end)`
  of the `code-copied-to-ram` fixture was declined before); else the store width over the one amount it
  is decremented by). S, D and L are the argument values in the straight-line run of at most `argInsns`
  instructions before the call (pool literals, `movs`, register copies, `adds`/`subs`, `negs`, `ands`,
  `orrs`, shifts; a call forgets r0..r3, r12 and lr). Since the review of `8fba183` (overfitting-r2-1) the
  run is straight-line in fact: it stops before a join point (a branch, jump-table or far-`bl` target of
  the reading; since fix round 2 of D61, overfitting-correctness-r1-1, also the reading's entry and the
  target of every `bl` of the reading, returning or noreturn) and at an instruction that does not fall
  into the next (an unconditional exit: a return, a register jump, a branch, a `bl` walked as a jump or
  that never returns; with every join in, it lies only right before a join and decides nothing alone);
  before, it walked back by
  layout across both and could read S, D and L from code that never flows into the call. Negative fixture
  `ram-copy-args-straight-line` (arguments loaded before a `pop {pc}`, the call reached only from a `beq`:
  the old scan maps a veneer's IWRAM pointer into a data object and proposes the false ARM entry
  0x08000138), and unit cases for each stop (the join test alone decides the case where the setup falls
  into a call that a `bne` also reaches; in a walked reading an instruction after an exit is always a join
  point, so the exit test is the straight line's definition rather than a separate decision). Measured: no
  row, extent, code end or analysis digest moves on the six tuning ROMs or the sealed pair. D lies in IWRAM and [D, D + L) fits in it (the memory map's 32 KiB). **The windows are
  set from the tuning set's distribution with a stated margin, not derived from codegen** (fix round 2,
  overfitting-r1-2: the "3 × 2 + 2" derivation was contradicted by tmc's own setup, whose size argument
  takes three instructions): the shortest window recovering all three arguments of each of the 15 copy
  calls the rule recognises on the six tuning ROMs is 3 (6 calls), 4 (2), 6 (6, the m4a CpuSet on every
  ROM) or 7 (1, tmc); `argInsns` is the maximum plus five, 12 (7, 8, 12 and 16 give the same rows on all
  six; 6 loses tmc's 4,956-byte block), and fixture `ram-copy-setup-bound` has a setup of exactly 12, so
  11 fails it. The jump after an IWRAM pointer load has its own window, `jumpInsns` 8. Fix round 2 wrote
  "the 39 jumps … take 1 (33), 2 (2), 3 (2) or 5 (1)", which does not add up (38) and counted tmc's load
  sites alone; re-measured after the review of `8fba183` (code-quality-r2-1, overfitting-r2-2,
  gate-honesty-r2-5, code-quality-r2-3), one count per load site (the cartridge entry's extent shares the
  startup's load, two tmc entries share one): the 46 sites the rule finds on the six ROMs (fe7j 1, klonoa
  1, pokeemerald 1, sa2 2, sa3 2, tmc 39) take 1 (40), 2 (2), 3 (3) or 5 (1) instructions, 40 + 2 + 3 + 1
  = 46, and the copy calls of the argument window are 15 per site as above (fe7j 2, klonoa 1, pokeemerald
  1, sa2 3, sa3 5, tmc 3; 6 + 2 + 6 + 1). 8 is the maximum plus three. Only the jumps at 1 decide a
  function on the six (every window from 1 to 16 gives the same functions), so the window rests on the
  distribution and on a unit test that pins it: a jump exactly 8 instructions after its load is found
  with the profile's 8 and missed with 7. An IWRAM pointer P in (D, D + L) that accepted code loads from its pool and jumps through
  (`bx`, `mov pc`, `bl` to a `bx rN` stub of that register, libgcc's `_call_via_rN`) names the entry S +
  (P − D), Thumb when P is odd, when it opens a function: the instruction before it is an unconditional
  exit, or the word before it is a literal pool (claimed as one, or a pool of the reading of another
  entry the accepted jumps name in the block; fix round 2, overfitting-r1-5: a pool word decodes as
  whatever instruction it happens to be, so the exit test alone declined every entry after a pool), and
  no lower entry proposed with it reaches it. A pointer equal to D is not used: the copy names the
  block's start already, and mapping a block from its start is phase 6's `runs_at` (§6.7). Re-measured in
  fix round 2, now that the end-pointer loop is recognised: mapping it changes no bench row on the six
  tuning ROMs (only origins: the analysis digests of fe7j, klonoa, sa2 and sa3 move) and adds the false
  entry 0x0800012C to `code-copied-to-ram`, the load image of a routine the ELF types only at its IWRAM
  address. IWRAM only and jumps only: EWRAM copies and stored pointers gave false entries on pokeemerald
  and fe7j. Stateless: each (copy, jump) pair is proposed when the later of its two functions is accepted;
  a callee is read only for a call whose r0..r2 hold an IWRAM address, a ROM address and a third known
  value. Fixtures: `ram-code-entries` (a source-first copy routine), `ram-copy-memcpy` (agbcc C
  `CopyBytes(dest, src, n)`), `ram-copy-bios` (CpuSet in 32-bit units and CpuFastSet of 10 words),
  `ram-copy-setup-bound` (the argument window), `ram-copy-call-via` (the `bl _call_via_r3` jump; without
  it tmc loses 9 true positives at fix round 2, 24 before the pool boundary; code-quality-r1-1), `ram-copy-entry-boundaries` (the
  end-pointer loop, a declined fall-through entry, an entry after a pool); each fails with its branch
  reverted, and the unit tests cover the CpuFastSet rounding and the clause that declines an entry inside
  a lower proposed entry's code. Counter-check (where the rule's condition holds, and where it decides):
  the copies are recognised on all six ROMs (fe7j 2, klonoa 1, pokeemerald 1, sa2 3, sa3 5: the m4a
  SoundMainRAM CpuSet on all five, plus game copies to IWRAM; tmc 3), but on the five every jump points at
  its block's start, so the rule names 0 entries there and disabling it (`bench run --disable
  seed.ram-copy`) leaves their analysis digests unchanged: **its decisive effect is on tmc only**, where one copy (InitOverlays' MemCopy of the 4,956-byte block) names
  38 entries, 11 accepted. Single-instance in the sense of D53: one block of one ROM. Its own count on tmc:
  of those 11 proposals 2 are labels the ELF does not type (0x080B1AA8, 0x080B1B0C, `pointer-entry`:
  genuine entries reached through veneers); disabled, tmc loses 33 true positives and 6 false entries
  (those two and four that other rules find inside the block it brings into the code). The fix-round-2
  changes leave every bench row of the six ROMs and both sealed ROMs unchanged; on tmc the pool boundary
  moves origins and two unsized extents (analysis digest `d8aac78c…` → `5c747e55…`: arm_CalcCollisionDirection
  and arm_DrawEntities are now taken by this rule, `sub_080B255C`'s extent ends at 0x080B299C instead of
  0x080B280C and `sub_080B2874`'s at 0x080B289C instead of 0x080B299C, both FUNCs of size 0, so no extent
  row moves). (e), (f) and (g) form one chain: (f) and (g) decline words and labels inside the same
  copied block of the same ROM, which only (e) brings into the code.
- (f) **`gap.forward-chain` declines a word holding an accepted Thumb function + 1** (word-aligned, odd,
  the word − 1 a function): a literal pool word, not code; the skip slot steps over it. Fixture
  `pointer-word-in-gap`. Counter-check: declines 6 words, all in one pointer table of tmc's copied block:
  single-instance (part of the (e) chain).
- (g) **`seed.adr` proposes only unclaimed words that read as ARM code**: an adr onto claimed words (code,
  the function's own extent included, since an accepted function's code is claimed when its queue rules
  run: a return address, a table of its own; a pool or a table) names a label or data, and one onto
  undecodable words names data. Fix round 2 (overfitting-r1-6) removed the separate own-extent clause of
  `72e97d8`: deleting it changed no fixture and no row on the eight ROMs, because the claim test already
  declines those targets. Fixture `adr-label-and-data` (negative). Counter-check, per sub-condition: the
  claim test declines the startup code's adr onto the interrupt handler on all six ROMs, a target that is
  already a function (no decision), and 2 targets on tmc inside their own function's extent (0x080B2440,
  0x080B286C, claimed as that function's code); the decode test declines 3 targets on tmc (0x080B1D8C, 0x080B1FEC,
  0x080B1FFC), the only declines that move rows (without it tmc gains 15 false entries, 3 unlisted, review
  of `f802822`). On the five the rule keeps every adr target (fe7j 2, klonoa 1, pokeemerald 2, sa2 1, sa3
  1: the interrupt handlers). Its decisive effect is on tmc only, inside the block (e) brings into the
  code: single-instance.
- (h) **`accept.prologue-and-calls-accepted`** (new accept rule, after `accept.pointer-table-run`): a
  valid data-pointer candidate with a word-aligned prologue, a return and at least one call, every call on
  an accepted function, is taken: three independent signs of a function that bytes of data do not show by
  chance. Fixtures: `data-named-between-data` (positive: disabling the rule loses ScriptCallback) and,
  since fix round 2 (overfitting-r1-4), `data-frame-not-function` (negative: three blocks of data named by
  a command table that decode as a word-aligned `push {lr}` frame; dropping the call clause takes the one
  without a call, `some` instead of `every` takes the one calling the middle of a function, dropping the
  return clause takes the one that spins). Counter-check (where each condition decides, measured by
  disabling it on the six tuning ROMs): the prologue clause decides on the real ROMs (without it fe7j has tp
  7,720 instead of 7,724, pokeemerald 15,855 instead of 15,856, and a sealed ROM fails; review of `f802822`); the call and return clauses decide no bench row
  on any of the six (without both, rows identical, only origins move), so the measured false-acceptance
  rate below (967 candidates on the six ROMs: fe7j 392, klonoa 5, pokeemerald 288, sa2 98, sa3 98, tmc 86,
  346 with exactly one call, every one an ELF function) is a measure of "data-pointer origin plus a
  word-aligned prologue" on real code, and the call and return clauses rest on the negative fixture
  alone. Its side effect on the five: those 881 candidates were functions of the result already, taken
  later by other rules; the rule takes them in an earlier grow round, which moves the origins of their
  callees (fe7j 2,122 functions, pokeemerald 1,234, sa3 202, sa2 149, klonoa 13) and shortens fe7j's grow
  (8.6 s → 1.2 s), with no row change. Its decisive effect on a row is one tmc function
  (CreateDustFromScript): single-instance.
- (i) **Categories.** `unreached-tail` (code after a hand-written function's return that nothing reaches,
  folded into that function by the ELF) and `pointer-entry` (another entry point of hand-written code,
  reached by a jump through its address: a veneer, `bl _call_via_rN` with its address, or a stored
  function pointer, which the ELF only labels; fix round 1) are new, and both are carried by tmc's rows
  only (unreached-tail 2, pointer-entry 4): they are categories of one ROM, shown on no other tuning ROM and
  in no fixture. `second-entry` keeps its M5 definition (bl-reached helpers: fix round 1 reverted the
  widening that covered `seed.ram-copy`'s own false entries), and so, since fix round 2, does
  `untyped-leaf` (a leaf reached by `bl`; gate-honesty-r1-8): its widening to "through `bl _call_via_rN`"
  covered tmc's 0x080B197C, which no `bl` reaches at its ROM address (code reaches its IWRAM address
  through `bl _call_via_r4`), so that row is `pointer-entry`. `split-after-returning-call` keeps its
  widening from "after `bl _call_via_rN`" to any call whose callee returns (a `bl` to a returning helper,
  or `mov lr, pc; bx rN`), recorded here as different from the reverted ones: it names the same split of
  the truth's disassembler by another call instruction, and the rows it covers on tmc (0x080AF900,
  0x080B20AC) are misses the pinned PoC's own run of tmc has too, not entries a D60 rule added. The cost of
  (e) to (g) in false entries is reported, not hidden by the categories (overfitting-r1-8): tmc's false
  entries went from 8 at `d645160` (the PoC's own run: 7) to 12, precision 99.92% to 99.86%; all 12 are
  listed, 6 of them inside or reached from the block (e) brings into the code. (`unsized-last-function`,
  the category of the withdrawn `codeEnd` row, is gone with it.)
- (j) **Restored by the owner's answer to Q5 (18 October 2026, D61 a: "Use $d for every ROM"); the record of its withdrawal follows.** Withdrawn (fix round 2 of D60): the code-end convention stays the one of phase 1. Fix round 1
  replaced the dataset `codeEnd` row of `80762ff` with a scorer convention, `elfCodeEnd` in
  `bench/src/truth.ts`, that ended an unsized function (hand-written asm without `.size`) at the first data
  mapping (`$d`) or typed symbol after it, in the tuning and the sealed scorer. The review of `f802822`
  (gate-honesty-r1-1, a blocker) found that this changed the ruler of `g2.code-end` and of the sealed
  verdict without the owner: romlift's tmc output is the same under every reading (analysis digest
  `d8aac78c…`), and only the `$d` reading lets tmc pass. Measured on tmc (`sub_080B299C`, FUNC size 0 at
  0x080B299C, `$d` at 0x080B2A30, the next typed symbol at 0x080B2A70): +148 under the phase-1 convention
  (fail), −64 under the pool-inclusive one (fail), 0 under the `$d` one (pass); klonoa +4 and fe7j +8
  under the phase-1 convention, 0 under the `$d` one; pokefirered and pokeruby 0 under both. So
  `elfCodeEnd` is again the largest addr + size of the ELF's functions (an unsized function ends where it
  starts), the PoC's convention and that of every scorer since phase 1, and `g2.code-end` and `bench
  regression` fail on tmc at +148. Whether the convention may change for every ROM, tuning and sealed, is
  owner question Q5 (phase-2.md); the rejected reasons of fix round 1 (the pool-inclusive reading puts the
  end 64 bytes past every reading of the shared pool's last user) are facts for that answer, not a choice
  made here.
- (k) **Withdrawn (fix round 1 of D60).** `747293f` made confirm mode take the listed entries after the
  passes, in discover's order, revising D8 without the owner; with the gate's listed set being discover's
  own output, confirm then replayed discover step for step and `g2.confirm-equals-discover` held by
  construction (0 unlisted on every ROM). It is reverted: D8 stands (a listed entry that is not a label is
  a function from round 0). The gate fails on tmc, on six functions of hand-written code with several
  entries (0x08004274, 0x080042B8, 0x080042BA, 0x080043AC, 0x08008790, 0x080B1A8C; one, 0x08004274, already
  at `d645160`), and passes on the five other tuning ROMs. A fresh reading at take time (dropping the
  epoch's candidate reading) removes two of the six (0x08004274, 0x080043AC) and changes epoch semantics
  (§4.2); D8's `resettle` stage, re-reading under the final function set, would make every entry inside
  another found extent a boundary of the function around it (34 such entries on tmc, 7 to 9 on each other
  tuning ROM: the startup piece and the m4a mixer's inner entries). Which remedy, if any, is the owner's
  (phase-2.md, "Owner questions").
- (l) **The pinned PoC measures tmc too** (fix round 1 of D60, replacing the exemption of `72e6049`, under
  which the `scaffold` family was not asked of tmc and its PoC floors were a vacuous 0). The pinned PoC's
  results never covered tmc, but its code runs on it: `export-poc --mode scored` gives the child romlift's
  dataset (name, ROM, ELF, SHA-1 and lists) for a ROM the PoC checkout has no file of, never writing into
  the checkout. Measured at the pinned PoC source: 8,591 functions, tp 8,582, 54 misses, extents 8,388 /
  8,388, deterministic, and its scaffold rebuilds tmc's SHA-1 (scaffold OK). So the `scaffold` family runs
  on tmc like on the five; `bench poc-check` checks tmc's dump (romlift's rescoring equals the PoC's own
  row of it, scaffold, determinism, pinned source; `baselineRow` false, no baseline row to compare); and
  `bench run` takes that row as tmc's PoC reference (`poc.source` `dump`): `g2.entries`' floor (tp 8,582),
  `g2.extents`' `lost` and `g2.baseline-rows`' diffs are measured, not vacuous, and a tuning ROM with no
  reference at all (`poc.source` `none`) fails those gates. Fix round 2 (gate-honesty-r1-5, code-quality-r1-4)
  pins that reference by content, as the baseline pins the five: `bench/baseline/poc-dump-rows.json` holds,
  per revealed ROM, the digest of the dataset romlift handed the PoC and the digest of the PoC's row
  (tmc: tp 8,582); the dump records the dataset digest it was made on; `bench run` and `bench poc-check`
  refuse a dump made on another dataset or whose row's digest is not the pinned one, and `export-poc
  --mode scored` checks a fresh dump against the file, rewriting it only with `--pin` (the Git diff is the
  review). `bench poc-check` now prints tmc's PoC row as equal to the pinned one, not n/a. The parity and queries modes, and
  `g2.poc-parity`, still cover the five: their evidence is the M1 lockstep at a commit that predates tmc's
  reveal, and `g2.poc-parity` fails on tmc at `landed` 1 (phase-2.md, "Owner questions").
- (m) **`bench/baseline/speed.json` holds tmc**, measured in the baseline's calibration.
- (n) **tmc's improvements over the PoC's own run are accepted diffs** (fix round 1): 49 misses removed
  and 2 false entries removed, each with its commit and reason in `bench/baseline/accepted-diffs.json`.
  The other 8 differences (7 false entries the PoC did not have, one miss whose reason changed) are not
  improvements and cannot be accepted, so `g2.baseline-rows` fails on tmc (phase-2.md, "Owner questions").

**Consequences.** tmc at `d645160` (sealed): 8,589 entries for 8,636 ELF functions, tp 8,582, recall
99.37%, 51 glued, 3 label candidates, 8 false entries, code end −4,130. After (a) to (n) and fix round 2:
8,643 entries, tp 8,631, precision 99.86%, recall 99.94%, 5 misses (`labels`), 12 false entries
(`untyped`), extents 8,388/8,388, code end +148 under the convention of phase 1 (romlift's code end is
where the unsized last function's instructions stop, the convention ends it where it starts; Q5). The pinned PoC's own run of tmc: tp 8,582, 54
misses, 7 false entries, extents 8,388/8,388, scaffold OK, pinned by content in
`bench/baseline/poc-dump-rows.json`. On fe7j, klonoa, pokeemerald, sa2 and sa3 every bench row is
unchanged (entries, true positives, misses, false entries with their origins, extents, code end: klonoa
+4, fe7j +8); analysis digests move only through (c) (two rejections on pokeemerald) and (h) (origins).
pokefirered and pokeruby still pass sealed with unchanged counts. 59 rules, 45 fixtures. Known
limitation: tmc's `arm_sub_080B1FE4`, a two-instruction ARM leaf after an ARM function, is read as Thumb
(the ARM gap scan needs three instructions; the bench scores addresses, not modes). Gates the decision
does not cover, each an owner question of phase-2.md: `g2.poc-parity` (no M1 evidence for tmc; Q1),
`g2.baseline-rows` (8 rows tmc has and the PoC's run of it does not; Q2), `g2.confirm-equals-discover`
(6 functions on tmc; Q3), `g2.held-out`'s two-families condition (Q4), `g2.code-end` on tmc (+148; Q5);
phase 2 does not land until the owner answers them. (Answered on 18 October 2026: D61.)

**Rejected.** A per-dataset `codeEnd` row (`80762ff`; a switch only tmc carried, replaced by (j)).
Confirm mode taking the listed entries after the passes (`747293f`; it made the gate hold by
construction, replaced by D8 again, (k)). Not asking the `scaffold` family of tmc, and a vacuous PoC floor
for it (`72e6049`; replaced by the PoC's own run of tmc, (l)). Narrowing the roadmap's PoC thresholds to
the five ROMs (`28b9005`; not authorised; the thresholds apply to all six). Raising `phase.json` while
`g2.poc-parity` fails on tmc at `landed` 1 (`808513f`; it froze a fail). Mapping a pointer equal to the
copy's destination (measured at fix round 2, with `code-copied-to-ram`'s end-pointer copy recognised: it
adds a false entry there, the load image of a routine the ELF types only at its IWRAM address, and moves
no bench row on the tuning ROMs; mapping a block from its start is phase 6's `runs_at`). Trusting every
mapped pointer (the measured prototype: second entries accepted before their heads, three Thumb readings
of ARM code at 0x080B19CC..0x080B19D4). Declining a mapped entry whose previous `b` jumps into its own
straight line, or whose straight line falls into code a lower entry holds (measured in fix round 1: the
gap scan then finds 0x080B1AA8 and 0x080B1B0C in Thumb mode, the wrong mode, with the same counts).
Requiring two calls in (h) (its measured false-acceptance rate is 0 of 967). Pre-settling every listed
seed in confirm mode (10 differences on tmc), and deferring the listed seeds while keeping them functions
from round 0 (11 differences).


## D61. The owner's answers of 18 October 2026 to the phase-2 owner questions

**Context.** Fix rounds 1 and 2 of D60 withdrew every gate change the owner had not authorised, and left
five owner questions (phase-2.md, "Owner questions", Q1 to Q5): four gates failed on tmc and `g2.held-out`
on its two-families condition. On 18 October 2026 the owner, Bruno Macabeus, answered them. His words,
verbatim, and the meaning applied:

- **Q1 and Q2** (`g2.poc-parity` and `g2.baseline-rows` on tmc): **"Keep tmc as 99.94%. It's a benchmark
  row that we can improve later"**. Meaning applied: tmc is a benchmark row at its current numbers, not
  held to the PoC-comparison gates. `g2.poc-parity` is scoped to the five ROMs of the M1 evidence and
  prints "tmc: not applicable, no M1 lockstep run"; `g2.baseline-rows` accepts tmc's rows that are listed
  with a category (the PoC never ran tmc when it was pinned), and tmc's current row (tp 8,631, recall
  99.94%) is the baseline later work must not regress. The five original ROMs stay exactly as strict.
- **Q3** (`g2.confirm-equals-discover` on tmc), the option chosen: **"Build resettle, else accept"**. D8's
  `resettle` stage is built as the architecture designs it; if it changes any row, extent or code end on
  the other tuning ROMs or the sealed pair, it is reverted and the 6 tmc differences are recorded as a
  known phase-2 limitation that the gate reports explicitly (not a silent pass), scoped to tmc only.
- **Q4** (`g2.held-out`'s family conditions), the option chosen: **"Waive both"**. Both family conditions
  are waived with these grounds; pokefirered and pokeruby must still pass sealed, and the gate prints the
  waiver.
- **Q5** (the code-end convention), the option chosen: **"Use $d for every ROM"**. Meaning given: the ELF's
  code end ends an unsized function at the next `$d` mapping symbol (or typed symbol), for every ROM,
  tuning and sealed, in every scorer; record the before/after per ROM (tmc +148 → 0, klonoa +4 → 0, fe7j
  +8 → 0, others 0). (Fix round 1 of D61 restored "in every scorer", which this record had dropped,
  gate-honesty-r0-3. It kept one scorer on the PoC's convention and asked the owner about it as Q7 of
  phase-2.md; fix round 2 of D61 withdrew that reading and the question, because the meaning given
  already answers it: "in every scorer" covers the rescoring of the PoC's dumps too, (a).)
- **Q6** (`g2.confirm-equals-discover` on two more tmc functions, asked in fix round 3 of D60 and kept open
  through fix rounds 1 and 2 of D61), answered by the owner on 18 October 2026, the option chosen: **"Yes,
  cover all 8"**. Meaning given: the known limitation of `g2.confirm-equals-discover` on tmc (e) also covers
  0x080B255C and 0x080B2874: pin their discover and confirm records and the three claim runs
  (0x080B2874..0x080B289C, 0x080B2874..0x080B299C, 0x080B289C..0x080B299C) by content in
  `KNOWN_DIFFERENCES.tmc` next to the six, as measured at HEAD, printed like the six. This is the only gate
  change the answer authorises; (g).

These are the only gate changes the answers authorise; no other gate, threshold or check is weakened,
skipped or removed.

**Decision.**

- (a) **Q5, the code end** (`bench/src/truth.ts` `elfCodeEnd`). An unsized function (hand-written asm
  without `.size`) ends at the data mapping symbol (`$d`, `$d.*`) or typed symbol (FUNC with the Thumb bit
  cleared, OBJECT, SECTION) that closes its last code run: the first one after the last code mapping
  symbol (`$t`, `$a`, numbered or not) that precedes the next typed symbol, or after the function's start
  when there is none. A sized one ends at addr + size. One convention for every ROM, tuning and sealed, in
  every scorer: the tuning scorer (`score.ts` `scoreAnalysis`), the sealed scorer (`seal.ts` through
  `analysis-run.ts`) and, since fix round 2 of D61, the rescoring of the PoC's own dumps (`score.ts`
  `scoreRun`: `bench poc-check`, `g1.bench-harness`). Measured (`bench run`, against `8fba183`): tmc +148 →
  0, klonoa +4 → 0, fe7j +8 → 0, pokeemerald, sa2, sa3, pokefirered and pokeruby 0 → 0; no other count and
  no analysis digest moves.

  *Fix round 2 of D61.* (i) Q7 is withdrawn: fix round 1 had kept the PoC-dump rescoring on the PoC's
  convention (`pocCodeEnd`) and called it an interpretation, but the meaning given with the answer says "in
  every scorer", which already decides it (gate-honesty-r1-1, overfitting-correctness-r1-4,
  code-quality-r1-2). Fix round 1's text also said no gate depended on it; that was wrong: the exception is
  what kept `g1.bench-harness` passing without a re-pin. (ii) The PoC's rows (`bench/baseline/
  poc-2026-10-16.json`; the PoC's own row of tmc, pinned by digest in `poc-dump-rows.json`) are the PoC's
  output, pinned by content (D50), and the PoC's fresh run reproduces them, so they are not rewritten.
  `bench poc-check` compares the rescored row, now under `$d`, with each reference as the scorer measures
  it (`poc-check.ts` `asScored`: `codeEnd.elf` the `$d` end, the delta recomputed from the reference's own
  found end, every other field as it is), and checks separately that the reference's `codeEnd.elf` and
  delta are the PoC's convention's on that ELF (`pocCodeEnd`, now read only there), so the harness still
  reproduces the PoC's numbers under the PoC's ruler. The two together are the old field-for-field
  comparison; nothing is excluded. Measured: `bench poc-check` exits 0 on the six; the rescored PoC rows'
  code end fe7j +8 → 0, klonoa +4 → 0, pokeemerald, sa2, sa3 0; tmc's PoC row (found 0x080B197A) −4,130 →
  −4,278. romlift's own rows do not move. (iii) The end is the `$d` that closes the last code run rather
  than the first `$d` (overfitting-correctness-r1-2): hand-written asm often puts an inline pool
  mid-function and resumes code (1,557 of fe7j's 6,265 unsized FUNCs, sa3 193 of 387, tmc 5 of 249,
  klonoa 1 of 77, measured by the reviewer), so the first `$d` is not where the assembler stopped emitting
  the function's instructions. No ROM's maximum moves (fe7j 0x080C0C50, klonoa 0x08051BD4, pokeemerald
  0x082E952E, sa2 0x080979F6, sa3 0x080CE438, tmc 0x080B2A30, pokefirered and pokeruby code end 0). Unit
  cases: `$t, $d, $t, $d`; a code mapping symbol past the next typed symbol; a sized function ending past
  an unsized later one decides (gate-honesty-r1-2, the case `3f7898f` had deleted). The fixture
  `code-end-unsized-last` now has an untyped pool between the unsized function and the OBJECT, so the
  `$d` (0x08000108), the next typed symbol (0x08000110) and addr + size (0x08000100) differ
  (overfitting-correctness-r1-3).
- (b) **Q4, the family conditions of `g2.held-out`** (`test/gates/held-out-verdict.ts` `FAMILY_WAIVER`). The
  waiver's `grounds.twoFamilies` holds the answer ("Waive both"), so both family conditions are waived and
  printed (`WAIVED: …`) with their grounds, each with its own date and decision (fix round 1 of D61,
  gate-honesty-r0-4: the two-families condition prints 2026-10-18 and D61 b, the fresh-family condition
  2026-10-17 and D60; the unused `pending` field is gone); its binding (the sealed pokefirered and pokeruby by name, ROM
  SHA-1 and ELF SHA-256, and the tuning families of D60) is unchanged, and the count of passing sealed ROMs
  (at least two) and every per-ROM threshold still decide. Measured: `g2.held-out` passes, pokefirered and
  pokeruby pass sealed with unchanged counts.
- (c) **Q1, `g2.poc-parity`** (`test/gates/poc-parity-check.ts`). `SCOPED_OUT` holds tmc with the owner's
  words; the gate judges the five ROMs of the M1 evidence exactly as before (parity digest, rows, every
  lockstep set, the commit an ancestor of HEAD, the pinned PoC source) and prints "tmc: not applicable, no
  M1 lockstep run". With the review of `8fba183` (gate-honesty-r2-1) the gate's check once frozen is its own
  check (`parityCheck`), not a coverage test, so once `phase.json` is raised it is `historical` only when
  that check passes on its scope. Since fix round 1 of D61 (code-quality-r0-6) there is no separate
  `historicalCheck`: the harness runs every gate's `run` once frozen and records `historical` when it
  returns, `fail` when it throws (`gate.ts` `gateStep`); `test/unit/gates/gate.test.ts` runs the harness
  at `landed` 2 on a gate whose run throws (`fail`) and one whose run returns (`historical`). A
  scoped-out name that is no tuning dataset fails as stale.
- (d) **Q2, `g2.baseline-rows`** (`test/gates/baseline-rows-verdict.ts`). `BENCHMARK_ROWS` holds tmc with the
  owner's words and its floor, tp 8,631 of 8,636 ELF functions (recall 99.94%). For tmc (its PoC reference
  the pinned PoC's own run, `poc.source` `dump`) an unaccepted row of the kinds a dataset row carries (a
  miss added or changed, a false entry added or changed) passes when the run's row lists it with a category,
  and the gate prints each such row with its category; any other unaccepted row (an extent change, an
  unlisted or uncategorised row) and any stale accepted diff still fail, and tp or recall below the floor
  fails. Every other ROM, and any revealed ROM the owner did not name, is judged exactly as before. Measured:
  tmc's 8 rows (0x08008B2E `unreached-tail`; 0x080B197C, 0x080B1AA8, 0x080B1B0C, 0x080B21B0
  `pointer-entry`; 0x080B20AC `split-after-returning-call`; 0x080B2718, 0x080B27E4 `local-subroutine`) are
  accepted as listed, 51 improvements as before, tp 8,631 at the floor; the five unchanged. The roadmap's
  narrowing of `28b9005` (D60, Rejected) stays rejected for every ROM but tmc.
- (e) **Q3, `g2.confirm-equals-discover`.** D8's `resettle` stage was built (`f287b0d`: after the passes, in
  both modes, every accepted function read again under the final function set, its own claims released
  while it is read, until no reading changes, then every reading claimed again) and measured: it cuts the
  cartridge entry's extent at the startup piece on every ROM (the startup region shrinks to one 4-byte
  piece, the startup pieces become unlisted false entries: fe7j 0x080000C0 and 0x080001F8, pokeemerald
  0x08000204, 0x08000248 and 0x08000374, sa2, sa3 and tmc 0x080000C0), changes the m4a mixer's extents on
  pokeemerald, sa2 and sa3, moves the sealed pair's counts (entries 12,395 → 12,398 and 11,461 → 11,464),
  makes the gate fail on klonoa, pokeemerald, sa2 and sa3, and leaves tmc's 0x080042BA different; `bench
  regression` against the commit before it: 8 failures. By the owner's condition it is reverted
  (`af0f75c`). tmc's six differences of Q3 (0x08004274, 0x080042B8, 0x080042BA, 0x080043AC, 0x08008790,
  0x080B1A8C) are a known phase-2 limitation: `test/gates/confirm-differences.ts` compares the two views in
  full (every differing function and claim run, not the first). Since fix round 1 of D61
  (gate-honesty-r0-1) the limitation is pinned by content: `KNOWN_DIFFERENCES.tmc` holds each of the six
  functions' discover and confirm records (mode, extent, far verdicts) and the one differing claim run
  (0x080087D2..0x08008886, owned by 0x08008790 in discover, unowned in confirm), as measured at `9c8b282`
  (identical at `95b257b^` and `5e18731`), and the gate accepts tmc only when its differences equal those
  records exactly, printing them as `KNOWN LIMITATION: …` every run. A known function whose record changed
  or that vanished from a view fails as a changed limitation; any other differing function or claim run
  fails wherever it lies; a known difference gone, all six included (the gate judges every ROM, equal
  digests or not; gate-honesty-r0-2), and a record whose ROM is not a tuning dataset fail as stale; every
  other ROM must have no difference. Since fix round 2 of D61 (code-quality-r1-5) every failure message
  gives the count and the first four records of each list (uncovered functions, changed functions,
  extra and changed claim runs). **Measured: tmc has eight differing functions at HEAD, not six.** Q3's count was
  taken at `9c8b282`; `95b257b` (fix round 2 of D60, the pool boundary of `seed.ram-copy`) moved two more,
  0x080B255C (discover ends it at 0x080B299C, confirm at 0x080B280C) and 0x080B2874 (0x080B289C against
  0x080B299C), the same class (two ARM entries proposed by one worklist, read in ascending order, the
  lower one's reading running over the higher). The owner's answer names six, so the two are not covered:
  the gate fails on them, printing why (that text for these two addresses only; any other extra function
  is printed as "not covered by D61 e"), and they are owner question Q6 of phase-2.md, answered in (g).
- (f) **The binding of the tmc scopings** (fix round 1 of D61, overfitting-correctness-r0-4). (c), (d) and
  (e) were keyed by the dataset name alone. Each now holds the ROM SHA-1 and ELF SHA-256 the answers were
  given on (`test/gates/dataset-binding.ts` `TMC_AT_D61`: `b4bd50e4…`, `7d27e8d9…`), as (b) holds the
  sealed pair; for a dataset of that name with another ROM or ELF the scoping is stale, fails, and the ROM
  is judged as without it until the owner decides anew. Since fix round 2 of D61 (code-quality-r1-4) the
  three are checked alike for staleness: a `SCOPED_OUT`, `KNOWN_DIFFERENCES` or `BENCHMARK_ROWS` record
  whose ROM is not a tuning dataset fails, and so does a `BENCHMARK_ROWS` record whose ROM's PoC
  reference is not the pinned PoC's own run of it (`staleBenchmarkRows`), which the verdict ignored
  before. One identity type (`DatasetIdentity`) and one order (`test/gates/order.ts` `byCodeUnit`) serve the
  three; `test/unit/gates/dataset-binding.test.ts` pins `TMC_AT_D61` to `bench/dataset/real/tmc.json` and
  tests `bindingMismatch` (code-quality-r1-6, r1-7).
- (g) **Q6, two more tmc functions** (`test/gates/confirm-differences.ts`). By the answer ("Yes, cover all
  8") `KNOWN_DIFFERENCES.tmc` holds, next to the six of Q3 and their claim run, the records of 0x080B255C
  (discover arm 0x080B255C..0x080B299C, confirm arm 0x080B255C..0x080B280C) and 0x080B2874 (discover arm
  0x080B2874..0x080B289C, confirm arm 0x080B2874..0x080B299C), no far verdicts in either, and the three claim
  runs: 0x080B2874..0x080B289C (kind 1, owner 0x080B2874, discover only), 0x080B2874..0x080B299C (kind 1,
  owner 0x080B2874, confirm only) and 0x080B289C..0x080B299C (kind 1, owner 0x080B255C, discover only), as
  measured at `51ea4ee`. The gate prints the eight and four claim runs as `KNOWN LIMITATION` every run, and
  everything (e) and (f) say holds for the two as for the six: exact records, any other difference fails
  wherever it lies, a gone or changed record fails, the binding to `TMC_AT_D61`. The `notCovered` text that
  printed the Q6 reason is gone with the question. `test/unit/gates/confirm-differences.test.ts` pins the
  eight and the four, and a ninth differing function (an ARM entry between the two of Q6) still fails as
  "not covered by D61 e".

**Consequences.** Measured at `8c60bf5` (phase-2.md, "The closing gate"): the six tuning rows keep
`8fba183`'s counts and analysis digests, every code end is 0, pokefirered and pokeruby pass sealed with
unchanged counts, and every g1 and g2 gate passes but `g2.confirm-equals-discover`, which fails on two tmc
functions beyond the six of Q3 (owner question Q6). With `phase.json` raised to 2 (`e1c3f64`) that gate
also fails `g1.provenance` and `bench provenance`, so `phase.json` is back at 1 and phase 2 does not land.
Nothing beyond the five answers is waived. After fix round 1 of D61, measured at `2c96faa`: the same rows,
counts and analysis digests, every closing command exits 0 but the real tier, which fails on that gate alone
(tmc's 0x080B255C and 0x080B2874, Q6), with the six of Q3 matching their pinned records. Fix round 2 of
D61 withdrew Q7 (the meaning given with Q5 answers it, (a)) and applied `$d` to the PoC-dump rescoring.
The owner's answer to Q6 ("Yes, cover all 8", (g)) is the last gate change of phase 2; the closing
measurements and the landing are in phase-2.md, "The closing gate".

## D62. Phase-3 component boundaries as executed, and the contract members emission needs

**Context.** Roadmap 3.0–3.I splits phase 3 into a lead, five parallel components (3.A model and layout,
3.B printer and code writers, 3.C data and linker writers and self-checks, 3.D write plan and commands, 3.E
bench emission families) and an integrator. As in phases 1 and 2 (D54, D56), a parallel component cannot be
proven alone against exports that are not merged, and freezing the phase's types showed places where the
edge table of architecture §2 and the frozen types of §3.4 do not fit together: the re-encode and
text-layout checks (core/verify) need the printer's label resolution, but core/verify may import core/emit
only through tree.ts; `configFromDiscover` returns a `RomliftConfig`, a core/config type, but core/layout
may not import core/config; module inference proposes modules, but `ProposalSource` had no variant for a
proposer that is not an analysis rule. The owner asked for no checkpoints: every owner decision of
architecture §12 is built with its documented safe default (item 3 below).

**Decision.** Phase 3 runs as eight components in three waves on the branch `phase-3`, each on its own flat
branch `phase-3-<component>` and worktree (D56 h; roadmap.md, "As executed"):

- (a) (Amended by D65 k: a ninth component, `p3-fixture-goldens`, ran in wave 3.) **Wave 1**: `p3-lead` (this record; 3.0 and the shared primitives below), `p3-asm-text`
  (`foundation/asm/{statements,layout}.ts`, the parser of the directive subset romlift emits and the layout
  of statements to bytes, D49, built before the writers so the text-layout check and the writers share
  them) and `p3-bench-inputs` (the bench's phase-3 inputs: the pinned objdiff-cli version and its locator,
  the reference objects of the tuning datasets, the deterministic 32 MiB synthetic image of `g3.large-rom`).
  **Wave 2**: `p3-model` (3.A: `buildModel`, `encodeModel`, `legalBorders`, `inferModules`,
  `configFromDiscover`, the model codes), `p3-printer` (3.B: `emitTree`, `printChunk`, `core/emit/print/**`,
  the header, crt0, function, orphan and module writers, `romlift/internal`'s emission exports),
  `p3-data-verify` (3.C: the data, ldscript and symbols writers, `verifyModel`, `checkEntry`, `checkPaths`,
  the verify codes) and `p3-write-plan` (3.D's `planWrites`, the write-plan codes, `applyWrites`,
  `withProjectLock` and `linkCheck` in `romlift/node`). **Wave 3**: `p3-generate` (3.D's
  `core/workflow/generate.ts`, the `model --json` and `verify` commands in `cli/commands/lists/emission.ts`,
  `src/api/workflow-generate.ts`, `bench/src/large-rom.ts`, and `explain`'s phase-3 part, `item` and
  `chunk`, architecture §9.2, D35) and `p3-bench-scaffold` (3.E: `bench run --scaffold` with both printers,
  the readability and objdiff families, `bench speed`'s `generate` and `init` timings, the `bench
  large-rom` command). The lead integrates, refreshes `bench/results.json` and `bench/baseline/speed.json`,
  writes `bench/baseline/readability.json` (the first committed readability shares, the floors of
  `g3.readability`) once, raises `test/gates/phase.json` and runs the closing gate (phase-3.md).
- (b) **Where the shared primitives live.** The label resolver (`resolverFor`, `resolverOver`, `moduleAt`,
  `wordValueOf`), the item table (`itemTableBuilder`, `itemAt`, `findItem`) and the shared paths
  (`chunkPaths`, `moduleSource`, `buildUnits`, `modulePathPrefixes`) live in `core/model/{resolver,
  item-table,paths}.ts`, because the printer (core/emit), the self-checks (core/verify) and the write plan's
  `retained` prefixes all need them, and core/verify may not import core/emit beyond tree.ts.
  `core/emit/symbol-resolver.ts` is not created. `resolverFor` takes `Pick<Model, 'labels' | 'modules'>`
  (a whole Model satisfies it) and indexes the labels once per Model (a WeakMap keyed by its labels array);
  `resolverOver` indexes afresh, for buildModel while it assembles the labels. A label lies in the module
  whose run range (runs_at modules first), else load span, contains its address; inside a module it is
  visible when it is global or lies there; several labels at one address print in the order func, table,
  pool, local, data, then name. `itemAt(items, i, rom, runOffset = 0)` gains the optional run offset of a
  runs_at chunk (`runAt - span.start`), so an instruction decodes at its run address while its span stays in
  load addresses (§6.7, D46).
- (c) **`configFromDiscover` lives at `core/workflow/config-from-discover.ts`**, owned by `p3-model`: the
  edge table forbids core/layout to import core/config, and `RomliftConfig` is a core/config type, while
  core/workflow may import every core module. Its options, `ConfigFromDiscoverOptions`, are the inference
  options and nothing else, in `core/layout/types.ts` with `DEFAULT_MODULE_SIZE` (0x10000, D20). In phase 3
  it writes every code module as kind `'asm'` (architecture §6.1: "Every module is asm"); phase 4 switches
  the agbcc-shaped modules to `'c'` when the c-stub writer lands.
- (d) **Contract members added to architecture §3.4**, each the minimum emission needs:
  - `EmitContext.printer?: Printer` (`'readable' | 'raw'`, default `'readable'`), so `verify --printer raw`
    and `g3.raw-link` select the PoC's all-data emission through the same stream.
  - `PrintStats` (`insns`, `rawInsns`, `branches` (b, bcc, bl and blx-immediate in code items),
    `symbolicBranches`, `poolLoads` (PC-relative loads), `symbolicPoolLoads`, `rawReasons`) and
    `PrintedChunk { lines; stats }`: what `printChunk(rom, model, chunk: number, cx: EmitContext):
    PrintedChunk` returns and the readability family sums (`addPrintStats`). The readability shares are
    `1 - rawInsns / insns`, `symbolicBranches / branches` and `symbolicPoolLoads / poolLoads`, each 1 when
    its denominator is 0.
  - The writer contract `Writer { id; scope: 'module' | 'global'; emit(rom, model, cx, module: number |
    null) }` and the frozen stream order (core/emit/tree.ts): per generated module in ROM order, the entries
    of every module-scoped writer sorted by path (code units), then the global writers' entries (ldscript.txt,
    symbols.ld) sorted by path; a module whose `generated` is false yields nothing. The registry
    (`core/emit/writers/index.ts`) lists the eight phase-3 writers.
  - `WritePlanInputs.retained`: the path prefixes of the `generated = false` modules
    (`modulePathPrefixes`), never written and never deleted, which §6.4's policy names but the inputs could
    not express; `WritePlan { ops; manifest; diagnostics }` names planWrites' result; `GENERATED_ROOTS`,
    `ROMLIFT_DIR`, `MANIFEST_PATH`, `JOURNAL_PATH` and `LOCK_PATH` are constants of
    `core/write-plan/types.ts`; the manifest and journal codecs (`core/write-plan/{manifest,journal}.ts`)
    are implemented in wave 1 (a decode returns an error value, never throws); `Journal = { schema: 1; ops:
    { op; path; baseSha1?; resultSha1? }[] }`, derived from a plan by `journalOf` (a keep is left out).
  - `ProposalSource` gains `{ kind: 'layout'; reason: 'header' | 'startup' | 'asm-only' | 'module-size' |
    'data' }` for module inference, which is not an analysis rule, so a RuleId would be false provenance;
    like `'analysis'` it is never persisted, and `sourceKey` returns undefined for both.
  - The verify report: `CheckId` (`tiling`, `reencode`, `module-size`, `text-layout`, `paths`, `assemble`,
    `link`), `CheckResult { id; ok; detail; diagnostics }`, `VerifyReport { ok; checks }`, `checkResult` and
    `combineReports` (checks in `CHECK_IDS` order, one id merged). The wave-2 checks have the signatures
    `verifyModel(rom, model): VerifyReport` (tiling, re-encode, module size), `checkEntry(rom, model, entry:
    FileEntry): readonly Diagnostic[]` (the text layout of ONE entry, so the check pass streams the
    emission and holds no tree, §9.4) and `checkPaths(paths: Iterable<string>): readonly Diagnostic[]`.
    `g3.text-layout` requires the `paths` check with the text-layout check, as §6.4 runs them in one pass.
  - The model's item encoding is public with `model --json`: `ITEM_RAW_REASONS` (an `aux` raw-reason code
    is its index), `DATA_NOTES` (a data note code is its index plus one, 0 for none), `NO_SPEC` (0xFFFF), and
    a table entry's `aux` is its target with bit 0 set when the stored value carries the Thumb bit. A
    `ModelJsonItem` is `[kind, start, length, specId | null, aux]`, addresses spelled as the analysis codec
    spells them.
  - `Module.dataStart` and `ModuleConfig.dataStart` are left out of the phase-3 types: `data_start` is a
    phase-5 key (§6.6), and nothing ships before its phase. `RomliftConfig` carries a zod schema
    (`validateConfig`) for in-memory configs; core/config has no `codes.ts` in phase 3 (no raiser yet).
  - The build compilers: `BUILD_COMPILERS` holds `agbcc` and `old_agbcc` (`tools/agbcc/bin/<id>`, the flags
    `-mthumb-interwork -Wimplicit -Wparentheses -O2 -fhex-asm`, `templates/compilers/<id>.mk`).
- (e) **Codes.** The phase lead creates `core/{model,verify,write-plan}/codes.ts` empty and unions them into
  `core/diagnostic-codes.ts`; each owner adds its codes in the commit of their first raiser (D45): model
  `E_MODULE_BORDER`, `E_MODULE_ORDER`, `E_NAME_COLLISION`, `E_OVERRIDE_INVALID`,
  `W_CROSS_MODULE_SHORT_BRANCH`; verify `E_SELF_CHECK_TILING`, `E_SELF_CHECK_REENCODE`, `E_MODULE_SIZE`,
  `E_SELF_CHECK_TEXT`, `E_PATH_CASE_COLLISION`; write-plan `E_PATH_NOT_OWNED`, `E_STALE_EDIT`,
  `W_UNOWNED_FILE`.
- (f) **The seam.** `test/golden/analysis/<fixture>.json` holds, for every committed fixture, the canonical
  `encodeAnalysis` of its seedless discover run under `profileById('agbcc')`; wave 2 builds on it before
  `buildModel` exists, and `test/helpers/model.ts` builds small hand-made Models for the printer, writer,
  check and write-plan unit tests.
- (g) **The mutation tests of phase 3** (`test/mutation/phase3/**`, `g3.checks-fail`) are owned by the
  checkers' components: `tiling`, `reencode`, `module-size` and `text-layout` by `p3-data-verify`,
  `plan-writes` by `p3-write-plan`, not by the integrator as roadmap 3.I lists.
- (h) **Every phase-3 threshold applies to all six tuning ROMs**: D60 revealed tmc as tuning data and kept
  the thresholds for all six ("the thresholds apply to all six"), so the self-checks, the text-layout check
  and the raw link cover six ROMs, the readable link at least three of the six (target all six), and the
  readability and objdiff families all six. The gate files' comments say so; no threshold changed.
- (i) **Architecture §12 item 3 is built with its safe default** while the owner has not answered (D15): a
  short Thumb branch across a border the user moved prints raw with `W_CROSS_MODULE_SHORT_BRANCH` and is
  counted in the readability family; `init`-style configs never contain such a border.
- (j) **objdiff-cli** is located by `ROMLIFT_OBJDIFF`, then `PATH`, then
  `$ROMLIFT_BENCH_ROOT/objdiff/target/release/objdiff-cli`, at the version of `bench/tools/objdiff.version`
  (D34). Amended by D65 j: the repository's and the main checkout's `bench/.local/objdiff-target` builds come
  before `PATH`.

**Consequences.** Every wave-2 component typechecks against frozen types and implemented primitives, and owns
files no other component of its wave touches; the g3 gates stay `pending` until the exports they need land;
the resolver and paths have one definition for writers, checks and the write plan.

**Rejected.** `core/emit/symbol-resolver.ts` (core/verify could not import it). `config-from-discover.ts`
in core/layout (it would need a core/config edge the table forbids, or a second config type). A RuleId such as
`layout.infer` on module proposals (no such rule exists; provenance would cite a rule that is not one).
`checkTree(entries)` holding the whole stream (memory, §9.4). Stubbing `data_start` in phase 3 (nothing ships
before its phase).

---

## D63. Wave-2 integration: the interface changes the components made, and what linking them together found

**Context.** The four wave-2 components of phase 3 (`p3-model`, `p3-printer`, `p3-data-verify`,
`p3-write-plan`, D62 a) were built in parallel against the frozen types and merged into `phase-3` without a
textual conflict. Their reports name interface changes no record held yet. Put together for the first time,
the model, the printer, the self-checks and `linkCheck` were run on every committed fixture and every tuning
ROM, both printers: the raw printer's tree linked to the ROM's SHA-1 everywhere, while the readable printer's
tree failed to assemble on 2 of the 47 fixtures and on all six tuning ROMs, with every self-check green. GNU as
2.45.1 refuses two shapes the model allowed: a PC-relative load or `adr` naming a label in another object
("invalid offset", "undefined symbol ... used as an immediate value", "address calculation needs a strongly
defined nearby symbol"), and a reference to a `local` label the printer could not place because it lies inside
an item (an ARM `adr r0, X + 1` before `bx r0` into Thumb, the m4a mixer's mode switch, on klonoa, sa2, sa3,
fe7j and pokeemerald; a Thumb `adr` naming the second halfword of a `bl`, on tmc).

**Decision.**

- (a) **`legalBorders(rom, analysis)`** replaces `legalBorders(analysis, profile)`, and `inferModules(rom,
  analysis, options?)` and `configFromDiscover(rom, analysis, options?)` take no profile: finding the
  references that cross a border means decoding the code bytes, and buildModel, which has no profile and may
  not import the profile registry, must compute the same set as `init` and the TOML patcher. The borders rest
  on the ARM word (4 bytes), agbcc's alignment. `test/gates/g4.toml-mutations.test.ts` is aligned to the new
  call; nothing in it is weakened.
- (b) **No PC-relative load or `adr` crosses a legal border** (`pcRelativeRefs` in core/layout/borders.ts:
  Thumb `ldr rd, [pc, #]` and `add rd, pc, #`, ARM `ldr rd, [pc, #]` and `adr`, the references
  core/model/labels.ts `codeRefs` names), for the same reason short branches do not (D15): `as` cannot
  relocate one to another object. A border the user moves across one is `E_MODULE_BORDER`, as for a short
  branch. architecture §5's "far pools ... labelled global when another module loads them" is replaced: a far
  pool always stays in the module of the load that names it.
- (c) **The data start moves past the code's PC-relative words.** `codeLayout`'s data start is the analysis'
  code end rounded up to a word, moved past every pool word or `adr` target a reference of the code names
  beyond it: such a word belongs with the code that loads it. Measured on tmc, the only tuning ROM where it
  moves: ARM functions from 0x080B23F0 load a shared pool at 0x080B2A30..0x080B2A6C past the code end
  0x080B2A30, so the data start is 0x080B2A70; without the move, (b) made the inferred data module's start
  illegal (`E_MODULE_BORDER` on tmc's own config). The analysis' `codeEnd`, which the scorer measures, is
  unchanged.
- (d) **A `local` label is made only where an item can start**: never at an odd code address, the second
  halfword of a 4-byte instruction that names an address (a `bl`), the inside of an ARM word, or the inside of
  a pool or table word. The instruction naming such an address then fails the printing rule and prints raw
  (`no-roundtrip`), counted by the readability family; the m4a mixer's `adr r0, X + 1` prints as `.inst
  0xE28F002F @ adr r0, 0x0804F3A7 (no-roundtrip)` on klonoa.
- (e) **Contract members the components added**, kept: `printChunk(rom, model, chunk, how?: Printer |
  EmitContext)` (default `'readable'`; both callers of D62 d and the brief work); the included chunk files
  start with `.thumb`/`.arm`, not the dialect preamble, which only the unit files (`rom_header.s`, `crt0.s`,
  `<module>.s`, `data/<module>.s`) carry, because `as` refuses `macros.inc` twice; `WritePlanInputs.journal`
  (an interrupted run's journal: its paths count as owned, an edit it shows done is kept) and
  `WritePlanInputs.romlift` (the version on the new manifest), both optional; `checkEntries(rom, model,
  entries): VerifyReport` (the text-layout and paths results of one pass over a stream, naming a file the model
  needs that the stream lacks) beside `checkEntry`; `assembleCheck` beside `linkCheck` in `romlift/node`
  (each object's `.text` against its unit's ROM range outside its relocated fields, the `assemble` check id).
- (f) **The wave-2 round trip is a unit test**: `test/unit/emit/fixtures-round-trip.test.ts` runs, for every
  committed fixture and both printers, the model self-checks, `checkEntries` and (with binutils) `linkCheck`
  against the fixture's SHA-1. It is the ci-tier substance of `g3.self-check`, `g3.text-layout`, `g3.link`
  and `g3.raw-link` before wave 3 lands the commands those gates drive; it fails on the two fixtures without
  (b) and (c).

**Consequences.** On the integrated tree (phase-3.md, "Wave-2 integration"): all 47 fixtures and all six
tuning ROMs pass the model self-checks and the text-layout and paths checks, and link to their SHA-1 with
both printers. Only `adr-label-and-data` and `arm-pools-in-front` change their model goldens (one module
border each). The text-layout check passed every tree `as` refused: it does not check that a symbol an
instruction names is defined, nor that a PC-relative reference stays in its object; phase-3.md records it as a
limitation for wave 3, where `verify --assemble` and `g3.link` run the real toolchain.

**Rejected.** Printing a PC-relative reference into another module raw, like a cross-module short branch,
instead of (b): `init` would cut borders that make the readable tree less readable for no gain, and a new raw
reason would change the frozen `ITEM_RAW_REASONS`. Spelling the mixer's target `X + 1` (a label at the even
address plus an offset): the printing rule and the resolver have no offset form, and the instruction is in
hand-written assembly either way. Leaving the data start at the code end and exempting it from (b): tmc's
readable tree would still not assemble.

---

## D64. Closing phase 3: what the fix round changed, and the two gates it could not close

**Context.** The closing run of phase 3 (phase-3.md, "The closing gate") found, at `52ad363`: every
`generate`, `verify` and `init` run over the config `configFromDiscover` builds failed with
`E_PATH_CASE_COLLISION` (asm/crt0.s emitted twice; the two `todo` tests of wave 3); `g3.objdiff` failed on all
six tuning ROMs (45,414 differences on pokeemerald, 4,560 on klonoa, most of them pool words holding RAM
addresses that the base printed as plain values); `g3.speed-budget` measured pokeemerald's `generate` at
22.3 s and `init` at 26.9 s CPU (budgets 10 s and 15 s, calibrated 9.4 s and 14.1 s); `g3.large-rom`
measured 1,845.7 MiB (`init`) and 1,366.3 MiB (`generate`) peak RSS (budget 512 MiB); `g3.readability` had
no floor file. The orchestrator's brief takes every owner decision of architecture §12 with its safe default
and forbids weakening a gate.

**Decision.**

- (a) **`configFromDiscover` labels every entry inside another found extent, nothing clipped**
  (`coveredEntries`, the listed set `g2.confirm-equals-discover` builds), so the startup code inside the
  cartridge entry's extent is `label = true`. Without it the confirm run cut the cartridge entry at the
  startup code, read its `b` as a tail call and accepted the startup code as origin `call` before
  `seed.rom-entry` proposed it, the startup region shrank to four bytes, and the `crt0` module held a
  function chunk. The model and `codeLayout` keep the header clip of correctness-6 where they place chunks:
  a `label = true` entry that only the cartridge entry's extent covers (`headerCoveredEntries`) still
  starts a chunk (`isLabelEntry`). On the 47 fixtures the confirm run's functions, extents and startup region
  equal the discover run's, and the tree `generate` emits is the discover model's.
- (b) **A `[symbols]` entry outside the ROM names the pool words equal to its address.** It is a global data
  label that no file places and `symbols.ld` defines; the text-layout check resolves it through `[symbols]`
  as before. This is architecture §5's `ldr r0, _08001A3C @ =gFoo`, which the model did not implement (its
  labels held only the symbols inside the ROM). `configFromDiscover` writes no symbol, so no default tree
  and no golden changes.
- (c) **The objdiff base names the RAM symbols an ELF section defines**, beside the ROM data symbols D34
  already named, and leaves out absolute symbols (`REG_DMA3`, `INTR_VECTOR`), which the reference objects
  hold as plain constants. Differences per ROM, before and after (b) and (c): fe7j 1,296 → 256, klonoa
  4,560 → 320, pokeemerald 45,414 → 16,543, sa2 8,392 → 1,518, sa3 7,174 → 609, tmc 6,241 → 1,252.
- (d) **Generated files are written without a flush, an absent one in place.** architecture §6.4's "apply
  each op through a temporary file and a rename" is replaced by: the journal, the manifest, every `edit` and
  every scaffold or c-stub file go through a temporary file, an `fsync` and a rename; a generated file goes
  through a temporary file and a rename without the `fsync`, and one whose path does not exist yet is created
  in place with `O_EXCL` (synchronous calls). Recovery is unchanged in substance: the next run snapshots the
  sha1 of every generated path and the journal names its paths owned, so a file a crash left short or empty
  is rewritten; nothing a user wrote is touched without the flush. Measured on pokeemerald: `generate` and
  its write 22.3 s CPU (bench speed median, with the flushes) → 8.2 to 9.1 s warm with (d) and (e).
- (e) **Result-neutral speed and memory changes**: a built Reading keeps its instruction lengths in one byte
  array over its span, or a binary-searched pair of typed arrays when the span is sparse
  (`core/analysis/insn-lookup.ts`), not the walker's 4 KiB pages (210 MiB in 37,140 readings on the 32 MiB
  synthetic ROM); rejection keys are numbers (`2 * addr + arm`), not `${at}:${mode}` strings (47 MiB there);
  `factFrom` finds the dead runs of an extent with a native scan; the layout memo is keyed by slot (state,
  address mod 4) and then by the text itself; `hex()` formats eight digits from a byte table. The fixture
  goldens, `npm test`, the PoC parity and lockstep evidence and `epoch-reuse` are unchanged.
- (f) **The first readability floors** (`bench/baseline/readability.json`, D62 a) are the closing run's shares.

**Consequences.** `generate`, `verify --link` and `init` work on every fixture with the config
`configFromDiscover` builds, and the two `todo` tests pass; `g3.speed-budget` passes (pokeemerald `generate`
8,116 of 10,355 ms and `init` 9,674 of 15,532 ms CPU in the gate's own run) and `g3.readability` passes on its
floors. Two gates still fail and are owner questions in phase-3.md: `g3.objdiff` (Q1: what remains are naming
and comparison artefacts, classified there, which the gate as D34 writes it counts as failures) and
`g3.large-rom` (Q2: 1,019 to 1,495 MiB peak RSS measured against 512 MiB). Phase 3 does not land until the owner
answers them; nothing is waived.

## D65. Phase-3 fix round 1 of the review: what changed, and what stays with the owner

**Context.** The review of phase 3 at `9b3f244` (phase-3.md, "Review") found a blocker, eleven majors and
twenty-three minors. The brief takes every owner decision with its safe default and makes every gate change,
waiver or limitation the owner has not authorised an owner question.

**Decision.**

- (a) **The text-layout check models the section alignment of each build unit** (correctness-4). GNU as pads
  each object's section to the alignment it records (1 once Thumb state is entered, 2 for an ARM instruction, p
  for `.align p`, `.align 0` read as 2; measured with binutils 2.45.1), and ld places each section on it. A unit
  whose start or length is not a multiple of it fails text-layout, so a ROM whose size its last unit's
  alignment does not divide is refused before anything is written; the tree is not changed to make it link
  (owner question Q5).
- (b) **A case-only rename between runs deletes the old spelling first** (correctness-2): a tree path that only
  the case separates from a path the manifest or the journal lists is always written, and that old path's
  delete sorts before every other op (architecture §6.4).
- (c) **A `[symbols]` entry inside the ROM gets a label only where an item can start** (the D63 d predicate the
  local labels use); one inside an instruction, pool word or table entry gets none and is `W_SYMBOL_UNPLACED`.
  The text-layout check resolves through `[symbols]` only the entries outside the ROM, which symbols.ld defines
  (correctness-1). D64 b is unchanged.
- (d) **Names**: a function, alias or symbol name is a letter or `_`, then letters, digits, `_`, `.` and `$`
  (`foundation/asm/dialect.ts` isSymbolName); the config schema refuses others and buildModel raises
  `E_NAME_INVALID` (correctness-5). GNU as reads `$d` as a mapping symbol and `.text` as a section.
- (e) **Until the phase-4 c-stub writer, a module of kind `c` fails the check**: its source is a path the
  stream must hold (correctness-6). **`W_FUNCTION_OUTSIDE_ROM`** reports a `[functions]` entry outside the ROM
  and an `[[overrides]]` range reaching outside it (correctness-7).
- (f) **The re-encode check runs foundation/isa rawReason** for every instruction that names an address; only
  instructions that name none go through a cache keyed by their exact word (architecture-4). pokeemerald
  verifyModel 330-400 ms -> 610-700 ms.
- (g) **Plain data and one workflow** (architecture-2, -3): GenerateResult holds its EmitContext, not a
  closure (`generatedEntries` re-emits); core/workflow/generate.ts has the phase-3 `init` equivalents
  (`initConfig`, `initModel`, `generateFromRom`, `discoverModel`) and the pure `freshTreePlanInputs`;
  shell/project/fresh-tree.ts `writeFreshTree` is the one fresh-tree write.
- (h) **The toolchain verdicts are core's** (architecture-1): foundation/formats/elf.ts relocationsOf reads the
  relocations, core/verify/toolchain.ts decides `assemble` and `link`; link-check.ts runs the programs.
- (i) **The objdiff family** (delivery-1, -6): a function's base is assembled with the chunks of its module up
  to the far pools and adr targets it reaches (transitively), at the word phase it has in the ROM, so no base
  fails to assemble for a reason the tree does not have; a Thumb `b` and an ARM `bl` (addend -8) the reference
  resolved inside its object count as `resolved-call` like a `bl`. bench/src/objdiff-classes.ts and
  bench/tools/objdiff-classes.ts give Q1's classes from committed code. D34's gate is unchanged.
- (j) **Amends D62 j** (delivery-9): objdiff-cli is located by `ROMLIFT_OBJDIFF`, then the repository's
  `bench/.local/objdiff-target/release/objdiff-cli`, then the main checkout's (from a worktree), then `PATH`,
  then `$ROMLIFT_BENCH_ROOT/objdiff/target/release/objdiff-cli` (bench/src/objdiff-cli.ts findObjdiff), always
  at the version of `bench/tools/objdiff.version`.
- (k) **Amends D62 a** (delivery-8): phase 3 ran nine components; the ninth, `p3-fixture-goldens` (wave 3,
  branch `phase-3-fixture-goldens`, merged `f726652`), owned the writer goldens (`test/golden/writers/**`) and
  their test, `export-poc --mode raw` with `test/local/poc-raw-printer.test.ts`, `bench/tools/ci-digests.ts`
  (`@2`, the tree digests) and `test/local/emission-real.test.ts`, taking the writer goldens from 3.B and 3.C
  and the raw printer's PoC parity from 3.B.
- (l) **Records** (delivery-7) that the raw printer's PoC parity of roadmap 3.B ran narrowed: the local test
  feeds the PoC's own spans, labels and word kinds to printRawRange, so it proves the ported rawLines, not that
  romlift's tiling equals the PoC's. As a gate change the owner has not authorised it is owner question Q4.

**Consequences.** The blocker and the correctness majors are closed with tests that fail before their fix;
generate, verify and the bench share one workflow; the objdiff numbers move (phase-3.md, "Measured numbers").
The owner questions are Q1 to Q5 of phase-3.md (Q3: D64 d's durability, delivery-3; Q4: (l); Q5: the
limitations carried into phase 4). Phase 3 does not land until he answers them; nothing is waived.

## D66. Phase-3 fix round 2 of the review: what changed, and one recorded exception

**Context.** The review of fix round 1 (phase-3.md, "Review", fix round 2) found two majors (an objdiff classifier
whose same-word classes were not checked, architecture-r1-1; a case-only rename of a directory holding a file
romlift does not own, correctness-r1-1) and fifteen minors. The brief is unchanged: every owner decision takes its
safe default, and a gate change, waiver or limitation the owner has not authorised is an owner question.

**Decision.**

- (a) **A write gives its path the spelling the plan chose, on disk** (correctness-r1-1). Before a write or edit,
  shell/project/spelling.ts renames each existing component of its path that is the same directory entry under
  another case (same device and inode: a case-insensitive file system) to the op's spelling, through a temporary
  name; what the directory holds moves with it. readDiskState lists a file the walk finds under another case than
  an asked-for path, when both are one file, once, under the asked-for spelling. On a case-sensitive file system
  nothing is renamed and the other spelling stays another directory. Amends D65 b, which ordered the deletes but
  left a directory that did not become empty under its old spelling.
- (b) **Names are at most 200 characters, and no path component over 255 bytes passes the check pass**
  (correctness-r1-2): `foundation/asm/dialect.ts` MAX_SYMBOL_NAME bounds isSymbolName (and module names), so
  `<Name>_<ADDR>.s` fits the 255 bytes a file system stores per name; the paths check raises E_PATH_TOO_LONG.
  Amends D65 d.
- (c) **`W_OVERRIDE_OUTSIDE_ROM`** is raised for an `[[overrides]]` range reaching outside the ROM;
  `W_FUNCTION_OUTSIDE_ROM` only for `[functions]` entries (architecture-r1-14). Amends D65 e.
- (d) **Derived per-model indexes are memos keyed by the model's frozen arrays** (the exception
  architecture-r1-5 asked to record): core/model/paths.ts chunkPathsOf (by `model.chunks`, now shared by the
  writers and the text-layout check, so a generate computes the paths once) and core/model/resolver.ts's label
  index (by `model.labels`). Rejected: a field of the Model (it changes the public `romlift/model-json@1` lines and
  the 47 model goldens for data that is a function of the rest); a member of EmitContext or an EmitIndex passed to
  the writers (printChunk, resolverFor and the Writer contract take `(rom, model, ...)` and are frozen by D62 and
  public: the bench and the tests print chunk by chunk with only a printer, so every reader would still need the
  memo as its fallback). Correctness rests on a Model never changing, which its deeply readonly types state (D19);
  resolverOver indexes arrays that are still growing and caches nothing. To revisit when phase 4 reopens the writer
  contract for the C writers.
- (e) **Plain data** (architecture-r1-12): DecompState.defined is a `readonly string[]` in code-unit order, not a
  Set, so a GenerateResult's fields other than the model survive a JSON round trip. Amends the frozen
  core/emit/tree.ts type (D62); no writer reads it before phase 5.
- (f) **checkEntry takes the pass's index** (architecture-r1-9): `checkEntry(rom, model, index, entry)` with
  `textLayoutIndex(model)`, exported from `romlift`, built once per pass.
- (g) **The objdiff classifier checks every same-word claim** (architecture-r1-1): bench/src/objects.ts reads each
  relocation's addend (a RELA entry's own, a REL entry's implicit one from its field), bench/src/objdiff-cli.ts
  reads the base object too and gives each relocation difference the base addend or the base's plain value, and
  bench/src/objdiff.ts gives each difference the linked start of its reference section. A difference is
  `static-callee`, `value-named`, `alias`, `symbol-addend` or `value-for-symbol` only when the word (or branch
  target) each side links to, computed from the ELF's addresses, the Thumb bit and the addends, is the same;
  one whose facts are missing is the new class `unverified`, which option (b) of Q1 still gates. An objdiff kind
  the classifier does not know is an error. D34's gate is unchanged; Q1's table is re-measured with it.

**Consequences.** Both majors are closed with tests that fail before their fix; the public API changes are
`checkEntry`'s signature, `textLayoutIndex`, `assembleUnits`, `TextLayoutIndex`, DecompState's field type and the
two diagnostic codes. The owner questions stay Q1 to Q5 of phase-3.md (Q1 and Q2 with this round's numbers); phase
3 does not land until he answers them, and nothing is waived.

## D67. Phase-3 fix round 3 of the review: what changed

**Context.** The review of fix round 2 (phase-3.md, "Review", fix round 3) found three majors (a unit test that
assumed a case-insensitive file system, correctness-r2-1; a `[functions]` entry listed `arm` that Thumb code calls
passing every check and failing the link, correctness-r2-2; module names the model never checked, correctness-r2-3)
and eleven minors. The brief is unchanged: every owner decision takes its safe default, and a gate change, waiver or
limitation the owner has not authorised is an owner question.

**Decision.**

- (a) **Module names are checked by the model** (correctness-r2-3). `foundation/asm/dialect.ts` isModuleName is the
  schema's rule (letters, digits and `_`, not starting with a digit, at most MAX_SYMBOL_NAME characters), and
  buildModel raises E_NAME_INVALID for a module name it refuses. Two modules whose names are equal or fold to one
  (whatever their kinds) are the new E_MODULE_NAME_DUPLICATE: both would build `build/<name>.o`. The paths check
  raises the new E_PATH_INVALID for an emitted path that is not a project path (`isProjectPath`, moved to
  `foundation/util/project-path.ts` so core/verify can call it; core/write-plan re-exports it), so `writable()` can
  no longer pass a tree that planWrites throws on. Amends D66 b, which bounded module names only in the schema.
- (b) **A branch to a function of the other state prints raw** (correctness-r2-2). A `b` or `bl` whose target the
  module's resolver names by a `func` label of the other state (Thumb code calling an entry listed `arm`, or ARM
  code calling one listed `thumb`) is a raw-insn with the new reason `'interworking-branch'` (appended to
  ITEM_RAW_REASONS, so the codes of the earlier reasons are unchanged) and W_INTERWORKING_BRANCH names it: GNU ld
  would insert an interworking veneer for it, which moves every later byte and which the text-layout check, laying
  out the text alone, cannot see. Rejected: refusing the config (the user's mode may be right and the callers dead
  code; printing raw keeps the bytes either way) and re-validating the listed mode in the confirm run (an analysis
  change measured against g2's gates). No tuning ROM's or fixture's tree changes: none of them has such a branch.
- (c) **Case renames roll back** (architecture-r2-4): when the second rename of shell/project/spelling.ts renameCase
  fails, the entry is renamed back to its old name, and E_IO_WRITE names where it actually is (the old name, or the
  temporary `.romlift-case-*` name when the move back fails too). The rename is still not journalled; that stays a
  limitation carried into phase 4.
- (d) **Smaller cleanups** (architecture-r2-6, r2-7, r2-8): assembleUnits derives from buildUnits' one unit builder,
  and AssembleUnit is exported from `romlift` beside it (the `romlift/node` re-export chain is gone); the package
  layout of architecture §2 and the roadmap's ownership row list the files the earlier rounds added; label
  candidates carry their load address as `load` again, sorted through a view; a misplaced doc comment and an alias
  constant are gone. The case-rename test probes the file system's case sensitivity and passes on both (run on a
  case-sensitive APFS image as TMPDIR).

**Consequences.** The three majors are closed with tests that fail before their fix (test/local/config-mutations
links klonoa's tree with a mode-flipped listed function and refuses the renamed modules). The public changes are
three diagnostic codes, one raw reason and AssembleUnit's entry point. The other minors of the round are carried
into phase 4 (phase-3.md). The owner questions stay Q1 to Q5 of phase-3.md; phase 3 does not land until he answers
them, and nothing is waived.

## D68. The owner's answers of 19 October 2026 to the phase-3 owner questions

**Context.** Phase 3 did not land after fix rounds 1 to 3 (D64 to D67): `g3.objdiff` and `g3.large-rom` failed, and
three narrowings or limitations had no authorisation in the owner's words. phase-3.md put five questions to the
owner (Q1 to Q5). Bruno Macabeus answered them on 19 October 2026; each chosen option is quoted as he gave it, and
these are the only gate changes he authorised.

**Decision.**

- (a) **Q1, `g3.objdiff`: "Move gate to phase 5".** `g3.objdiff` moves to phase 5 (where the `expected/` objects and
  objdiff targets are built) as `test/gates/g5.objdiff.test.ts`; phase 3 records the classified counts as its
  measurement (phase-3.md, Q1's table, from `bench/tools/objdiff-classes.ts`); the committed classifier stays. In
  phase 5 the gate applies as D34 writes it unless the owner amends it then. Its check is unchanged, so it still
  runs in every `bench gates` and fails on the six tuning ROMs; `--require 3` does not count a phase-5 gate.
- (b) **Q2, `g3.large-rom`: "Measure under a heap cap".** The `romlift` bin runs Node with `--max-old-space-size=256`
  (the first line of `src/cli/main.ts`, `#!/usr/bin/env -S node --max-old-space-size=256`, which `tsc` keeps in
  `dist/cli/main.js`), and so does every child of `bench large-rom` (`CHILD_NODE_ARGS`); each child reports the cap
  of its own command line (`maxOldSpaceSizeMiB`) and the gate requires both runs to exit 0 under it. The answer sets
  the budget from the measurement under the cap with a stated margin, and requires the 16 MiB tuning ROMs to be
  measured under the same cap and recorded, completing under it. Measured (phase-3.md, "Measured numbers"): the six
  tuning ROMs complete under the cap, 309 to 585 MiB peak RSS (`bench large-rom --rom <path>`, two runs each); the
  32 MiB synthetic ROM does not: `init` ends in V8's "Reached heap limit" (exit 128 for SIGABRT) in every run, and
  `generate` over a config built without the cap fails the same way under 256 and 320 MiB; both complete under 384
  MiB (866.5 and 801.4 MiB peak RSS). No budget can be set from a run that did not complete, so the gate keeps
  D42's 512 MiB and fails; that the cap does not hold the synthetic ROM is owner question Q6 of phase-3.md, not a
  silent change of the cap or of the image.
- (c) **Q3, D64 d: "Accept, don't flush generated".** Generated files are not flushed; the journal, the manifest, user
  edits, scaffold files and C stubs stay flushed (architecture §6.4); `g3.speed-budget` is unchanged.
- (d) **Q4, the raw printer's PoC parity: "Accept".** The narrowed parity of D65 l (`test/local/poc-raw-printer.test.ts`
  on the PoC's own spans, labels and word kinds) is roadmap 3.B's gate.
- (e) **Q5, the limitations carried into phase 4: "Accept Q5a; fix Q5b, c in phase 4".** (a) A ROM whose size the
  last unit's section alignment does not divide is refused (D65 a): a recorded release-1 limitation. (b) Padding-only
  orphans are folded into the next function and (c) the confirm run stops re-validating the functions discover
  listed (measured against g2's gates): both are phase-4 work items, in roadmap.md's phase 4.
- (f) **The minors carried from the review of fix round 2** (phase-3.md, "Review", fix round 3): architecture-r2-9 is
  fixed by a unit test (two module-scoped labels of one name in two modules, each module resolving its own).
  architecture-r2-2 and r2-3 (the classifier's addend decoder and its untested plumbing) move with the gate to
  phase 5; architecture-r2-1 and r2-5 stay carried into phase 4.

**Consequences.** `g3.objdiff` no longer gates phase 3; `g3.large-rom` measures under the cap and fails on the
synthetic ROM (Q6). Following the landing procedure, `test/gates/phase.json` was raised to `{ "landed": 3 }` and the
whole closing list ran in a fresh worktree (phase-3.md, "The closing gate"); `bench gates --require 3 --tier ci`
exited 1 on `g3.large-rom` alone, so the marker is back at `{ "landed": 2 }` and phase 3 does not land until the
owner answers Q6.

## D69. The owner's answer of 19 October 2026 to Q6 of phase 3

**Context.** Applying Q2's answer (D68 b) found that no run of the 32 MiB synthetic ROM completes under a 256 MiB
heap cap (`init` and `generate` end in V8's out-of-memory abort; 320 MiB likewise), while 384 MiB holds it.
phase-3.md put that to the owner as Q6, with three options: (a) keep 256 MiB and make the analysis hold about 100
MiB less, (b) raise the cap of the bin and the gate to a measured value that holds the synthetic ROM, (c) keep 256
MiB for the bin and run the gate under a larger cap.

**Decision.**

- (a) **Q6: "384 MiB for bin and gate".** The `romlift` bin launcher (the first line of `src/cli/main.ts`,
  `#!/usr/bin/env -S node --max-old-space-size=384`) and `g3.large-rom` (every child of `bench large-rom`,
  `LARGE_ROM_MAX_OLD_SPACE_MIB`) both use `--max-old-space-size=384`; this replaces Q2's 256 (D68 b). Every ROM size
  up to 32 MiB must complete under it. The gate requires both runs to exit 0 and to report the 384 MiB cap.
- (b) **The budget.** The gate's peak-RSS budget is set from the recorded runs under the 384 MiB cap plus a stated
  margin. Recorded (phase-3.md, "Measured numbers", the owner's answer to Q6; Node 24.15, macOS): seven runs of the
  synthetic ROM, `init` 817.2 to 866.5 MiB and `generate` 789.3 to 837.9 MiB, every one exiting 0 with the tree
  digest `9d9c915d…`. The margin is 25% over the largest recorded peak, rounded up to a multiple of 64 MiB: 866.5 ×
  1.25 = 1,083.1, so **1,088 MiB** (`MAX_RSS_MIB` in `test/gates/g3.large-rom.test.ts`, `LARGE_ROM_MAX_RSS_MIB` in
  `bench/src/large-rom.ts` for the human output). The gate's own runs in the closing list are recorded beside them.
  The 16 MiB tuning ROMs (and klonoa, 4 MiB) are re-measured under 384 MiB, two runs each: all complete, 310.6 to
  667.8 MiB peak RSS (pokeemerald the largest), each writing the same tree digest as under 256 MiB.
- (c) **The minors carried from the last review.** architecture-r2-5 is fixed (moduleIndexAt's `relocated` is
  required, the resolver.ts re-export is gone; no result changes). architecture-r2-1 stays carried into phase 4
  (a public API change with the writer contract D66 d reopens); r2-2 and r2-3 go to phase 5 with `g5.objdiff` (D68
  f).

These are the only gate changes authorised with D68.

**Consequences.** `g3.large-rom` measures the synthetic ROM under the bin's 384 MiB cap against 1,088 MiB. A user's
`romlift` run on a 32 MiB ROM holds about 0.8 to 0.9 GiB resident; a ROM whose live set exceeds the 384 MiB old
space ends in V8's out-of-memory report. With Q1 to Q6 answered, the landing procedure ran again at `739d665` (`test/gates/phase.json`
at `{ "landed": 3 }`, a fresh worktree): every command of the closing list exited 0, `g3.large-rom` passing at 850.4
MiB (`init`) and 789.9 MiB (`generate`) under the cap (phase-3.md, "The closing gate"). Nothing is merged or pushed.

**Revision (19 October 2026, the review of `d744f5d`: correctness-r0-1, -r0-2, gate-honesty-r0-1, -r0-2; D70).** The
sentence "A user's `romlift` run on a 32 MiB ROM holds about 0.8 to 0.9 GiB resident" was not measured on the bin:
every number behind it came from the bench's `init` and `generate` workflow children. The bin's own `verify`,
`model` and `analyze --json` aborted with V8's out-of-memory report on the synthetic ROM under the 384 MiB cap at
`d744f5d`, so (a)'s "every ROM size up to 32 MiB must complete under it" did not hold for the bin until D70 a. The
landing run at `739d665` is withdrawn as a landing for that reason. (b)'s range and margin are restated in D70 c.

**Revision (19 October 2026, the review of `16d1280`; D71).** (a)'s "every ROM size up to 32 MiB must complete under
it" is met for the synthetic image and the tuning ROMs, not for a 32 MiB ROM of real code density (pokeemerald twice
over), on which every bin command aborts under the cap: owner question Q7 (D71 a).

**Revision (19 October 2026, the owner's answer to Q7; D72).** (a)'s cap is replaced: the bin and `g3.large-rom` use
`--max-old-space-size=1024` ("Raise cap to 1,024 MiB"), and "every ROM size up to 32 MiB must complete under it" now
reads under that cap. (b)'s 1,088 MiB is replaced by 1,536 MiB, set again from the runs under 1,024 MiB with the same
margin (D72 b).

## D70. Phase-3 fix round 4: the bin's commands under the 384 MiB cap

**Context.** The review of `d744f5d` (correctness-r0-1 to -r0-5, gate-honesty-r0-1 to -r0-5) ran the `romlift` bin
itself on the 32 MiB synthetic ROM under the cap of D69 a: `verify` (with or without `--assemble`, `--link`, either
printer), `model`, `model --json` and `analyze --json` exited 134 with V8's out-of-memory report, while
`g3.large-rom` passed, because the gate measures the bench's `init` and `generate` workflow children
(`bench/src/large-rom.ts`), which take other paths than the CLI. The owner's answer to Q6 requires every ROM size up
to 32 MiB to complete under the cap, and says these are the only gate changes authorised.

**Decision.**

- (a) **The bin's paths fit under the cap; no result changes.** `generateFromRom` and `initModel` keep only the
  config of the discover run (`configAlone`), so the discover analysis is garbage before the confirm analysis runs
  (both were live at once). `analyze --json` and `model --json` stream their NDJSON through `writeLines`, 4,096 lines
  per stdout write, awaiting `CliIo.drained` between batches, so neither the output (114 MB for `analyze --json` on
  the synthetic ROM) nor a slow pipe's queue is ever whole in memory. Every output is byte-identical to `d744f5d`'s
  uncapped run (`analyze --json`, `model --json`, `verify --json`, `verify --assemble --link --json`).
- (b) **The bin's commands are measured, the gate is not changed.** `bench large-rom --bin [--rom <path>]`
  (`bench/src/large-rom-bin.ts`) runs `analyze`, `analyze --json`, `explain --json`, `model`, `model --json`,
  `verify --json`, `verify --assemble --link --json` and `verify --printer raw --link --json`, each its own process
  from source with the Node options of `src/cli/main.ts`'s launcher line, its peak RSS from a preload
  (`bench/src/rss-probe.ts`). `test/local/large-rom-bin.test.ts` requires every one to exit 0 with an ok summary (and
  the ROM's SHA-1 after `--link`); it runs in the closing list through `test:local` and fails at `d744f5d`. Making
  `g3.large-rom` run them would change a gate, which the owner has not authorised, so the gate keeps D69's `init`
  and `generate` runs.
- (c) **The budget's record.** `MAX_RSS_MIB` stays 1,088 MiB. It was set at `a206ac1` as the largest peak then
  recorded (866.5 MiB) plus 25%. The runs recorded since, among them the review's (`init` 945.5 MiB in a fresh
  clone's `run --scaffold`, 918.75 MiB by hand), put the largest recorded `init` peak at 945.5 MiB: the budget is
  15.1% above it, not 25%. Raising the budget to keep 25% over the new maximum would change the gate, so it is not
  done; the record states the headroom instead (phase-3.md, "Measured numbers", fix round 4).
- (d) **The binding limit is the old space, and it is recorded.** Each child of `bench large-rom` reports
  `peakLiveHeapMiB`, the largest heap V8 finds live after a full mark-compact (`node:v8` `GCProfiler`); measured
  on the synthetic ROM at 314.5 to 351.6 MiB (`init`) and 330.4 to 353.0 MiB (`generate`) of the 384 MiB cap (four runs, the closing list's `run --scaffold` among them; corrected by D71 f), while
  their RSS stays at least 140 MiB under the RSS budget. A run fails by the heap cap long before the RSS budget, and
  the headroom against the cap is about 31 MiB (8%). Growth of the live peak past about 355 MiB is a regression
  signal to act on before it becomes an abort; it is volatile (timings), not gated.
- (e) **The artifact shows the cap.** The memory member of `bench/results.json` keeps each run's
  `maxOldSpaceSizeMiB`; the memory family's summary says the runs are recorded and `g3.large-rom` judges them, since
  nothing in `run`, `regression` or `provenance` judges the budget.
- (f) **correctness-r0-5.** The data writer computes the relocated modules once per module; `moduleAt` is documented
  as the one-address form (it filters per call); resolver.ts's orphan comment is gone. pool.ts's
  `visibleLabelsAt` keeps calling `moduleAt`, once per address that has labels: threading the list through
  `wordText`, `labelForWord` and their callers changes the printer helpers' signatures for a filter over at most a
  few dozen modules.

**Consequences.** Every phase-3 command of the bin completes on the 32 MiB synthetic ROM under the 384 MiB cap
(peak RSS 765.3 to 811.8 MiB) and on the six tuning ROMs (238.8 to 697.4 MiB). The landing procedure runs again after
this round: at `81210eb`, `test/gates/phase.json` at `{ "landed": 3 }`, in a fresh worktree, every command of the
closing list exited 0, `test/local/large-rom-bin.test.ts` and `g3.large-rom` (840.4 and 772.3 MiB) among them
(phase-3.md, "The closing gate", fix round 4). No gate threshold changed. Nothing is merged or pushed.

**Revision (19 October 2026, the review of `16d1280`: correctness-r1-1, -r1-2; D71).** "Every phase-3 command of the bin
completes on the 32 MiB synthetic ROM" holds for that code-sparse image and the six tuning ROMs, not for every 32 MiB
ROM: a code-dense one (pokeemerald twice over) does not complete under the cap (D71 a, Q7). (d)'s headroom of about 31
MiB is that of the gate's children; the bin's commands reach 377.5 MiB of the 384 MiB old space (D71 b).

**Revision (19 October 2026, the owner's answer to Q7; D72).** The cap is 1,024 MiB and the budget 1,536 MiB (D72 a, b);
(c)'s and (d)'s numbers are those of the 384 MiB cap and stay as the record of it.

## D71. Phase-3 fix round 5: a code-dense 32 MiB ROM, the bin's live heap, and owner question Q7

**Context.** The review of `16d1280` (correctness-r1-1 to -r1-4, gate-honesty-r1-1 to -r1-3) built a 32 MiB ROM of real
code density, `pokeemerald.gba` concatenated with itself (SHA-1 `fb17b88d…`, never committed), and ran the bin on it
under the 384 MiB cap of D69 a: `analyze` and `verify --link` ended in V8's out-of-memory abort. D69 a reads "every
ROM size up to 32 MiB must complete under it", and D70's consequences said every phase-3 command of the bin
completes, which held for the code-sparse synthetic image only (3,639 functions; the doubled ROM has 29,084). The
review also found the recorded headroom (D70 d) measured on the gate's workflow children alone, while the bin's own
commands came within 9 to 22 MiB of the cap, four bin command forms above the recorded range, and the budget's basis
and two run counts stated inconsistently.

**Decision.**

- (a) **Q7 goes to the owner; no cap, gate or claim changes in this round.** Measured on the doubled ROM (phase-3.md,
  Q7): every one of the twelve bin command forms aborts under the cap, and so does `bench large-rom --rom`'s `init`;
  without a cap `verify` holds 721 MiB live after a full mark-compact and `analyze` 421 MiB; at 768 MiB every `verify`
  form still aborts, at 1,024 MiB every command completes. No change of a fix round's size halves `verify`'s live set:
  the readings' instruction spans and the text-layout check's whole-tree text and statements are what it holds, and
  shrinking them is a redesign. Fitting the doubled ROM under 384 MiB, raising the cap, or reading Q6's words as the
  sizes the synthetic image measures is the owner's choice (Q7's options a to c). Until he answers, the record claims
  completion under the cap for the synthetic image and the six tuning ROMs only, the doubled ROM is a recorded
  counterexample, and phase 3 does not land.
- (b) **The bin's live heap is measured, and the headroom restated from it.** `bench/src/rss-probe.ts` also reports
  the largest heap live after a full mark-compact (`node:v8` `GCProfiler`, through `bench/src/live-heap.ts`, which the
  gate's children share), and `bench large-rom --bin` records it per command (`peakLiveHeapMiB`). On the synthetic
  image the bin's commands reach 377.5 MiB (macOS) and 377.4 MiB (Linux), `verify --assemble` under Node 24, of the
  384 MiB old space: about 6.5 MiB, 2%, of headroom, where D70 d put it at 31 MiB from the gate's children (whose own
  live peak is at most 354.6 MiB, Linux Node 24). A bin command's live peak past the recorded maximum is the
  regression signal, replacing D70 d's 355 MiB; there is no margin left to set it at.
- (c) **`analyze`'s text output streams.** With the live heap measured, `analyze <rom>` (text) aborted on the synthetic
  image under the cap in 3 of 6 Node 22.18 runs on macOS and in the Linux Node 22.18 run: it built every row of its
  600,000-odd rejection table, then the output, as one string. `columnLines` yields one line per row, computing the
  widths in a first pass, and the command writes them through `writeLines` (D70 a); the output is byte-identical; the
  live peak falls from about 346 to 291.1 to 300.8 MiB, and every run completes on both Node versions.
- (d) **The budget's basis.** `MAX_RSS_MIB` stays 1,088 MiB. D69 b set it once, at `a206ac1`, from the runs then
  recorded: their largest peak, 866.5 MiB, plus 25%, rounded up to a multiple of 64 MiB. The largest peak recorded
  since is 945.5 MiB, which it is 15.1% above. Q6's rule ("set from the recorded runs under the 384 MiB cap plus a
  stated margin") was applied when the budget was set and does not ask for it to be set again with each later run;
  raising it would loosen the gate. The gate's comment, `bench/src/large-rom.ts`, roadmap 3.E and architecture §12 now
  say this. No owner question is open on the budget; the fix report's "needs the owner" is withdrawn.
- (e) **Four more bin command forms.** `BIN_RUNS` (and `test/local/large-rom-bin.test.ts`) adds `explain` and `verify
  --assemble` (text), `verify --assemble --json` and `verify --printer raw --assemble --json`: twelve forms.
- (f) **Counts corrected.** D70 d's live-heap ranges come from four runs (synthetic 1 to 3 and the closing list's `run
  --scaffold`), not five; phase-3.md's review row says eighteen runs, as its measured numbers do.
- (g) **Node 22.18 and Linux are measured.** `g3.large-rom`'s children and the bin's commands on the synthetic image run
  under Node 22.18 on macOS and under Node 22.18 and 24 on Linux (arm64, Debian bookworm containers): every run of the
  gate's children completes, and after (c) every bin command (phase-3.md, "Measured numbers", fix round 5). The phase
  pull request's CI numbers (ubuntu-latest and macos-latest, Node 22.18 and 24) are recorded when that pull request
  runs, before the merge.
- (h) **A printer defect the doubled ROM shows.** The readable tree of the doubled ROM fails the text-layout check on
  two `adr` lines naming a function label (verify exit 3); the check refuses it, so nothing wrong is written. No
  tuning ROM or fixture shows it; it is recorded, not fixed, in this round.

**Consequences.** No gate threshold changed. Every bin command completes under the cap on the synthetic image (Node
24.15 and 22.18, macOS and Linux) and on the six tuning ROMs (Node 24.15, macOS); on a code-dense 32 MiB ROM none does, which is
Q7. The closing list ran again at `71143d4` (`test/gates/phase.json` at `{ "landed": 3 }`, a fresh worktree): every
command exited 0, `test/local/large-rom-bin.test.ts` and `g3.large-rom` (887.2 and 772.8 MiB) among them (phase-3.md,
"The closing gate", fix round 5). Phase 3 is not landed;
nothing is merged or pushed.

**Revision (19 October 2026, the owner's answer to Q7; D72).** Q7 is answered, "Raise cap to 1,024 MiB" (option b):
(a)'s "no cap, gate or claim changes in this round" and "phase 3 does not land" are superseded. Under the 1,024 MiB cap
every bin command form completes on the doubled ROM, the raw printer's tree linking to its SHA-1; (h)'s readable
`verify` exit 3 there is a phase-4 work item the owner assigned and a recorded known limitation of phase 3 (D72 c).
(b)'s headroom of 2% is that of the 384 MiB cap; under 1,024 MiB it is restated in D72's consequences.

## D72. The owner's answer of 19 October 2026 to Q7 of phase 3

**Context.** Fix round 5 (D71 a) found that a 32 MiB ROM of real code density, `pokeemerald.gba` concatenated with
itself (SHA-1 `fb17b88d0535cc86b62604dedc09b05d881d888a`, never committed; "the doubled ROM"), does not complete any
bin command under Q6's 384 MiB cap, while 1,024 MiB holds every command. phase-3.md put that to the owner as Q7 with
three options: (a) keep 384 MiB and redesign the readings' storage and the check pass, (b) raise the cap of the bin
and the gate to a measured value that holds the doubled ROM, (c) read Q6's "every ROM size up to 32 MiB" as the sizes
the synthetic image and the tuning ROMs measure.

**Decision.**

- (a) **Q7: "Raise cap to 1,024 MiB" (option b).** The `romlift` bin launcher (the first line of `src/cli/main.ts`,
  `#!/usr/bin/env -S node --max-old-space-size=1024`, which `tsc` keeps in `dist/cli/main.js`) and `g3.large-rom`
  (every child of `bench large-rom`, `LARGE_ROM_MAX_OLD_SPACE_MIB`; the gate's `HEAP_CAP_MIB`, which each run's report
  must carry) both use `--max-old-space-size=1024`; this replaces Q6's 384 (D69 a), which replaced Q2's 256 (D68 b).
  Q6's "every ROM size up to 32 MiB must complete under it" now reads under the 1,024 MiB cap. Applied at `1443c2c`.
- (b) **The budget, set again.** `g3.large-rom`'s peak-RSS budget is set again from recorded runs under the 1,024 MiB
  cap plus a stated margin. Recorded at `1443c2c` (phase-3.md, "Measured numbers", the owner's answer to Q7; Node
  24.15, macOS): eight runs of `bench large-rom --json` on the synthetic image, every child exiting 0 under the cap
  with the tree `9d9c915d…`; `init` 964.1 to 1,040.6 MiB and `generate` 959.2 to 1,210.1 MiB peak RSS, live heap 287.7
  to 348.9 MiB. The margin is D69 b's: 25% over the largest recorded peak, rounded up to a multiple of 64 MiB:
  1,210.1 × 1.25 = 1,512.6, so **1,536 MiB** (`MAX_RSS_MIB` in `test/gates/g3.large-rom.test.ts`,
  `LARGE_ROM_MAX_RSS_MIB` in `bench/src/large-rom.ts`, the memory family's summary), at `745505f`. It replaces D69 b's
  1,088 MiB. V8 sizes its heap to the cap, so the same ROM's peak RSS rose by about 150 to 350 MiB from the runs under
  384 MiB (814.0 to 945.5 MiB) while its live heap stayed where it was.
- (c) **The doubled ROM, and the phase-4 work item.** Under the 1,024 MiB cap every one of the twelve bin command forms
  of `bench large-rom --bin --rom <the doubled ROM>` completes, none aborting: 951.6 to 1,376.0 MiB peak RSS, live heap
  365.4 to 922.7 MiB (the raw printer's two `verify` forms the largest, about 101 MiB, 10%, under the old space). The
  raw printer's `verify --link` links to its SHA-1 `fb17b88d…`. The four readable `verify` forms exit 3 on the
  text-layout check alone (two problems, `cannot encode \`adr r6, sub_0906A708\` at 0x0906A56C`): the readable printer
  names an `adr` target by a function label `as` cannot encode there. By the owner's answer that is a phase-4 work item
  (roadmap.md, phase 4, "Carried from phase 3"), and in phase 3 the exit 3 is a recorded known limitation, not a
  failure; `bench large-rom --bin --rom` therefore exits 1 on that ROM. `bench large-rom --rom` on it (the workflow
  children) completes too: `init` and `generate` exit 3 on the same check at 1,339.2 and 1,304.0 MiB, writing nothing.
- (d) **The synthetic image and the tuning ROMs, re-measured under 1,024 MiB.** The bin's twelve forms on the synthetic
  image: every one exits 0 (ok summaries, both `--link` forms linking `b846b945…`), 940.0 to 1,217.6 MiB peak RSS, live
  heap 299.1 to 422.6 MiB. The six tuning ROMs, the workflow children (`bench large-rom --rom`) and the twelve bin forms
  (`--bin --rom`), one run each: every run exits 0, each `--link` linking the ROM's SHA-1, the children writing the
  tree digests they wrote under 384 MiB; peak RSS 313.1 to 750.8 MiB (children) and 212.7 to 847.5 MiB (bin), both
  largest on pokeemerald.
- (e) **Not done.** No dense ROM is added to `g3.large-rom` (the owner did not authorise it); the gate keeps the
  synthetic image. `test/local/large-rom-bin.test.ts` keeps requiring the bin on the synthetic image, now under 1,024
  MiB. These are the only gate changes authorised with D68 and D69.
- (f) **The minors carried from the last review** (phase-3.md, "Review", fix round 5): gate-honesty-r1-3's remainder,
  the phase pull request's CI numbers, waits for that pull request (nothing is pushed); correctness-r0-5's remainder
  (pool.ts) and architecture-r2-1 and r2-4 stay carried into phase 4, r2-2 and r2-3 into phase 5. None is a change a
  fix of this size makes cheaply.

**Consequences.** The bin and `g3.large-rom` run under 1,024 MiB of old space, and the gate judges peak RSS below 1,536
MiB. D69 b's budget, D70 d's and D71 b's headroom statements are of the 384 MiB cap: under 1,024 MiB the synthetic
image's largest live heap of a bin command (422.6 MiB, `explain --json`) leaves about 601 MiB, and the doubled ROM's
(922.7 MiB, the raw `verify`) about 101 MiB. A code-dense ROM larger than the doubled one may still exceed the cap,
which ends in V8's out-of-memory report (exit 134); the memory work of Q7's option (a) stays possible later work, not a
phase-3 item. Following the landing procedure, with `test/gates/phase.json` at `{ "landed": 3 }`, the whole closing
list ran in a fresh worktree at `1b4d37f` (phase-3.md, "The closing gate", the owner's answer to Q7): every command
exited 0, `test/local/large-rom-bin.test.ts` and `g3.large-rom` (996.7 and 1,093.3 MiB under the 1,024 MiB cap) among
them, but `gates --require 3 --tier real`, whose `g2.speed` measured sa2's analysis at 787.3 ms against a limit of 786.8
ms, and the two provenance checks that read that verdict. That is outside the answers: `phase.json` is back at
`{ "landed": 2 }` and the question is Q8 of phase-3.md. Nothing is merged or pushed.

## D73. The owner's answer of 19 October 2026 to Q8 of phase 3

**Context.** The landing run after Q7's answer (D72), the whole closing list in a fresh worktree at `1b4d37f` with
`test/gates/phase.json` at `{ "landed": 3 }`, exited 0 on every command but three: `bench gates --require 3 --tier
real` failed on `g2.speed` alone, which measured sa2's median analysis CPU time at 787.3 ms against its limit of
786.8 ms (0.5 ms, 0.06% over), and `g1.provenance` and `bench provenance` failed on the gate record holding that
verdict. No analysis code had changed since the passing run at `71143d4`. That failure is outside the earlier answers,
so `phase.json` went back to `{ "landed": 2 }` (`afe4f78`) and phase-3.md put it to the owner as Q8 with three options:
(a) run the closing list again unchanged, (b) measure the cause before any further landing run, (c) change `g2.speed`.

**Decision.**

- (a) **Q8: "Re-run the gate list" (option a).** The whole closing list of phase-3.md runs again unchanged, at a commit
  that raises `test/gates/phase.json` to `{ "landed": 3 }` again, and phase 3 lands if every command exits 0. The gate
  is not changed (`g2.speed`, `bench/baseline/speed.json` and every threshold stay as they are), and the failed run at
  `1b4d37f` stays recorded (phase-3.md, "The closing gate", the owner's answer to Q7).
- (b) **No retry loop.** If `g2.speed`, or any other command of the list, fails again, that is a new owner question,
  not a further run: `phase.json` goes back to `{ "landed": 2 }` and phase-3.md records the run and the question.
- (c) **The only gate changes.** These and the answers of D68, D69 and D72 are the only gate changes the owner
  authorised; Q8's answer authorises none.
- (d) **The carried minors.** Looked at again with this answer: gate-honesty-r1-3's remainder (the phase pull
  request's CI numbers) still waits for that pull request; correctness-r0-5's remainder (pool.ts), architecture-r2-1
  and r2-4 stay carried into phase 4, r2-2 and r2-3 into phase 5 (D72 f). None changed since D72 f found them not cheap;
  the one cheap fix taken is this file's preamble, which listed the decisions only through D64 and now names D65 to D73.

**Consequences.** No code or gate changes. `test/gates/phase.json` was raised to `{ "landed": 3 }` at `0784b4e`, and the
whole closing list ran in a fresh worktree at that commit (phase-3.md, "The closing gate", the owner's answer to Q8):
every command exited 0, among them `gates --require 3 --tier real` with `g2.speed` passing (calibration ratio 0.978,
sa2 725 ms against 798 ms) and `gates --require 3 --tier ci` with `g3.large-rom` passing under the 1,024 MiB cap (1,039.2
and 1,002.9 MiB, budget 1,536 MiB). Phase 3 passes its closing gate; the marker stays at `{ "landed": 3 }`, the artifact
of that run (`meta.commit` `0784b4e`) is committed, and the merge to `main` waits for the phase pull request's CI.
Nothing is merged or pushed.

## D74. Phase-4 component boundaries as executed, and the contract members phase 4 needs

**Context.** Roadmap 4.0–4.I splits phase 4 into a lead, five parallel components (4.A config on disk, 4.B scaffold
and templates, 4.C C stubs, modules.mk and the C-data assertion, 4.D workflows and commands, 4.E end-to-end harness)
and an integrator, and its section "Carried from phase 3" adds three work items the owner assigned on 19 October 2026
(phase-3.md Q5 b, Q5 c and Q7, D68 e, D72 c) plus the carried minors. As in phases 1 to 3 (D54, D56, D62), freezing the
phase's types showed where the roadmap's split and the edge table do not fit: the C-unit text-layout check needs the C
tokenizer, which core/verify may not import; `scaffold --diff`'s command needs the project loading of 4.A; the C build
(compiler invocation, object paths, modules.mk's variables, the C-data ASSERT) is written by three components and read
by a fourth. The owner asked for no checkpoints: every owner decision of architecture §12 is built with its documented
safe default, and every choice below that is not in the owner's words is an owner question in phase-4.md, built with
its default while it waits (Q1 to Q3).

**Decision.** Phase 4 runs as eleven components in three waves on the branch `phase-4`, each on its own flat branch
`phase-4-<component>` and worktree (D56 h; roadmap.md, "Phase 4", "As executed (D74)"):

- (a) **Wave 1**: `p4-lead` (this record; 4.0 below), `p4-emission-carried` (Q5 b, padding-only orphans folded into the
  next function without changing a byte, then Q7, the readable printer's `adr` naming a function label, with the fixture
  `adr-function-label` that fails without the fix: `core/model/{chunks,items,labels,resolver,codec,printing-cache}.ts`,
  `core/layout/{borders,tiling}.ts`, `core/emit/print/{chunk,insn,pool,raw}.ts`, the function and orphan writers,
  `core/verify/text-layout.ts`, the writer, model and explain goldens) and `p4-confirm-listed` (Q5 c, the confirm run no
  longer re-validating the functions configFromDiscover listed: `core/analysis/{types,codec}.ts`,
  `core/analysis/driver/confirm.ts`, `core/workflow/generate.ts`'s `listedSeedsOf`, `test/local/listed-invalid.test.ts`).
  **Wave 2**: `p4-config` (4.A: `core/config/{keys,parse,serialize,patch,decomp-yaml,codes}.ts`,
  `shell/config/{load,save}.ts`, `shell/project/locate.ts`, the config goldens, `test/mutation/phase4/patch-planner`),
  `p4-scaffold` (4.B without its CLI: the templates but `MANIFEST.json`, `core/scaffold/render.ts`,
  `shell/project/templates.ts`, the scaffold goldens), `p4-c-modules` (4.C, below), `p4-fixtures` (4.E's three fixtures,
  `composite`, `multi-compiler` and `c-data`, and the old_agbcc support of the fixture build) and `p4-safety-minors`
  (`test/mutation/phase4/{lock,journal}`, and the carried minors that touch code outside the other components:
  architecture-r2-4, correctness-ci-1, correctness-r0-2, gate-honesty-r0-1). **Wave 3**: `p4-workflows` (4.D: `init`,
  `generate` over a project, `analyze --update`, `scaffold --diff`, the project mode of `model`, `verify` and `explain`,
  `shell/project/read-inputs.ts`, `shell/toolchain/npm.ts`), `p4-e2e` (4.E's harness: `test/helpers/e2e.ts`, the TOML
  mutation property test, `packed.yml`, the fixtures workflow's init step) and `p4-bench-init` (4.E's bench part: `bench
  run --scaffold` through `init`, `setup.sh` and `make`; `init` and `generate` in `bench large-rom --bin`). The lead
  integrates after each wave, regenerates `bench/results.json`, raises `test/gates/phase.json` and runs the closing gate.
- (b) **Deviations from the roadmap's owners.** Q5 b and Q7, which roadmap "Carried from phase 3" gives to 4.0, are one
  wave-1 component (`p4-emission-carried`): both regenerate the writer goldens, so they run in sequence in one place, and
  the lead's freeze is not blocked on them. Q5 c, which the roadmap gives to 4.D, is its own wave-1 component
  (`p4-confirm-listed`), measured against g2's gates before the workflows land. `scaffold --diff`'s command moves from 4.B
  to `p4-workflows`, because it reads a project through 4.A. `p4-c-modules` also owns configFromDiscover's kind flip of
  the agbcc-shaped modules to `c` (D62 c), the C units of the text-layout check and of `verify --assemble/--link`
  (`core/verify/{text-layout,link-scripts}.ts`, `shell/toolchain/link-check.ts`) and `objectPath` for C modules
  (`core/model/paths.ts`). 4.E is three components (fixtures in wave 2; harness and bench in wave 3). The roadmap gives
  `src/shell/codes.ts` to 4.0; the shell's codes land with their raisers instead (`p4-config`: `E_PROJECT_NOT_FOUND`;
  `p4-workflows`: `E_DIR_NOT_EMPTY`, `W_LOCKFILE_DEFERRED` and the others it raises), because
  `test/unit/diagnostics/codes.test.ts` requires every defined code to have a raiser (D45). Nothing else moves.
- (c) **The frozen workflow types** (`core/workflow/types.ts`, plain readonly data): `InitOptions { name?; moduleSize? }`
  (phase 4's `init` takes `<rom> [dir] [--name] [--module-size] [--json]`; `--no-signatures` lands with signatures in
  phase 6, since nothing ships before its phase); `InitInputs { rom; romFile; options; templates: ScaffoldTemplates;
  romliftVersion; agbcc: AgbccPin; profile? }`; `InitPlan = { ok: true; config; tomlText; decompYamlText; result:
  GenerateResult; scaffold: readonly FileEntry[]; diagnostics } | { ok: false; diagnostics }`; `ProjectInputs { rom;
  configText; config; cTexts: ReadonlyMap<src/<module>.c, text>; profile? }`; `GeneratePlan = { ok: true; result:
  GenerateResult; diagnostics } | { ok: false; diagnostics }`; `AnalyzeUpdateInputs { rom; configText; config; profile? }`;
  `AnalyzeUpdatePlan = { ok: true; proposals; text; changed; diagnostics } | { ok: false; diagnostics }`. Three choices
  beyond the roadmap's names: `GeneratePlan` is a union like the other two plans, because a ROM whose SHA-1 is not the
  config's `[rom] sha1` is refused before any analysis and has no result; `ProjectInputs.profile?` mirrors
  `GenerateInputs.profile?` (the dummy profile of `g2.second-profile`); `AgbccPin` is defined in
  `core/scaffold/vars.ts`, since core/scaffold may not import core/workflow. `GenerateInputs` and `GenerateResult` stay
  in `core/workflow/generate.ts` in their phase-3 form. The project's ROM is always `baserom.gba` (`BASEROM_PATH`, the
  config's `[rom] path`, the only file an `.incbin` reads); `InitInputs.romFile` is the name the user gave, which
  `init`'s shell copies to `baserom.gba` when it differs, keeping the original (g4.e2e-fixtures initialises
  `<fixture>.gba`).
- (d) **The scaffold contract** (`core/scaffold/vars.ts`). `ScaffoldVars { name; romFile: 'baserom.gba'; builtRom
  (<name>.gba); sha1; sha1File (<name>.sha1); romliftVersion; agbcc: AgbccPin; title (the header's game title) }`, built by
  `scaffoldVars`. `ScaffoldTemplate { target; source: string | null; executable }`, `ScaffoldManifest { schema: 1; files
  }`, `ScaffoldTemplates { manifest; texts: ReadonlyMap<source, text> }`. Templates and manifest targets spell a value as
  `@@<placeholder>@@`, one of `SCAFFOLD_PLACEHOLDERS` (`name`, `romFile`, `builtRom`, `sha1`, `sha1File`,
  `romliftVersion`, `title`, `agbccUrl`, `agbccCommit`; `placeholderValues`): `@@` occurs in none of the file kinds
  romlift ships, unlike `{{` (GitHub's `${{ … }}`). `decodeScaffoldManifest(json)` and `decodeAgbccPin(json)` return
  `{ ok: true; value } | { ok: false; message }` and never throw. A null `source` is exactly the five targets romlift
  renders itself (`ROMLIFT_RENDERED_TARGETS`): `@@sha1File@@` (`<sha1>  <name>.gba`, sha1sum format), `package.json`
  (the exact romlift version), `.gitmodules` (`tools/agbcc` at the pin's URL), `include/macros.inc` (`DIALECT.macrosInc`)
  and `include/include_asm.h` (`INCLUDE_ASM_HEADER`), so neither header can drift from the text the checks read.
  `templates/MANIFEST.json` lists `.github/workflows/build.yml` (from `build.yml`), `.gitignore` (from `gitignore`, as
  npm drops a packed `.gitignore`), `AGENTS.md`, `Makefile`, `README.md`, `setup.sh` (the only executable),
  `mk/<id>.mk` from `compilers/<id>.mk` for each build compiler (`BuildCompiler.rule`, D47), and the five rendered
  targets. `templates/agbcc.json` is `{ "url": "https://github.com/pret/agbcc", "commit":
  "da598c1d918402c42c0c0d7128ba14567f3175e9" }`, the commit the synthetic fixtures were built with; it is read, never
  copied.
- (e) **The C-stub constants** (`foundation/asm/dialect.ts`, shared by the c-stub writer, the reconciler, the
  text-layout check and the scaffold): `includeAsmStatement(module, name)` = `INCLUDE_ASM("asm/nonmatchings/<module>",
  <name>);`, where `name` is the chunk file's base name (`chunkPaths`: `<Name>_<ADDR>` for a member of a case-folded
  group), since the macro includes `<dir>/<name>.s`; `NONMATCHINGS_ROOT` (`asm/nonmatchings`); `INCLUDE_ASM_HEADER_PATH`
  (`include/include_asm.h`); `INCLUDE_ASM_HEADER`, guarded, defining `INCLUDE_ASM(DIR, NAME) asm(".syntax
  unified\n.include \"" DIR "/" #NAME ".s\"\n.syntax divided\n")` and including the macro file once per translation unit
  with a file-scope `asm` (romlift's `.s` files are unified syntax, agbcc emits divided; Klonoa's decomp uses the same
  form with agbcc and old_agbcc); `C_STUB_HEADER` (`#include "include_asm.h"` and a blank line), the lines every
  generated `src/<module>.c` starts with, its INCLUDE_ASM statements following one per line.
- (f) **The C build, frozen for the writers, the scaffold and the checks.** A C module `src/<m>.c` is preprocessed by
  the host C compiler (`$(HOSTCC) -E -x c -nostdinc -undef -I include src/<m>.c`), compiled by
  `tools/agbcc/bin/<compiler>` with `BUILD_COMPILERS[<compiler>].flags` plus the module's `cflags` into
  `build/src/<m>.s`, and assembled (`arm-none-eabi-as -mcpu=arm7tdmi`) to `build/src/<m>.o`; asm and data units keep
  `build/<m>.o` (`objectPath`). What agbcc appends or aligns at a unit's end is measured by `p4-c-modules` (D65 a's unit
  alignment) and encoded once. The Makefile includes `modules.mk` (generated, the `modules-mk` writer) and every
  `mk/<id>.mk`, whose C recipe reads the object's `CC1` and `CFLAGS`; an explicit rule the user adds for one object wins
  over the pattern rule (D47). modules.mk holds exactly: `OBJS := <every unit object in link order>`, `C_OBJS := <the C
  objects>`, and per C object the target-specific lines `build/src/<m>.o: CC1 := tools/agbcc/bin/<id>` and
  `build/src/<m>.o: CFLAGS := <flags>` (each names `src/<m>.o`, as `g4.multi-compiler` reads it). The ldscript places
  only `.text` of a C object and, per C module, exactly:

  ```
  .c_data_<m> (NOLOAD) : { *src/<m>.o(.rodata* .data* .bss* COMMON) }
  ASSERT(SIZEOF(.c_data_<m>) == 0, "src/<m>.c defines data; see AGENTS.md (data ranges arrive in phase 5)")
  ```

  The leading `*` (architecture §6.6 wrote `src/<m>.o`) matches the object ld is given, `build/src/<m>.o`.
- (g) **One more edge.** `core/verify` may import `core/reconcile` and `core/config/compilers.ts` (architecture §2,
  `test/helpers/architecture.ts`): the text-layout check reads a C stub's INCLUDE_ASM statements to lay out a C unit, and
  no regex runs over code (§6.6), so it must use the one C tokenizer and INCLUDE_ASM finder; it reads the module's build
  compiler for the unit's measured layout. core/reconcile imports only foundation, so no cycle arises.
- (h) **Codes.** The lead creates `core/config/codes.ts` and `core/reconcile/codes.ts` empty and unions them into
  `core/diagnostic-codes.ts`; their owners add each code with its first raiser (D45). `src/shell/codes.ts` is not the
  lead's in phase 4 (b).
- (i) **Barrels.** Empty: `src/api/{config,config-files}.ts` (`p4-config`), `src/api/{scaffold,scaffold-files}.ts`
  (`p4-scaffold`), `src/api/reconcile.ts` (`p4-c-modules`), `src/api/{workflow-one-shot,one-shot-files}.ts`
  (`p4-workflows`); the `*-files.ts` ones in `romlift/node`, the others in `romlift`. The frozen types and values of (c)
  to (e) are exported by the lead's `src/api/one-shot-types.ts` (`romlift`), as phase 3's `config-types.ts` was. The
  command lists `cli/commands/lists/{one-shot,scaffold}.ts` start empty and pass to `p4-workflows`.
- (j) **Every phase-4 threshold applies to the six tuning ROMs** (D60, as D62 h did for phase 3): the roadmap's "all
  five tuning ROMs" reads as the six; `g4.e2e-real` requires six tuning datasets, and the other gates' comments say six.
  This is stricter and loosens nothing. The g4 gate files' "expected interfaces" comments now name the frozen
  interfaces; no assertion changed, and every g4 gate stays `pending` until `init` is exported (wave 3).
- (k) **Owner questions** (phase-4.md): Q1, the scope of Q5 c (only `[functions]` entries with a `from` key are
  validated in the confirm run; a hand-added entry without `from` no longer warns), default (a), accept; Q2,
  correctness-r0-1 (sa2's `g2.speed` headroom), default (a), no change to the gate or `speed.json`; Q3, correctness-r0-2's
  `env -S` launcher requirement as a known limitation (the phase-3 review's words, not the owner's), default (a), record
  it with the launcher test. Q4 (raised by `p4-workflows` in wave 3: is deleting the last listed function a legal
  edit, which `g4.toml-mutations` failed on) was withdrawn by fix round 1, which made the edit legal in the product
  (D75 a). Fix round 1 adds Q5 (a project made by an unpublished romlift needs `ROMLIFT_CLI`, D75 o) and Q6 (the
  `W_UNLISTED_FUNCTION` that `generate` still raises after `init` on tmc and the doubled ROM). The phase does not land
  until Q1, Q2, Q3, Q5 and Q6 are answered. Q5 a (the alignment refusal, D65 a) stays a recorded release-1 limitation by the owner's
  answer (D68 e).

**Consequences.** Every wave-2 and wave-3 component codes against frozen types, paths and texts, and owns files no other
component of its wave touches; the g4 gates stay `pending` until `init` lands; the C-stub texts, the C object paths and
the ASSERT have one definition each.

**Rejected.** `{{name}}` placeholders (they collide with GitHub Actions expressions in `build.yml`). Rendering
`include/macros.inc` and `include/include_asm.h` from template files (two copies of a text the checks read). Exporting
the frozen types from an owner's barrel (two components would edit one file). Validating hand-added entries by a TOML
marker key (Q1's option c; it bloats `[functions]` against §6.5's layout).

## D75. Phase-4 fix round 1

**Context.** The review of phase 4's closing run at `10ff9ed` (phase-4.md, "Review", fix round 1) found two blockers:
the legal TOML edits of a `c` module left a project `make` could not build while `generate` and project-mode `verify
--link` reported success (correctness-1, correctness-2), and `g4.toml-mutations` failed on deleting the last listed
function, which phase-4.md filed as owner question Q4 with no default (delivery-1). R3 and architecture §13 say every
seeded legal edit keeps the link green and `generate` takes every border from the TOML; neither blocker is a gate
change, so each is fixed in the product, and the gates stay as they are or get stricter.

**Decision.**

- (a) **A module start in the data region is legal at every word-aligned address** (architecture §6.2, "Legal
  borders"): at or past the layout's data start no instruction lies, so no branch, PC-relative load or `adr` can cross
  a border there, and ld word-aligns every object. `planModules` takes the data start beside the legal borders
  (`BorderRule`, `isLegalStart`); `legalBorders` itself is unchanged, so `init`, the TOML patcher and every analysis
  golden stay as they were. After the user deletes the last listed function, the confirm run's code ends at the
  deleted entry and its data start moves down, but the `data` module keeps the start the TOML states: the bytes
  between are the tail of the module before, an orphan chunk there. This is phase-4.md's Q4 option (c), taken because
  it conforms to R3 (the TOML states the border) and leaves the gate unchanged; option (b) would have changed the
  confirm analysis and the g2 gates' inputs for the same result. Q4 is withdrawn as an owner question.

- (b) **`generate` reconciles the project's C files** (architecture §6.3 `c-stub` "scaffold at `init`, reconciled
  after", §6.4 `reconciled`, §6.6). An existing `src/<module>.c` of a generated `c` module is no longer a scaffold
  entry that `generate` keeps: `core/workflow/c-stubs.ts` runs `planIncludeAsm` over its text and the module's chunk
  files, and the project's write stream carries a `reconciled` entry (the text's base sha1 and its edits), applied by
  `planWrites` only while the file still has that sha1 (`E_STALE_EDIT` otherwise) and journalled like every edit.
  `planIncludeAsm` adds a missing stub (phase 4's case) and now also removes a stub of the module's own directory whose
  function is not wanted there (a rename, a deleted function, a function moved to another module by a moved or split
  border; a move is that removal plus the insertion in the other module's file). Roadmap 5.A owns "the move and remove
  cases"; they land in phase 4 because without them every legal TOML edit of a `c` module leaves a project `make`
  cannot build (correctness-1), which R3 and `g4.toml-mutations` forbid. Phase 5 keeps the rest of 5.A (renames inside
  C, the matchings split, `g5.reconciler`'s goldens). A stub of another directory, a definition, a comment and a string
  are never removed. A tree written elsewhere (`verify`'s temporary directory, `generate --out`) gets the reconciled
  text, so project-mode `verify --assemble/--link` links the C `make` compiles after `generate`, and refuses a unit that
  holds decompiled C (no compiler there) instead of linking a fresh stub. The check pass still checks the stub the model
  implies, so a C file with decompiled functions is not refused by `generate`.
- (c) **The scaffold's Makefile rebuilds an object whose inputs changed within the second** (`templates/Makefile`).
  The phase-4 Makefile recorded a source SHA-1 for C objects only; an asm unit rewritten by `generate` within the
  second of the previous build kept its old object under GNU make 3.81 (macOS), which compares modification times to
  the second, and the link then failed on a renamed symbol (measured on the composite fixture: `undefined reference to
  Renamed` from `build/crt0.o`). Every object now records the SHA-1 of the files its dependency lists name (the
  assembler's `.d`: its source and every chunk file it includes; a C unit's preprocessor `.c.d`), its source and
  `modules.mk`, and an object whose record differs is removed with the ELF before make decides. The ROM is written by
  the link alone (correctness-8: `objcopy` ran twice per link); the ROM rule only restores a ROM removed since.

- (d) **Padding-only orphans, all of them** (Q5 b, D68 e; review delivery-2, correctness-4, architecture-3). Phase 4
  folded a zero pad only into the function after it in the same module, so the pads at a module's end stayed orphan
  files (25 on the tuning ROMs, 11 in `c` modules, each with its own `INCLUDE_ASM` stub). Such a pad is now the last
  item of the function or orphan chunk before it in its module (`ChunkPlan.tailPad`), a padding item printed `.align
  2, 0`: it is the alignment of the object's end, which a decompiled last function reproduces because ld aligns the
  next object the same way. `test/local/padding-orphans.test.ts` now requires no zero-pad orphan anywhere on the six
  tuning ROMs. The fold changes no byte. The model's `Chunk` and `romlift/model-json@1`'s chunk line carry the entry a
  folded chunk opens past (`entry`, present only when it is not the span's start), so `chunkEntry` reads it instead
  of searching the functions by name, and the printer decides from the item table alone whether the pad is printed
  before the start macro (items.ts makes it data when a label lies in it); the fold rule lives in chunks.ts only. A
  0x46C0 nop pad stays an orphan: no start macro emits it (they open with `.align 2, 0`, zeros), and agbcc's output for
  the function before it does not hold it, so folding it either way would put into a function's file a byte its C
  cannot produce. On the tuning ROMs those are 21 (fe7j), 21 (klonoa), 15 (pokeemerald), 15 (sa2), 15 (sa3) and 0
  (tmc), every one in `c` modules; by the ELF maps, 15 on each ROM but tmc lie in libgcc's `_call_via_rX.o`, which
  phase 6's signatures move into a library `asm` module (architecture §12, "Signatures arrive in phase 6"), and 6 each
  in a hand-written assembly object (fe7j's `arm-call.o`, klonoa's `thunk.o`), which stays in a `c` module. Keeping
  them as orphans is phase-4.md owner question Q7.
  **Revision** (D78 b, correctness-a1-4): a module-end pad after a function of a `c` module is its own orphan again;
  the claim that ld aligns the next object the same way was wrong (gas ends the decompiled C object with a nop).

- (e) **The executable bit is part of the write plan** (review architecture-4). `FileEntry`'s scaffold member and the
  `write` op carry `executable?: true`; `applyWrites` sets the mode on the temporary file before the rename
  (`atomicWrite`'s `mode`), and `planWrites` gives an executable entry whose file exists without its executable bits a
  `mode` op (`WritePlanInputs.executables`, read by the shell), journalled as `{op: "mode", path}`. The chmod after the
  plan, outside the journal, which a crash could skip for good, is gone, and so is `isExecutableEntry`.

- (f) **One path to the config `init` writes** (review architecture-2). `core/workflow/init-config.ts` holds
  `initConfigOf(rom, options)`: the build name (`--name`, or the header's with `_build` on a collision), the discover
  run, configFromDiscover with `--module-size`, serialisation and the parse back. `init`, `generateFromRom` (`verify
  --rom`), `initModel` (`model --rom`) and the bench's "as init would write it" all call it; `discoveredConfig`,
  `configAlone` and the old `initConfig` are gone, so no command checks a config `init` never writes. The scaffold's
  rendering and drift (`projectScaffold`, `scaffoldDrift`) move to `core/workflow/scaffold-diff.ts`, the Myers line
  diff to `foundation/util/line-diff.ts` (architecture-5), and the four copies of the default-profile lookup become
  `discover.ts`'s `profileOrDefault` (architecture-6).
- (g) **The project's file names and the default function spelling live in `foundation/util/project-files.ts`**
  (`BASEROM_FILE`, `ROMLIFT_CONFIG_FILE`, `DECOMP_YAML_FILE`, `DECOMP_YAML_NAMES`, `defaultFunctionName`); core/config,
  core/model, core/scaffold and the shell import them, `nonmatchingDir` uses `NONMATCHINGS_ROOT`, and core/emit's
  `TextEdit` is core/reconcile's re-exported (architecture-7).
- (h) **Codes as architecture §9.1 lists them** (architecture-8, architecture-9). `E_TOML_SYNTAX` is renamed
  `E_TOML_PARSE`; `parseConfig` raises `E_UNKNOWN_COMPILER` for an unknown `[build] compiler` or module `compiler`
  (it was `E_TOML_SCHEMA`); `E_ROM_SHA1_MISMATCH` and its check move from `foundation/rom` (which then held project
  knowledge) to `core/config/rom-sha1.ts` (`romSha1Problems`). §9.1's table lists `E_DECOMP_YAML_INVALID`,
  `E_PROJECT_NOT_FOUND` and `E_TOOLCHAIN_FAILED`, which phase 4 raises.
- (i) **`[build] name` and `[rom] path` are held to the contract `init` and the scaffold assume** (correctness-6). The
  schema accepts only a build name `init` accepts (letters, digits, `.`, `_`, `-`, a letter or digit first, at most 100
  characters) and only `baserom.gba` as `[rom] path` (D74 c), which setup.sh, the Makefile and every `.incbin` name;
  either edit is `E_TOML_SCHEMA` with its line.
- (j) **`init`'s directory policy is core's** (architecture-1). `initDirVerdict(listing)` (absent, empty, the ROM plus
  `.git` and dot-files, or a project; otherwise `E_DIR_NOT_EMPTY`), `replacedProblems(dir, wanted, current)` (an
  existing project's romlift.toml, decomp.yaml or baserom.gba init would replace, compared by sha1) and
  `wantsLockStep` live in `core/workflow/init.ts`; `E_DIR_NOT_EMPTY` moves to `core/workflow/codes.ts`. The shell only
  lists the directory (`readInitDir`) and hashes files (`readDigests`), and the CLI sequences the calls.
- (k) **generate.ts sheds what is not generate** (architecture-13). `ProjectWriteState`, `projectPlanInputs`,
  `freshTreePlanInputs` and `planChangesNothing` move to `core/write-plan/project-plan.ts` (they take the retained
  prefixes as input) and `retainedPrefixes` to `core/model/paths.ts`; the init equivalents move to init-config.ts (f).

- (l) **c-unit.ts keeps one job** (architecture-10): the stub assembly agbcc emits and the chunk files a C stub
  includes. The banner each compiler prints is `BuildCompiler.banner` (measured once, both compilers print `gcc
  2.9-arm-000512`); the dead `BuildCompiler.rule` is gone, and a unit test holds `templates/MANIFEST.json` to one
  `mk/<id>.mk` from `compilers/<id>.mk` per registered compiler; the C-data `ASSERT` lines live in
  `foundation/asm/c-data-assert.ts`, which the ldscript writer and the ldscript check both import; `moduleCompile`
  throws `RomliftInvariantError` for a compiler the schema would have refused instead of inventing a path.

- (m) **`analyze --update --write` saves only over the text it read** (architecture-12). Under the project lock, the
  command reads romlift.toml again and `staleConfigProblems` (core/workflow/analyze-update.ts) compares it with the
  text the patch was planned from; a difference (a user edit or another `--write` during the analyses) is
  `E_STALE_CONFIG` (core/workflow/codes.ts) and nothing is saved, as a reconciled file's stale edit is `E_STALE_EDIT`.

- (n) **No index handle in the public API** (architecture-14, the carried architecture-r2-1). Phase 4 turned
  `TextLayoutIndex` into an opaque handle backed by a module-level `WeakMap`, hidden mutable state in pure core whose
  cloned handle threw. The handle, its registry and `textLayoutIndex` are gone: the index is built and dropped inside
  `checkEntries`, romlift's one public entry of the text-layout check; `checkEntry(rom, model, entry)`, which builds an
  index for one entry, stays in `core/verify/text-layout.ts` for tests and is not exported from `romlift`.
  `g3.text-layout` and `g3.checks-fail`, which run the checks through `verify` and the mutation tests, name
  `checkEntries` in their `needs` (the export whose absence makes a gate pending) instead of `checkEntry`; no
  assertion changes.

- (o) **The installed tarball and setup.sh's npm duty, gated** (delivery-3, delivery-4). `g4.e2e-real` runs the six
  tuning ROMs a second time from the packed and installed package (`npx romlift init` below the install, setup.sh's
  `ROMLIFT_CLI` the installed bin), as roadmap "Phase 4 exit" asks ("from the source tree and from the installed
  tarball"). `g4.packed-e2e` runs its first fixture without `ROMLIFT_CLI`: the project's package.json pins romlift as
  `file:<tarball>` (the one stand-in for a published version) and asm/ is removed, so setup.sh's duty 4 runs `npm
  install` and duty 5 `npx romlift generate` from that install, and `make` must still end at the SHA-1.
  `ROMLIFT_CLI` itself is recorded in architecture §6.3. That a project made by an unpublished romlift needs
  `ROMLIFT_CLI` (or a hand edit of package.json) until romlift is on the registry is a limitation the owner has not
  authorised: phase-4.md owner question Q5.

- (p) **One commit trailer** (delivery-9). From phase 4 the orchestrator asks that every commit end with the single
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line, and every phase-4 commit does; AGENTS.md and
  roadmap.md said two lines (with `Claude-Session:`, which phases 1 to 3 carry). Both now state the one line, so the
  instruction and the history agree.

## D76. The owner's answers of 20 October 2026 to the phase-4 owner questions, and his scope decisions

**Context.** After fix round 1 (D75) the whole closing list of phase 4 passed at `34865f5`, and the phase waited only
for the owner: phase-4.md put Q1, Q2, Q3, Q5, Q6 and Q7 to him (Q4 was withdrawn by fix round 1, D75 a), each built
with its default. Bruno Macabeus answered them on 20 October 2026; each chosen option is quoted as he gave it, and these
are the only gate changes he authorised. The same day he took two scope decisions for the phases after this one, which
phase 4's documents must follow.

**Decision.**

- (a) **Q1, the scope of phase-3 Q5 c: "Only entries with `from`" (option a).** The confirm run validates only the
  `[functions]` entries that carry a `from` key (`Seed.validate`, set by `listedSeedsOf` exactly when the entry has
  `from`, as `p4-confirm-listed` built it); an entry without `from` is taken without the valid.* rules. Consequence,
  recorded as a release-1 limitation: a hand-added entry without `from` that fails validity no longer warns
  `W_LISTED_INVALID`. Nothing changes in the code: the default was the answer. Q1's facts cited `g5.import-legacy`'s
  expectation for a legacy entry; with (g) legacy import is dropped, so the `from` entries the confirm run validates
  are the proposals of the sources phase 6 keeps (`sig:<library>@<version>`, `evidence:<id>`) and an entry a user
  writes with `from`. Nothing in phase 4 depends on `g5.import-legacy`. (At the landing, `analyze --update`'s confirm
  run still validated every listed entry discover no longer found, with or without `from`; D77 e applies this answer
  there too, so the consequence above now holds without exception.)
- (b) **Q2, sa2's `g2.speed` headroom: "Median of more runs" (option c, a gate change the owner authorises).**
  `g2.speed` measures each tuning ROM's analysis over nine serial runs instead of five and takes the median
  (`ANALYSIS_SPEED_RUNS` in `bench/src/speed.ts`); the limit (1.5 × baseline × calibration ratio) and
  `bench/baseline/speed.json` are unchanged, and the calibration and the emission timings of `g3.speed-budget` stay the
  median of five (the answer names each ROM's runs, nothing else). `bench speed --json` names its run counts (`runs:
  {calibration: 5, analysis: 9, emission: 5}`), and the gate requires `runs.analysis` to be nine. (Two corrections by
  D77 f and g: at the landing `g3.speed-budget`'s 3 s analysis budget also read the nine-run median, since it shares
  `analysisCpuMs`, and `runs.analysis` was a constant, not a count of what was measured; since D77 the budget reads
  the median of the first five runs and the count is measured, so only then does a bench that measured fewer fail.) Stated in the gate's source, architecture §8.4, §8.5 and §13, and roadmap.md. If sa2
  still fails `g2.speed` at the landing run, that is a new owner question, not a retry.
- (c) **Q3, the `env -S` launcher: "Known limitation" (option a).** The bin's need for an `env` that accepts `-S`
  (BusyBox or Alpine, GNU coreutils before 8.30 cannot start it; `node dist/cli/main.js` runs uncapped) is a release-1
  known limitation, with the unit test of the built launcher's first line that `p4-safety-minors` added.
- (d) **Q5, `ROMLIFT_CLI` for an unpublished romlift: "Pre-release limitation" (option a).** Until romlift is published
  to the npm registry, a project `init` makes needs `ROMLIFT_CLI` (or a hand edit of package.json) for setup.sh's duty
  4, and every `init` ends with `W_LOCKFILE_DEFERRED`: a pre-release limitation. `ROMLIFT_CLI` is documented in the
  scaffold's `AGENTS.md` and `README.md` (`templates/`) as the way until then. Nothing is published.
- (e) **Q6, `W_UNLISTED_FUNCTION` after `init`: "Known limitation" (option a).** `generate` over `init`'s config raises
  `W_UNLISTED_FUNCTION` on tmc (1, 0x080B1A28) and on the doubled pokeemerald ROM (161): a known limitation of the same
  root as tmc's accepted confirm/discover differences (D61 e).
- (f) **Q7, the 0x46C0 nop pads: "Keep as orphans" (option a).** A pad of one Thumb nop up to a word boundary stays its
  own orphan file and, in a `c` module, its own `INCLUDE_ASM` stub (fe7j 21, klonoa 21, pokeemerald 15, sa2 15, sa3
  15, tmc 0); byte-exact, and the libgcc ones leave the `c` modules with phase 6's signatures.
- (g) **The owner's scope decisions: phase 5 skipped ("We don't need it. Skip phase 5") and "Keep rename and
  objdiff".** Legacy import (`import-legacy`, `g5.import-legacy`, the evidence merge of legacy files), the Klonoa
  migration tooling and the switch-over pull request are dropped; rename and the reconciler, the `expected/` and
  `objdiff.json` writers, the C data ranges and the objdiff gate move into phase 6. The owner also dropped the gba-kit
  trace integration from phase 6. Phase 6 records both decisions in its own decision and rewrites its plan (roadmap.md
  phases 5 and 6, architecture §11 and §13's g5 rows); phase 4 does not rewrite them. In phase 4's documents every item
  carried "to phase 5" that survives points to phase 6 instead (phase-4.md, roadmap.md "Carried from phase 4"), and the
  `g5.*` gate files keep their ids until phase 6 renames or drops them; `--require 4` never counts them.
- (h) **The minors of the review of fix round 1** (its architecture lens; the correctness lens and the landing agent
  failed on a service error, not a finding). Fixed: architecture-r1-1 (`cDataSectionLine` and `cDataAssertLine` in
  `core/model/c-data-assert.ts`, out of foundation; `foundation/util/project-files.ts` is a recorded exception to
  "foundation holds no project knowledge": the project's file names and the default function name, which core/config,
  core/model, core/scaffold and the shell share and no core module is upstream of all four, D75 g; architecture §2's
  tree says so); architecture-r1-5 (`E_UNKNOWN_COMPILER` decided by the refinement's structured marker, `params:
  {romliftCode}`, carried into `ConfigIssue.code`, never by the message; a unit test holds a compiler of the wrong type
  to `E_TOML_SCHEMA`); architecture-r1-8 in part (`projectRomProblems` deleted, its callers call `romSha1Problems`);
  architecture-r1-7 in part (`test/unit/util/line-diff.test.ts`, `test/unit/config/rom-sha1.test.ts`). Carried to
  phase 6 (roadmap.md, "Carried from phase 4"): architecture-r1-2 (the aliases of `BASEROM_FILE` and the two default
  name functions), r1-3 (one owner of the legal-start rule in core/layout), r1-4 (the stub banner from the module's
  compiler), r1-6 (one agbcc pin check and one `readAgbccPin`), r1-7's remainder (the tests that stayed in
  `read-inputs.test.ts` and a `c-stubs` unit test) and r1-8's remainder (`checkEntry`, which thirty text-layout tests
  call; a one-entry `checkEntries` adds the stream-level diagnostics those tests do not expect). Each changes code
  without a defect behind it, and phase 6 reworks the same modules (the reconciler, the C-data ranges).

**Consequences.** Q1, Q3, Q6 and Q7 change no code; Q5 changes the scaffold's `README.md` and `AGENTS.md` templates
and the scaffold golden; Q2 changes `bench speed` and `g2.speed` (more runs, the same limit). (Reworded by D77 k; the
first wording said Q5 changed no code.) The landing procedure followed: `test/gates/phase.json` raised to `{ "landed": 4 }` at `55899d1`, the whole
closing list of phase-4.md in a fresh git worktree with no local caches, and every command exited 0, `g2.speed` among
them (sa2 731 of 790 ms over nine runs; phase-4.md, "The closing gate", the owner's answers): phase 4 passes its closing
gate, and its merge waits for the phase pull request's CI.

## D77. Fix round 2 of phase 4: the review of the landing run after the owner's answers

**Context.** The review of the landing run at `6e5ccd1` (the first after the owner's answers, D76) raised twenty
findings: three majors (correctness-a0-1, correctness-a0-2, architecture-a0-1) and seventeen minors. This round fixes
all three majors and every minor but parts that are carried, and re-runs the whole closing list. Nothing here changes a
gate's verdict rule beyond what the owner authorised: (f) restores what `g3.speed-budget` measured before D76 b, and
(g) makes `g2.speed` check the nine runs D76 b says it checks.

**Decision.**

- (a) **The reconciliation refuses what its edits cannot fix** (correctness-a0-1, a0-7). Renaming or moving a function
  whose C the user wrote used to make `generate` exit 0 and `make` fail (the new name's `INCLUDE_ASM` beside the old
  name's definition: the function twice). Now `planIncludeAsm` raises `E_C_STALE_DEFINITION` (error) for a definition
  whose name the module does not want, lying where a missing stub goes, and `E_C_STUB_UNPLACED` (error) for a wanted
  name with no safe place (it was silently dropped); `reconcileStubs` raises `E_C_DEFINITION_MOVED` (error) for a
  definition of a function the TOML now gives another module, and `W_C_FILE_UNUSED` (warning) for a `src/*.c` that is
  the source of no module (a renamed `c` module, whose old file `make` silently stopped building). An error makes
  `generate` write nothing (`writable`). A definition no module wants and no missing stub lands next to (a static
  helper) is the user's and raises nothing; a stub the user writes by hand holds its name, which is the way past a
  false `E_C_STALE_DEFINITION`. Rename and move of decompiled C stay manual until phase 6's rename command; the
  scaffold's `AGENTS.md` says so. The last stub of a shared line now goes with the blanks before it.
- (b) **No stub inside a preprocessor conditional** (correctness-a0-2). `scanC` records the outermost `#if`/`#ifdef`/
  `#ifndef` … `#endif` regions; an anchor inside one moves to its outer edge (after the `#endif` line, or before the
  opening directive and the comments that lead into it); an unclosed region leaves no safe place inside or after it.
- (c) **A leading byte order mark** (correctness-a0-3) is no token: `tokenizeC` starts after it, with the first line
  still at its start, and no edit moves the mark off offset 0.
- (d) **`generate --out <dir>` writes the C files as generated files of that tree** (correctness-a0-4,
  `outTreeEntries`), recorded in its manifest, so a second run into the same directory rewrites (or deletes) them as it
  does `asm/`. `init`, the project and the fresh trees of `verify` and the bench are unchanged.
- (e) **`analyze --update` follows D76 a** (architecture-a0-1, correctness-a0-6). Its confirm run validated every
  listed entry discover no longer found, a second rule written nowhere; it now seeds through `listedSeedsOf` as
  `generate` does (`updateSeeds` is gone), so only an entry with `from` is validated in every confirm run. This applies
  the owner's answer ("the confirm run validates only [functions] entries that carry a `from` key") rather than
  qualifying it, so it is not put to him. Architecture §4 "Two modes, one driver" says which entries are validated.
- (f) **`g3.speed-budget` measures what it measured before D76 b** (gate-honesty-a0-1). Its 3 s analysis budget had
  read `analysisCpuMs`, the nine-run median after D76 b, a change the owner's answer did not name. Each ROM now also
  reports `budgetAnalysisCpuMs`, the median of the first five of the nine runs (exactly the warm-up and five serial runs
  of before), which the gate reads. `g2.speed` and the ratchet are D76 b's.
- (g) **The run counts are measured** (gate-honesty-a0-2). `medianTimes` returns its samples; each ROM reports
  `analysisRuns`, `runs.analysis` is the fewest any ROM measured and `runs.calibration` the calibration's, and
  `g2.speed` requires both the report's count and each ROM's to be nine.
- (h) **The C stubs' project paths live in `foundation/util/project-files.ts`** (architecture-a0-2, a0-3), the
  recorded exception of D76 h: `NONMATCHINGS_ROOT`, `nonmatchingDir`, `chunkFileOf` and `INCLUDE_ASM_HEADER_PATH`.
  `foundation/asm/dialect.ts` keeps the dialect texts (the macro file's path stays with the dialect, whose `.include`
  line is its own text). `includeAsmDir` is an alias of the one `nonmatchingDir`; `includedChunkFile`, `chunkPaths`
  and `stubName` build on it; `ROMLIFT_RENDERED_TARGETS` takes the two headers' paths from the constants the
  renderers are keyed by.
- (i) **Stale "phase 5" text** (architecture-a0-7, gate-honesty-a0-3): the project-mode `verify` problem text ends
  "(build decompiled C with make)"; the text-layout comment, AGENTS.md (two rows), the readability family summary and
  the code comments that named phase 5 for work phase 6 now does point to phase 6 (D76 g). The C-data ASSERT text and
  the scaffold's matching section stay carried (product text with goldens).
- (j) **`init` checks its own files under the project lock** (architecture-a0-8): the command passes the digests init
  writes; `writeInitProject` reads the files' digests inside the lock and refuses with `replacedProblems`'
  `E_DIR_NOT_EMPTY` before writing anything. `refusedExitCode`, `VERIFY_CODES` and `opCounts` moved to
  `cli/commands/analysis-records.ts`, so no command imports another's.
- (k) **Records** (gate-honesty-a0-4, architecture-a0-4, a0-6, a0-9, a0-10): D76's consequences say what Q5 changed;
  architecture §6.2 says who uses `legalBorders` (nobody in `src` yet) and records the `analyze --update` border
  limitation; architecture §2 lists the phase-4 modules (`init-config.ts`, `c-stubs.ts`, `scaffold-diff.ts`,
  `rom-sha1.ts`, `core/verify/c-stub.ts`, `project-plan.ts`, `write-project.ts`) and marks what D76 g dropped; §6.2
  names `initConfigOf`; the private `discoveredConfig` is `configBeforeSerialising`; roadmap.md's phase 6 enters
  after phase 4 and 6.C's gba-kit items are marked dropped; "Carried from phase 4" gains the `DECOMP_YAML_NAMES`
  re-export, the `legalBorders` callers and the remaining comments.
- (l) **`StubReconciliation.files` is a sorted array** (architecture-a0-5), so a GenerateResult survives a JSON round
  trip as D66 e requires; the views build a local map.

**Revision** (D78, the review of fix round 2): (a)'s rule for `E_C_STALE_DEFINITION` ("lying where a missing stub
goes") is kept only when no chunk files are on disk; otherwise a definition of a function of the previous tree is
stale wherever it lies (D78 a, correctness-a1-2, a1-3). (b) now also never edits a conditional region: its unwanted
stubs are `E_C_CONDITIONAL_STUB` (D78 a, correctness-a1-1). (g)'s `runs.emission` was still the configured count; it
is measured since D78 e. (j)'s two reasons were wrong (`generate` imported `verify`'s `verifyExitCode`; the shell
hashes): D78 f.

**Consequences.** The known limitations of phase-4.md gain the `analyze --update` border case and the manual rename of
decompiled C; `test/unit/workflow/c-stubs.test.ts` (architecture-r1-7's remainder, in part) and planner, CLI, analyze
and write-project tests hold the fixes. The closing list is re-run in a fresh worktree with `landed` 4 (phase-4.md, "The
closing gate", fix round 2).

## D78. Fix round 3 of phase 4: the review of fix round 2

**Context.** The review of fix round 2's closing run at `1c07b13` raised twenty-one findings: five majors
(correctness-a1-1 to a1-4, architecture-a1-1) and sixteen minors. Four of the majors are cases D77 a's reconciliation
still got wrong (a NONMATCHING block whose `#else` stub it removed, a rename or deletion together with a border move
that it let through, a static helper it refused, a case-folded pair it could never let through), and one is D75 d's
module-end pad fold, which is wrong once the function before the pad is decompiled. This round fixes every major and
every minor but the parts it carries or rejects with a reason (phase-4.md, "Review", fix round 3), and re-runs the
whole closing list. No gate's verdict rule changes: (e) moves `g2.speed`'s verdict into a tested helper unchanged, and
(g) removes two `g4.cli-contract` recipes of commands no registry holds.

**Decision.**

- (a) **The reconciliation keys on the previous tree, never edits conditional code, and tells a symbol from a stub
  name** (correctness-a1-1, a1-2, a1-3, a1-5, architecture-a1-1, a1-12). This replaces D77 a's rule for
  `E_C_STALE_DEFINITION` and D77 b's treatment of a conditional region.
  - A wanted chunk is a pair (`WantedChunk`, from `core/model/c-unit.ts` `stubChunks`): its symbol, which a C
    definition of it is called, and its stub name, the chunk file's base name an `INCLUDE_ASM` names; they differ
    for a member of a case-folded group (`<Name>_<ADDR>`). A definition holds its chunk by symbol, a stub by stub
    name, and a missing stub is inserted by stub name. `IncludeAsmWanted.chunks` replaces `names`.
  - Inside an `#if`/`#ifdef`/`#ifndef` region nothing is edited. A stub there holds its chunk (the `#else` branch of
    the NONMATCHING pattern is the default build's); a definition there holds nothing, so a chunk whose only C is
    conditional gets its stub outside the region. An unwanted stub there is `E_C_CONDITIONAL_STUB` (new, error,
    `core/reconcile`) instead of a removal, which left the default build without the function's code.
  - The previous tree is the chunk files on disk (the reason first given here, "`asm/` is committed, so a fresh
    clone has them", was the scaffold's unrecorded departure from R4; the owner's answer to Q9, D79 b, gitignores
    `asm/`, so this rule holds from the second `generate` of a clone, and the first, setup.sh's duty 5, has no tree on
    disk and uses the fallback rule below):
    `readProject` lists `asm/nonmatchings/*/*.s` (`ProjectInputs.previousChunkFiles`, a new optional member of the
    frozen type), `core/model/paths.ts` `chunkNamesOf` reads the names back (each base name, and `<Name>` for each
    member of a case-folded group, a directory holding two or more `<Name>_<ADDR>` files of different names that
    fold to one text, so `sub_<ADDR>` is never read as a group `sub`), and `reconcileStubs` passes the planner the
    previous names no module has now. A definition of one is `E_C_STALE_DEFINITION` wherever it lies, a border move
    included; a static helper, no function of any tree, raises nothing. Without chunk files on disk the planner
    keeps D77 a's rule (stale only where a missing stub goes). The message names the stub whose slot it holds, if
    any.
  - `E_C_DEFINITION_MOVED`'s advice depends on the destination module's kind: a `c` module's source, else delete the
    C or make that module `c`.
- (b) **A zero pad that ends a `c` module after a function stays its own orphan** (correctness-a1-4). D75 d folded it
  into the function as its last item, `.align 2, 0`, on the claim that "a decompiled function there ends its C
  object, whose section ld aligns the same way". That is wrong: gas pads the end of the C object's `.text` to the
  section's alignment with a Thumb nop (0x46C0), so the object already ends aligned and ld has nothing to fill, and
  the ROM's zeros became `C0 46` (measured on klonoa: `make` failed after a module split behind a decompiled
  `bx lr`). The pad is an orphan with its own `INCLUDE_ASM` again, as before D75 d, when the chunk before it is a
  function of a `c` module; it still folds after any chunk of an `asm` module and after an orphan. The owner's answer
  to phase-3 Q5 b (a pad before a function folds into it) is untouched; only D75 d's extension to module ends is
  narrowed. Orphan files on the tuning ROMs: fe7j 28 → 32, klonoa 23, pokeemerald 18 → 23, sa2 15 → 16, sa3 15,
  tmc 32 → 33 (the 11 pads D75 d counted in `c` modules); `test/local/padding-orphans.test.ts` requires every
  zero-pad orphan left to be exactly such a pad. Nine fixtures' model and writer goldens change; no byte changes.
- (c) **The C-data text names no phase** (correctness-a1-6, architecture-a1-10): the ASSERT says "src/<m>.c defines
  data; see AGENTS.md (romlift does not place C data yet)" and the scaffold's `AGENTS.md` heading "Data defined in C
  fails the link", since the owner skipped phase 5. `g4.c-data-fails-loud` matches only "src/<m>.c defines data; see
  AGENTS.md", so its verdict is unchanged; its comment, the ldscript goldens and the scaffold golden follow.
- (d) **Public names** (architecture-a1-4): `includeAsmDir`, `includedChunkFile`, `stubName` and `core/model/paths.ts`'s
  `nonmatchingDir` re-export are deleted; `romlift` exports `nonmatchingDir` once (from
  `foundation/util/project-files.ts`), `stubChunks` and `StubChunk`. `project-files.ts` gains `stubNameOf`
  (`chunkFileOf`'s inverse), `INCLUDE_DIR` and `INCLUDE_ASM_HEADER_NAME`; `C_STUB_HEADER` is built from the name, and a
  unit test holds the Makefile's `-I include` to `INCLUDE_DIR`. This completes D77 h.
- (e) **Speed** (gate-honesty-a1-2, a1-3, architecture-a1-8): `runs.emission` is the fewest samples behind any
  `generateCpuMs` or `initCpuMs` (0 when none was measured: the synthetic tier is no cartridge), not the configured
  count D77 g left it at; every count goes through `fewest`, never `Math.min()` of nothing. `analysisRow` builds a
  ROM's row, and a unit test holds `budgetAnalysisCpuMs` to the median of the first five of nine known samples and
  `analysisCpuMs` to the median of all nine. `g2.speed`'s verdict is `test/gates/speed-verdict.ts`'s, unchanged, with
  a unit test that a report or a ROM of five runs is rejected. No gate reads `runs.emission`.
- (f) **CLI and shell** (architecture-a1-2, a1-3, a1-6, a1-7): D77 j said the shared helpers moved "so no command
  imports another's"; `generate` still imported `verify`'s `verifyExitCode`. The module is now
  `cli/commands/command-common.ts`, holds `verifyExitCode`, and is listed in architecture §2. D77 j also said the
  command computes init's digests "since core never hashes"; `writeInitProject` is in the shell, which hashes, and
  the optional parameter let a caller skip the check. It now computes them from its own `files` and the ROM (one
  spelling of init's file set, `initTexts`) and returns `refused: true` when that check refused, which the command
  prints alone instead of matching diagnostic codes. `initDirVerdict` drops its unread `project`; `TreeSource` takes
  one `target: 'project' | 'out' | 'fresh'` instead of two exclusive booleans.
- (g) **Records and tests** (gate-honesty-a1-1, a1-4, architecture-a1-5, a1-9, a1-10, a1-11, a1-13): phase-4.md records
  the spread of the nine-run sa2 shares and where it comes from; roadmap.md's carry from phase 3 states D77 f; the
  families test title points to phase 6; `g4.cli-contract` drops its recipes for `import-legacy` and `trace`, which
  the owner dropped and no registry holds (a recipe of an absent command is never run, so no verdict changes). The
  `g5.*` gate files keep `phase: 5` and their headers: D76 g leaves their ids, phases and fate to phase 6, and
  `--require 4` does not count them. Architecture §6.2's "one path" sentence (D75 f) is limited to `init`, `verify
  --rom`, `model --rom`, `bench speed`'s emission timings and `run --scaffold`'s init build; `explain --rom` and the
  bench's printer, readability and objdiff models use `discoverModel` (D35: explain explains the discover run it
  traced). The legal-border gate oracle (architecture-a1-5) joins r1-3's carry to phase 6. New tests: the planner
  (conditional stubs, the previous tree, a case-folded pair), `reconcileStubs`, five `generate` CLI cases (the
  NONMATCHING rename, a border move with a move, rename or deletion, a helper, a case-folded pair), the module-end
  pad, `chunkNamesOf`, `command-common.ts`, `speed-verdict.ts`, `analysisRow`.

**Consequences.** The scaffold's `AGENTS.md` says what `generate` does with conditional code; phase-4.md's known
limitations name `E_C_CONDITIONAL_STUB` beside the manual rename of decompiled C. The closing list is re-run in a fresh
worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 3).

## D79. The owner's answers of 21 October 2026 to phase-4 Q8 and Q9

**Context.** The review of fix round 3's closing run (round a2, at `2314ffe`) raised two findings that only the owner
could settle, and phase-4.md put them to him as Q8 (gate-honesty-a2-1: D78 b keeps 11 zero pads as orphans, which
loosened the padding-orphans assertion that held phase-3 Q5 b's fold, with no owner question) and Q9
(architecture-a2-1: the scaffold commits the generated `asm/` and `data/`, against the plan's R4 and its scaffold
table, with no decision recording it, and D78 a rested a rule on it). Bruno Macabeus answered both on 21 October 2026;
each chosen option is quoted as he gave it. With D76's they are the only gate changes he authorised.

**Decision.**

- (a) **Q8, the zero pads that end a `c` module right after a function: "Keep as orphans".** The 11 pads D78 b keeps
  as their own orphan files (fe7j 4, pokeemerald 5, sa2 1, tmc 1; klonoa and sa3 none), because folding one into the
  function before it breaks the build once that function is decompiled (gas ends its C object with a 0x46C0 nop), stay
  orphans: byte-exact, one stub line each. A known limitation authorised by the owner, like Q7's nop pads (D76 f).
  `test/local/padding-orphans.test.ts` asserts exactly that rule: every zero-pad orphan left is such a pad, and their
  number per ROM is the 11 above.
- (b) **Q9, the generated tree in Git: "Gitignore, as R4 says".** The scaffold's `.gitignore` ignores the generated
  roots, every path R4 and plan.md's scaffold table mark "In Git: No": `/asm/`, `/data/`, `/expected/`,
  `/ldscript.txt`, `/symbols.ld`, `/modules.mk` and `/objdiff.json` (`GENERATED_ROOTS`, anchored at the project root).
  A fresh clone or `git worktree` builds through setup.sh's duty 5, which runs `romlift generate` when `asm/` is
  absent. The C reconciliation's rule that reads the previous tree on disk (D78 a) holds from the second `generate`
  of a clone; the first has no chunk files on disk and uses the fallback rule (a definition the module no longer has
  where a missing stub goes is `E_C_STALE_DEFINITION`). D78 a, `src/core/workflow/c-stubs.ts`, `include-asm.ts`,
  architecture §1 (R4), §6.3 and §6.6 and the scaffold's `AGENTS.md` and `README.md` say so. `g4.worktree` assumed
  nothing of a committed tree (its worktree ran setup.sh either way); it now requires that no generated root is
  committed and that the worktree's `setup.sh` ran duty 5. The scaffold's render test, which required the roots not
  to be ignored, requires each to be.

**Consequences.** Q8 changes no product code; the padding-orphans test pins the counts. Q9 changes the `.gitignore`
template, the scaffold golden, `g4.worktree` and the render test. correctness-a2-7 of the same review (a rename in a
fresh clone left the old chunk file, unowned, forever, since a committed `asm/` came without the gitignored manifest)
no longer arises: a clone has no `asm/`, and its first `generate` writes the whole tree under a new manifest.

## D80. Fix round 4 of phase 4: the review of fix round 3

**Context.** The review of fix round 3's closing run at `2314ffe` (round a2) raised eighteen findings: five majors and
thirteen minors. Two majors were owner questions, answered as Q8 and Q9 (D79). The three others are cases the C
reconciliation got wrong, each reproduced on klonoa by the review: a decompiled function renamed in C only had its
`INCLUDE_ASM` inserted again (correctness-a2-1, a regression of D78 a), a conditional whose branches open braces
differently made a definition swallow the file (correctness-a2-2), and a split inside an `#if` region put the new stub
after the region, out of ROM order (correctness-a2-3); each left `generate` exit 0 and `make` failing. No fix changes a
gate beyond D79's answers.

**Decision.**

- (a) **The reconciliation refuses what it cannot place exactly** (correctness-a2-1, a2-2, a2-3, a2-6).
  - A wanted chunk whose stub file the previous tree held in this module's own directory
    (`IncludeAsmWanted.priorStubs`, from `previousChunkFiles`; `previousStubs` since D81 d) and which the file neither includes nor defines had its
    `INCLUDE_ASM` replaced by C; a definition of another name where its stub goes is `E_C_STALE_DEFINITION` ("where the
    INCLUDE_ASM of X was, and module M still has X"). A chunk whose stub name is new to that directory (a TOML rename,
    a border move) keeps D78 a's helper exemption. `IncludeAsmWanted.previous` is renamed `retired`.
  - The scanner tracks every `#if`/`#ifdef`/`#ifndef` and requires each branch (at `#elif`, `#else` and `#endif`) to
    leave the brace and parenthesis depth the conditional found; a definition that never closes, and a `{` at file
    scope after a head that names no function (a K&R definition, an unreadable head), are unscannable too.
    `planIncludeAsm` refuses such a file whole with `E_C_UNSCANNABLE` (new, error, `core/reconcile`), no edit, so
    `generate` writes nothing. A definition's name skips `(*` declarator groups and GCC `__attribute__`/`asm` groups
    (`void (*B(void))(void)`, `__attribute__((section(".iwram"))) void B(void)`), so neither reinserts its stub.
  - A missing stub after a chunk held inside a region whose next held chunk lies in the same region has no safe place
    (`E_C_STUB_UNPLACED`). The ROM order is checked again over the planned text: an insertion that lands before the
    held chunk it was placed after, or after the one it was placed before, while the file held those two in order, is
    `E_C_STUB_UNPLACED` and is not written; an order the file already broke stays `W_C_ORDER`. (That rescan is
    removed by D82 c: no layout reached it.)
- (b) **One predicate, every C file read, and the edit checked at its write** (architecture-a2-3, correctness-a2-4,
  a2-5). `compiledDefinitions` (`core/reconcile/include-asm.ts`, a named definition outside every conditional) is what
  the planner counts as held and what `decompStateOf` lists. `reconcileStubs` reads the `src/*.c` of no module too:
  a function a module has, defined there, is `E_C_DEFINITION_MOVED` beside `W_C_FILE_UNUSED` (a `c` module merged into
  another, or made `asm`, no longer drops its decompiled C silently). `applyWrites` hashes an edit's file right before
  its write and stops with `E_STALE_EDIT` (the journal left) when a save landed since the plan.
- (c) **Smaller fixes** (architecture-a2-4, a2-5, a2-7): `isChunkFile` in `foundation/util/project-files.ts` and
  `isDirectory` in `shell/fs.ts` (absent only on ENOENT or ENOTDIR, any other failure `E_IO_READ`) for
  `readChunkFiles`, with its unit tests; the planner's neighbours are `earlier`/`later`; `WantedChunk` and `StubChunk`
  say that they mirror each other across the `core/reconcile` edge; `allDiagnostics` is `command-common.ts`'s, used by
  `verifyExitCode` and `verify`.
- (d) **Records** (gate-honesty-a2-2, a2-3, architecture-a2-2, a2-8): phase-4.md's Q7 and plan.md state D78 b's
  module-end rule and Q8; the memory limitation names every form and peak measured over the budget; architecture.md
  points the surviving phase-5 items to phase 6 and marks the dropped ones (D76 g); roadmap.md's r1-6 carry names
  the three `readAgbccPin`. Carried to phase 6: architecture-a2-6 (init's own file set, spelled in the shell's
  `initTexts`, to come from core's plan: it changes the frozen `InitPlan`, and no defect is behind it).

**Consequences.** New tests: the planner (a C-only rename, the reviewer's and sa2's conditional shapes, a split inside
a region, the named heads, `compiledDefinitions`), `reconcileStubs` (the module's own previous directory, a file of no
module), three `generate` CLI cases (a C-only rename, an unbalanced conditional, a merged module), `decompStateOf`,
`readChunkFiles` and `readProject`'s previous tree, and the stale edit at write. The closing list is re-run in a fresh
worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 4).

## D81. Fix round 5 of phase 4: the review of fix round 4

**Context.** The review of fix round 4's closing run at `32390c3` (round b0) raised twelve findings: four on
correctness (three majors, one minor) and eight on the architecture (minors). The majors were reproduced on klonoa: a
file whose `#if` branches inside a function open braces differently (`#ifndef NONMATCHING do { #endif … } while (0);`,
a common matching idiom) was refused whole by D80 a's `E_C_UNSCANNABLE` even when it needed no edit, so since asm/ is
gitignored (D79 b) a committed project that builds could not be built from a clone (correctness-b0-1); a `c` module
renamed with its source moved by hand kept the old directory's `INCLUDE_ASM` lines and `make` failed
(correctness-b0-2); and an `[[overrides]]` entry without `runs_at` silently did nothing (correctness-b0-3). No fix
changes what a gate requires; the two gate edits the review proposed are carried to phase 6 (below, c).

**Decision.**

- (a) **The scanner reads a conditional as the preprocessor would, and refuses only a file that needs an edit**
  (correctness-b0-1, b0-2; architecture-b0-2).
  - Each branch is scanned from the state its `#if` found (the current item, its depths and the open definition),
    and the state the first branch reached stands after the `#endif`; the items every branch completes are kept (the
    NONMATCHING pattern's `#else` stub still holds its chunk). Inside a body any branch shape scans (the do/while
    idiom, tmc's per-version `if (…) {` branches, sa2's `screen_mask.c`); a branch that closes the body it opened in
    is unscannable. At file scope the branches (the `#if`'s own state standing for an absent `#else`, unless an
    `#elif` chain covers the builds) must end alike: the same depths, the same open definition, and both with or
    without a parenthesis group in an unfinished head (`ASM_FUNC("…", void f(void))` with no `;` against a
    definition is unscannable; a bare `END_NONMATCH` is not). Measured over the 1,739 `.c` files of sa2, sa3,
    pokeemerald, fe7j, tmc, kleod and klonoa: 35 unscannable before, 2 after (both that `ASM_FUNC` shape in sa2).
    Of the files scannable before, all but 10 scan to the same definitions and stubs: in 9 a definition now starts
    at its own head rather than at a bare macro a conditional before it left unfinished (`#if COLLECT_RINGS_ROM
    END_NONMATCH #endif`), which had put its start inside that conditional and so out of the compiled definitions
    (such a leftover now ends with its region); the 10th is one of the 2 now unscannable.
  - A definition whose head a region holds and whose body runs past the region's `#endif` (sa2's `light_bridge.c`:
    a register pin in one head, the plain head in the other) is compiled in every build; the planner anchors after
    its body.
  - A file the scanner cannot split gets no edit. It needs one when a wanted chunk is neither named by a stub its
    tokens spell at any depth nor defined as far as the scanner read, when a stub at any depth would go, or when an
    unwanted stub lies in a region: `E_C_UNSCANNABLE`, as before. Otherwise `W_C_UNSCANNABLE` (new, warning,
    `core/reconcile`), with the E_C_STALE_DEFINITION of a definition of a retired function, and the file builds as it
    did; so `setup.sh`'s duty 5 in a clone no longer fails on a project whose C built.
  - `compiledDefinitions` returns the scanner's verdict with the definitions (`{scannable, definitions,
    unscannable?}`), so no caller can skip the precondition (D82 c: the planner reads its definitions and tests the
    scanner's verdict itself, editing nothing in a file it cannot split): the planner decides as above, a C file of no module is
    checked over what was read and warns `W_C_UNSCANNABLE` (`unscannableWarning`, a reconcile code raised through
    its helper), and `decompStateOf` states its policy (the definitions as read: phase 4 emits nothing differently
    for the DecompState).
  - A stub of another `asm/nonmatchings/<m>` directory whose file the new tree does not write (`IncludeAsmWanted.tree`:
    the tree's chunk files, and the directories of the `generated = false` modules, whose stubs stay the user's) is
    unwanted like one of the module's own: removed outside a region, `E_C_CONDITIONAL_STUB` inside one. A `c` module
    renamed with `git mv src/<old>.c src/<new>.c` keeps no stub of the old directory; the scaffold's `AGENTS.md` says
    how to rename a `c` module.
- (b) **One staleness rule** (architecture-b0-1): `staleEdit(op, sha1Now, when)` in `core/write-plan/plan-writes.ts`
  is the rule `planWrites` applies at plan time and the shell's `applyWrites` calls over the sha1 it reads right
  before an edit's write; the shell raises no core code itself. Architecture §6.4 steps 3 and 4 and §9.1 say so.
  This amends D80 b's "the edit checked at its write": the check is the shell's read and core's verdict.
- (c) **Two config defects get a diagnostic; their gate cases wait for phase 6** (correctness-b0-3, b0-4).
  `E_FUNCTION_MISALIGNED` (new, error, `core/model`): a `[functions]` key that is odd for Thumb or not word-aligned
  for ARM is refused naming the key (the pointer-value hint for an odd Thumb key), so `generate` exits 1 before the
  check pass instead of 3 with `E_SELF_CHECK_TEXT` on a generated file. `W_OVERRIDE_IGNORED` (new, warning,
  `core/model`): an `[[overrides]]` entry without `runs_at` that changes nothing (a data override always; a code
  override that gives no listed entry its extent), a known limitation recorded in phase-4.md, until phase 6 applies
  overrides to the analysis (roadmap.md, "Carried from phase 4"). Making `g4.toml-mutations`' add-override edit one
  that changes the model, and adding an odd key to its illegal edits, change a gate the owner has not authorised in
  phase 4 (his answers authorise only Q2's and Q9's): both are carried to phase 6 with the override semantics. The
  gate's legal edit stays what its header says (a code override over a found function, which now warns) and passes.
- (d) **Smaller fixes** (architecture-b0-3 to b0-7): `g4.worktree` reads the product's rule
  (`cx.need('underGeneratedRoot')`) instead of its own list of the generated roots, which is the same list, so the
  gate's verdict is unchanged (D82 e puts the gate's own R4 list back, united with the product's rule); the `romlift` reconcile barrel exports `compiledDefinitions`, `CompiledDefinitions`,
  `CUnscannable`, `CConditional`, `WantedChunk` and `StubTree`, its ownership line names phase 6, and the phase-4
  exports test covers it; `src/cli/index.md` lists the phase-4 commands and project mode, `src/core/index.md` and
  `src/shell/index.md` list the phase-4 modules, and `analyze.ts` and `core/index.md` no longer name legacy import
  as live; `isDirectory` and `readChunkFiles` have tests of a directory they cannot examine (mode 000, `E_IO_READ`);
  `moduleChunkStubs` in `core/model/paths.ts` beside `chunkNamesOf` is the one reader of a module's chunk files on
  disk, and `IncludeAsmWanted.priorStubs` is `previousStubs`. architecture-b0-8 needed nothing.

**Consequences.** New tests: the planner (the do/while idiom, per-version branches, `screen_mask.c` and
`light_bridge.c` shapes, a warning versus a refusal for an unscannable file, the stubs of a directory the tree no
longer writes), `reconcileStubs` (an unscannable file of no module, a moved module), `decompStateOf`, `staleEdit`,
the model (`E_FUNCTION_MISALIGNED`, `W_OVERRIDE_IGNORED`), five `generate` CLI cases (the idiom, then in a fresh
clone; an unscannable file warned then refused; a moved module with and without decompiled C; an odd key with and
without `from`; an ignored override), the shell's two mode-000 cases, and `test/local/decompiled-c.test.ts` on klonoa
with agbcc (the idiom, a fresh clone through `./setup.sh`, a renamed module moved by hand, each to the SHA-1). The
closing list is re-run in a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 5).

## D82. Fix round 6 of phase 4: the review of fix round 5

**Context.** The review of fix round 5's closing run at `3a1eea7` (round b1) raised seventeen findings: five on
correctness (two majors, three minors), eight on the architecture (minors) and four on gate honesty (minors). The
majors were reproduced on a composite project: since the generated tree is gitignored (Q9, D79 b), a `git pull` that
changed `romlift.toml` left the old tree on disk, `make` failed in the assembler or the linker and `./setup.sh` could
not repair it (correctness-b1-1); and a split that moved decompiled C to a new module sent the user to a file that did
not exist, which, created with only the C, got `INCLUDE_ASM` lines and no `#include "include_asm.h"`, so it did not
compile (correctness-b1-2). No fix changes what a gate requires; two gate files are restored to what their own text
and the owner's Q9 answer say (gate-honesty-b1-1, b1-2), and one gate's note reports its counts by kind.

**Decision.**

- (a) **A generated tree older than `romlift.toml` stops `make`** (correctness-b1-1). `modules.mk` records the SHA-1
  of the `romlift.toml` bytes it was generated from, `ROMLIFT_TOML_SHA1` (the shell hashes the file and passes it in,
  `ProjectInputs.configSha1` and `EmitContext.configSha1`; `init` hashes the text it writes through its new `hash`
  argument; outside a project, `verify --rom` and the bench, there is no such line, so their trees and digests are
  unchanged). The scaffold's `Makefile` compares it with the file's SHA-1 before any build (`make clean` excepted) and
  stops with "romlift.toml changed since romlift generate last ran (a pull, a checkout or an edit): run npx romlift
  generate (or ./setup.sh), then make"; a C object's recorded SHA-1 leaves that line out, so a TOML edit does not
  recompile every C unit. `setup.sh`'s duty 5 runs `romlift generate` when `asm/` is absent or when `modules.mk`
  records another SHA-1 (or none). The scaffold's `AGENTS.md`, `README.md` and `.gitignore` say to run `npx romlift
  generate` (or `./setup.sh`) after a pull or a checkout that changes `romlift.toml`. An existing project keeps its
  `Makefile` (scaffold files are written once; `scaffold --diff` shows the new template).
- (b) **The C reconciliation follows the C a user writes where romlift sends it** (correctness-b1-2 to b1-5).
  - A file that gains a stub and holds neither an `INCLUDE_ASM` statement nor `#include "include_asm.h"` gains that
    include (`C_STUB_HEADER`) above its first line of code, below the comments that open it.
    `E_C_DEFINITION_MOVED` names the module's source path and says to create it with only the C.
  - A `src/*.c` that a module's source `#include`s at file scope (outside every item; the quoted path resolved from
    the file's directory) is part of that module: its compiled definitions hold their chunks at the `#include` line
    (`IncludeAsmWanted.fragments`, `CDefinition.via`), a function of another module in it is `E_C_DEFINITION_MOVED`
    naming it, a retired one `E_C_STALE_DEFINITION`, and it is no `W_C_FILE_UNUSED`. A quoted include of a file romlift
    does not read whose path does not end in `.h` refuses every insertion into the including file
    (`E_C_STUB_UNPLACED`), since that file may define the function; the scaffold's `AGENTS.md` says decompiled C goes in
    `src/<module>.c` or a `src/*.c` it includes.
  - A definition in every branch of a terminated conditional that has an `#else`, outside the conditionals nested in
    those branches, is compiled in every build (`compiledDefinitions`; the first branch's counts), so pret's `#ifdef
    NONMATCHING <C> #else NAKED <asm> #endif` holds its chunk and gets no second stub. A stub placed after such a
    definition goes after the region's `#endif`.
  - Every insertion takes the file's line terminator (`\r\n` when the first newline follows a carriage return).
- (c) **Smaller fixes of the planner** (architecture-b1-4, b1-5, b1-7). Fix round 4's rescan of the planned text for
  an insertion out of ROM order (`misplacedInsertions`) is removed: no test reached it, a 200,000-case fuzz never
  produced it, and every insertion lands between the held chunks it was placed between; architecture §6.6 and D80 a's
  clause no longer describe it. `heldOf` and the check of a file the scanner cannot split read
  `compiledDefinitions(scan).definitions`; the docstring, §6.6 and D81 a now say the planner tests the scanner's
  verdict itself (it edits nothing in a file it cannot split). `test/local/c-scan-corpus.test.ts` holds D81 a's
  measurement: over the 1,729 `src/**/*.c` of the six tuning checkouts (D81 a's 1,739 counted the 10 of the
  klonoa-empire-of-dreams working tree, which is no dataset checkout) the unscannable files are exactly sa2's two.
- (d) **Config and layering** (architecture-b1-1 to b1-3, b1-6). `E_FUNCTION_MISALIGNED` moves from `core/model` to
  `core/config` (`misalignedFunctionKeys` in `keys.ts`, raised by `parseConfig` after the schema, with the key's line),
  so `analyze --update` and every other command that loads `romlift.toml` refuse a misaligned key, and the confirm run
  never sees it beside a `W_LISTED_INVALID`; the predicate is `insnAligned(mode, addr)` with `insnUnit(mode)` in
  `foundation/rom/span.ts`, read by the assembler layout, the instruction rows, `seed.ram-copy` and the config.
  `valid.in-rom-unclaimed` keeps its Thumb-only test (no listed entry reaches it misaligned any more).
  `W_OVERRIDE_IGNORED` is derived from what `placeEntries` reports it applied (`PlacedEntry.override`), not from the
  override's kind, and is not raised for a range wholly outside the ROM (`W_OVERRIDE_OUTSIDE_ROM`'s). `staleEdit`
  takes a closed union (`EditedFileState`: sha1, absent, unread), the planner reads the disk first (an absent file is
  "absent"), the shell's write-time check reports a file removed since the plan, and `planWrites` has its docstring
  back. The shell builds the chunk paths with `chunkFileOf(nonmatchingDir(…), stubNameOf(…))` and lists `src/` with
  `isCSource` and `cSourceOf` (`foundation/util/project-files.ts`, beside `C_SOURCE_DIR`).
- (e) **Gates and records** (gate-honesty-b1-1 to b1-4, architecture-b1-8). `g4.worktree` holds R4's list of
  generated roots itself again (`R4_GENERATED`) and unites it with the product's `underGeneratedRoot`, so a product
  that lost a root still fails and a root a later phase adds is covered; this amends D81 d. `g4.toml-mutations`'
  snapshot of a refused `generate` leaves out only `.git` and `tools/agbcc` (the compiler checkout, which romlift never
  writes and which is too large to hash per edit), no longer the whole `tools/`, and its header says so; its note
  reports the legal edits by kind and that the add-override one is a no-op that warns (D81 c). The memory limitation
  states the range the runs measured, and fix round 5's closing row states the no-op share of its legal edits.
  roadmap.md "Carried from phase 4" lists the code whose only producers the owner dropped (`seed.evidence-hint`, the
  `legacy` and `evidence:trace` proposal sources, the trace reader and format), and architecture §2 marks
  `rename-tokens.ts` as phase 6's and the trace files as dropped.

**Consequences.** New tests: the planner (the header, CRLF insertions, a definition in every branch, fragments read
and unread), `reconcileStubs` (a fragment), the config (`E_FUNCTION_MISALIGNED` with lines), the model (an override
wholly outside the ROM), `staleEdit` (the union, the absent-and-unread message), `modules.mk`'s stamp, the scaffold's
`Makefile` and `setup.sh` duty 5 run against a stale and a current `modules.mk` (with `make`), the CLI (the stamp from
`init` and after a TOML edit, a split behind decompiled C, a fragment, a misaligned key in `generate` and `analyze
--update` with the full diagnostic list), `test/local/decompiled-c.test.ts` on klonoa with agbcc (a split at the
decompiled function with its C pasted alone into the new file, and a Git clone that pulls two upstream renames,
`make` stopping until `./setup.sh` or `romlift generate`, each to the SHA-1) and `test/local/c-scan-corpus.test.ts`.
The closing list is re-run in a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 6).

## D83. Fix round 7 of phase 4: the review of fix round 6

**Context.** The review of fix round 6's closing run at `d615ceb` (round b2) raised sixteen findings: two majors
(correctness-b2-1, architecture-b2-1) and fourteen minors. correctness-b2-1 was reproduced on klonoa: with an
`INCLUDE_ASM` line moved from `src/main_3.c` into a `src/part.c` it `#include`s, `generate` exited 0 and inserted the
stub again (make: `invalid offset`), and after a TOML rename of that function it left the fragment's stub naming a file
no longer written (make: `can't open`); fix round 6 read a fragment's definitions but not its statements.
architecture-b2-1: the scaffold's `Makefile` and `setup.sh` hash `romlift.toml` by name against `modules.mk`'s stamp
(D82 a), while `decomp.yaml`'s `tools.romlift.config` could name any project path, so a relocated config stopped
`make` after every `generate`. Each fix is the simplest rule that cannot break a user's build, with a test that
reproduces the reviewer's case and then runs `make`. No gate changes what it requires.

**Decision.**

- (a) **A fragment's `INCLUDE_ASM` lines are read; romlift never edits a fragment** (correctness-b2-1,
  architecture-b2-4, b2-5). The planner (`IncludeAsmWanted.fragments`, now the texts of the `src/*.c` that are no
  module's source) reads each fragment a module's file `#include`s at file scope, and each `src/*.c` that fragment
  includes in turn: its compiled definitions and its `INCLUDE_ASM` statements (at any depth when the scanner cannot
  split it) hold their chunks at the module file's `#include` line (`IncludeAsmStatement.via`, `fragmentLine`), so no
  stub a fragment holds is inserted again, and two chunks one `#include` holds raise no `W_C_ORDER`. romlift never
  edits a fragment: a stub in one that the module no longer wants, or that names a file of a directory the tree no
  longer writes it in, is `E_C_FRAGMENT_STUB` (new, error, `core/reconcile`), naming the fragment and the line; a
  missing stub whose ROM-order place lies between two chunks one `#include` holds is `E_C_STUB_UNPLACED` naming the
  fragment; a fragment the scanner cannot split is `W_C_UNSCANNABLE` naming it, or `E_C_UNSCANNABLE` (no edit) when the
  module's file needs one. Each error makes `generate` write nothing; `make` then stops on the stale-tree guard
  (D82 a) until the user edits the fragment. An `#include` of another module's source (`IncludeAsmWanted.sources`) is no
  fragment, since make compiles it on its own: it refuses every insertion as an unread file does, and the message says
  which module's source it is (it had said romlift does not read the file).
- (b) **The config is always `romlift.toml`** (architecture-b2-1). `readDecompYaml` refuses a `tools.romlift.config`
  other than `romlift.toml` with `E_DECOMP_YAML_INVALID`, as the schema refuses a ROM path other than `baserom.gba`
  (D74 c), so the one file the `Makefile` and `setup.sh` hash is the one romlift reads. Every command that loads the
  project refuses such a `decomp.yaml` before anything is read or written, and `make` keeps building the tree it has.
  The hand-written-`decomp.yaml` test that read `config/project.toml` now expects the refusal, and `saveConfig`'s test
  saves at `romlift.toml`.
- (c) **The C sources' spelling has one owner** (architecture-b2-7, b2-12). `C_SOURCE_DIR`, `isCSource` and
  `cSourceOf` stay in `foundation/util/project-files.ts`, the recorded exception (D76 h), and every layer imports them
  from there: `core/model/paths.ts`'s `isCSource` re-export is gone, `src/api/reconcile.ts` re-exports it from
  foundation, and `c-data-assert.ts` spells the source with `cSourceOf`. Architecture §2's exception list and
  `src/foundation/index.md` name every spelling the exception holds.
- (d) **The stamp and the write** (correctness-b2-2, b2-3, architecture-b2-2, b2-3, b2-11). `planWrites` orders the
  write of `modules.mk` after every other op, so a `generate` that stops part-way (E_IO_WRITE, the write-time
  E_STALE_EDIT, a kill) leaves the old `ROMLIFT_TOML_SHA1` and `make` still asks for `romlift generate`. `loadConfig`
  returns the SHA-1 of the bytes it decoded (`ProjectConfig.sha1`), which `readProject` passes as `configSha1`; the
  second read of `romlift.toml`, and its absolute-path diagnostic, are gone. The scaffold render test builds the
  stamp's spelling from `CONFIG_SHA1_VARIABLE` and writes `modules.mk` with `modulesMkText`, so a renamed constant fails
  it. `applyWrites`' check before an edit reads through the disk snapshot's own `digestOf`, one absence rule (ENOENT
  and ENOTDIR) for both; typing the snapshot as a closed union is carried to phase 6. A pull that changes the romlift
  version `package.json` pins is not noticed by `make` or `setup.sh`: the scaffold's `AGENTS.md` and `README.md` say to
  run `./setup.sh` and then `npx romlift generate`, a known limitation; recording the version in `modules.mk` is
  carried to phase 6, with publication (Q5).
- (e) **Overrides and alignment** (architecture-b2-6, b2-8). `PlacedEntry.override` is the analysis options' override
  object `placeEntries` applied, and `W_OVERRIDE_IGNORED` matches each applied override to one `[[overrides]]` entry of
  its kind, span and mode, so a data override, or a second code override, on the span of an applied one is reported.
  `insnAligned`'s docstring names its two readers (the assembler layout and the config); routing the analysis' own
  bit tests through it is carried to phase 6, and `test/unit/rom/span.test.ts` tests `insnUnit` and `insnAligned`.
  This amends D82 d's "read by … `seed.ram-copy`" (it reads `insnUnit`).
- (f) **Edits and records** (architecture-b2-10, b2-9, gate-honesty-b2-1). `TextEdit.reason` is `'add-stub' |
  'remove-stub' | 'add-header'`, the include insertion's own reason; `'move-stub'` and `'rename'` are gone until phase
  6's renames produce theirs (a joined insertion at one offset keeps its first reason). The split of
  `include-asm.ts` (architecture-b2-9) is carried to phase 6 with `rename-tokens.ts`. The memory limitation is
  rewritten from every measured run, the review's re-run of fix round 6's list included: `generate --json` at
  1,541.8 MiB joins the forms over D72 b's budget, so neither one-shot command is held under it on the doubled ROM.

**Consequences.** New tests: the planner (a fragment's stubs held, nested fragments, `E_C_FRAGMENT_STUB` for a renamed
stub and a stale directory, `E_C_STUB_UNPLACED` inside a fragment for stubs and for definitions, insertions beside a
fragment, an unscannable fragment, an include of another module's source, the header's reason), `reconcileStubs`
(nested fragment, `E_C_FRAGMENT_STUB`), the CLI (a stub moved into `src/part.c`, `generate` keep-only; a TOML rename
refused naming the fragment, nothing written; the fragment fixed by hand, exit 0; a `decomp.yaml` naming
`cfg/romlift.toml` refused by `generate`, `analyze --update` and `model`, nothing written), `readDecompYaml` and
`loadConfig` (the refusal, the SHA-1 of the bytes), the write plan (`modules.mk` last), the model (the same-span
override cases), span.ts, and `test/local/decompiled-c.test.ts` on klonoa with agbcc: three stubs moved into a
fragment, `generate` and `make` to the SHA-1, the middle one renamed in the TOML (`E_C_FRAGMENT_STUB` and
`E_C_STUB_UNPLACED`, nothing written, `make` stopping on the stale tree), fixed in the fragment, `generate` and `make`
to the SHA-1; then `decomp.yaml` naming `cfg/romlift.toml`, `generate` refused and `make` to the SHA-1. The closing
list is re-run in a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 7).

## D84. Fix round 8 of phase 4: the review of fix round 7

**Context.** The review of fix round 7's closing run at `8b03b1f` (round c0) raised nine findings: one major
(correctness-c0-1) and eight minors (corrected from "eight findings … seven minors" by D85 e; gate-honesty-c0-1 and
correctness-c0-2 are one defect of the memory limitation, its count of forms, raised under two lenses). correctness-c0-1 was reproduced on klonoa: with a module's last `INCLUDE_ASM`
lines moved into a `src/tail.c` its file `#include`s, a split that names the new module `tail` at the fragment's
first function made `tail.c` that module's source while the old file still included it. `generate` exited 0 with no
diagnostic, since D83 a refused an include of another module's source only when the file needed an insertion; `make`
then compiled the fragment's chunks twice (in both objects) and the ROM was 2,724 bytes too large, and before that
`tail.c` lacked the header that had come from the including file. Fix round 7 recorded architecture-b2-5 as fixed;
only its insertion half was. Each fix is the simplest rule that cannot break a user's build, with a test that
reproduces the reviewer's case and then runs `make`. No gate changes what it requires.

**Decision.**

- (a) **An include of another module's source is always refused** (correctness-c0-1). `planIncludeAsm` raises
  `E_C_MODULE_INCLUDED` (new, error, `core/reconcile`) for every file-scope `#include` of another module's source, in
  the module's file or in a fragment it includes, whether or not the file needs an edit, naming the including file,
  the line and the module, and saying make compiles that source on its own; `generate` writes nothing. The unread
  includes that are no module's source keep D82 b's rule (they refuse only the insertions they might duplicate, with
  `E_C_STUB_UNPLACED`). A file that `#include`s itself is no refusal. A file whose every `INCLUDE_ASM` statement the
  plan removes, and that has no `#include` or `#define` that could define the macro, gains `#include "include_asm.h"`
  with its new stubs: a fragment made a module's source, whose stubs served another directory under the including
  file's header. A file that keeps a stub, or has such a directive, is left as D82 b left it. This corrects D83 a's
  last sentence and the phase-4.md row of architecture-b2-5. (D85 a replaces "or has such a directive": a fragment
  with an `#include` of its own, a `global.h` for its types, was left without the header and its new stubs did not
  compile; such a file now gains the header unless it includes `include_asm.h` itself or `#define`s `INCLUDE_ASM`.)
- (b) **A nested fragment is named through its chain** (correctness-c0-3). A fragment's statements and definitions
  carry `chain`, the `#include` lines that reach them from the module's file, and every message about one
  (`E_C_FRAGMENT_STUB`, `E_C_STUB_UNPLACED` inside a fragment, `E_C_STALE_DEFINITION`, `E_C_DEFINITION_MOVED`,
  `W_C_UNSCANNABLE`, `E_C_UNSCANNABLE`, `W_C_ORDER`, `E_C_MODULE_INCLUDED`) names it as `src/b.c, which src/a.c
  includes (line 3), which src/main.c includes (line 68)` (`fragmentPhrase`).
- (c) **W_C_ORDER reads a fragment's order** (architecture-c0-3). A fragment's items carry `order`, the offsets of
  the `#include` lines that reach them and then their own offset, and the warning compares the held chunks by it, so
  stubs out of ROM order inside one fragment, or across a nested one, warn naming the fragment. This replaces D83 a's
  "two chunks one `#include` holds raise no `W_C_ORDER`". (Across a nested fragment the message named neither file
  until D85 c.)
- (d) **An unscannable fragment's verdict follows what the file needs** (architecture-c0-1). The fragment is
  `E_C_UNSCANNABLE` when the module's file needs an edit: one planned, one refused (a stub left unplaced), its own
  `E_C_UNSCANNABLE`, or a stub that must go from a fragment or a conditional; otherwise `W_C_UNSCANNABLE`, whose text
  now says the file "needs no INCLUDE_ASM line changed". This amends D83 a, which decided on "an edit was planned".
- (e) **Fragments are read directly under `src/` only; records** (architecture-c0-2, c0-4, gate-honesty-c0-1,
  correctness-c0-2). The shell reads only the `src/*.c` directly under `src/` (`readCTexts`), as before; the tests
  that put a nested fragment under a subdirectory now use top-level paths, a CLI test asserts the refusal of a
  subdirectory include, and `E_C_STUB_UNPLACED`'s advice, the scaffold's `AGENTS.md` and architecture §6.6 say
  "directly under `src/`". Reading `src/**/*.c` was not chosen: it would make every file of a subdirectory that no
  module includes a `W_C_FILE_UNUSED`. `src/foundation/index.md`, architecture §2 and roadmap.md no longer say the
  project-files spellings are never re-exported: the internal layers import them from `project-files.ts`, the public
  `api/` modules re-export some, and the aliases of architecture-r1-2 stay carried to phase 6. The memory limitation
  counts its five forms.
- (f) **The PoC's scaffold directory is per run** (architecture-c0-5). `export-poc` gives each PoC child a fresh
  temporary directory as its working directory and `TMPDIR` (removed when the child exits), so the PoC's
  `os.tmpdir()/romlift-bench/<name>` is no longer shared by two runs on one machine. The closing procedure still
  requires an idle machine for the timed gates (phase-4.md).

**Consequences.** New tests: the planner (`E_C_MODULE_INCLUDED` with and without an edit, from a fragment, no refusal
for a file without such an include; the header for a file whose every stub is replaced, not with an `#include`; a
nested fragment's `E_C_FRAGMENT_STUB` message and a definition's chain; `W_C_ORDER` inside a fragment, across a nested
one and outside it; the unscannable fragment's two probe cases), the CLI (the reviewer's split named after a fragment
on the composite fixture, refused and nothing written, then the `#include` removed and the new module's file with the
header and its stubs; a fragment in `src/inner/` refused with the "directly under `src/`" advice, then moved and kept),
`reconcileStubs` (the nested fragment at a top-level path), and `test/local/decompiled-c.test.ts` on klonoa with agbcc
(step 9: boot's last stubs moved into `src/tail.c`, kept and built; the split named `tail` refused with
`E_C_MODULE_INCLUDED`, nothing written; the `#include` removed, `generate` and `make` to the SHA-1). The closing list is
re-run in a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 8).

## D85. Fix round 9 of phase 4: the review of fix round 8

**Context.** The review of fix round 8's closing run at `1392483` (round c1) raised twelve findings: two majors
(correctness-c1-1 and architecture-c1-1, one defect raised under two lenses) and ten minors. The majors were reproduced
on klonoa and on the composite fixture: a `src/*.c` fragment made a module's source by D84 a's flow, whose file had any
`#include` or `#define` of its own (a `types.h` or `global.h` for its types, as decompiled C has), lost its stubs'
header. D84 a took any such directive for one that might define `INCLUDE_ASM`, so `generate` exited 0 with no
diagnostic and wrote the new module's stubs without `#include "include_asm.h"`; `make` failed with a syntax error at
each `INCLUDE_ASM` line. Each fix is the simplest rule that cannot break a user's build, with a test that reproduces
the reviewer's case and then runs `make`. No gate changes what it requires.

**Decision.**

- (a) **A file whose every stub is replaced gains the header unless it provides the macro itself**
  (correctness-c1-1, architecture-c1-1). `headerInsertion` adds `#include "include_asm.h"` to a file that gains a stub
  and keeps no `INCLUDE_ASM` statement of its own unless the file itself includes `include_asm.h` or `#define`s
  `INCLUDE_ASM`; another `#include` or `#define` no longer stops it. The generated header is guarded
  (`GUARD_INCLUDE_ASM_H`), so a second include through a `global.h` that includes `include_asm.h` is harmless; it is
  not harmless through a `global.h` that defines `INCLUDE_ASM` and includes `macros.inc` itself, under its own guard,
  where the second `macros.inc` breaks the assembler (corrected by D86 a, which decides from what defines the macro;
  this sentence first called every second include harmless, and the rule also reached a renamed module's source moved
  with `git mv`, correctness-c2-1, architecture-c2-1). This replaces D84 a's "or has such a directive". The scaffold's
  `AGENTS.md` says the new module's file gains the header unless it includes it itself.
- (b) **An include of a module's source is refused even under a conditional** (correctness-c1-2): recorded, not
  changed. `E_C_MODULE_INCLUDED` reads every file-scope quoted include, `#if 0` included; the refusal writes nothing and
  names the line, and removing a dead line is the fix. Downgrading a conditional one to a warning would let a taken
  `#ifdef` build a module's functions twice. A known limitation (phase-4.md), and the scaffold's `AGENTS.md` says
  "even under `#if 0`".
- (c) **W_C_ORDER names both files across nested fragments** (correctness-c1-3). Two chunks out of order in
  different files of the include chain give `<file> holds X before Y, which comes first in ROM order, through its
  includes: X is in <file or fragment chain>; Y is in <…>`, with the path of X's fragment; one fragment keeps D84 c's
  message.
- (d) **The planner's public contract** (architecture-c1-3). `IncludeAsmWanted.sources` is documented as read only
  while includes are followed, with `path` and `fragments` both given (an empty `fragments` checks the includes
  alone), and as covering an include under a conditional; `CIncludeLink` is exported from `api/reconcile.ts`. The
  product path (`c-stubs.ts`) always passes both.
- (e) **Records** (gate-honesty-c1-1, c1-2, correctness-c1-4, architecture-c1-2, c1-4, c1-5).
  `core/config/decomp-yaml.ts` no longer re-exports `DECOMP_YAML_FILE` and `ROMLIFT_CONFIG_FILE`: `shell/config/save.ts`,
  `shell/project/write-project.ts` and the decomp-yaml unit test import them from `project-files.ts`, and
  `api/config.ts` re-exports them from there, so D84 e's sentence (the internal layers import the spellings from
  `project-files.ts`) holds; `src/foundation/index.md` and architecture §2 name `api/config.ts` among the public
  re-exports, and roadmap.md's architecture-r1-2 no longer lists the decomp-yaml re-export. D84's Context counts nine
  findings. The memory limitation no longer states a closed range: the peaks vary from run to run by about 60 MiB on
  one machine, and it gives the largest measured (1,596.5 MiB, the readable `verify --assemble`, in the review's
  re-run of fix round 8's list). roadmap.md's architecture-b2-9 gives `include-asm.ts`'s size and adds the
  include-resolution helpers to the phase-6 split.

**Consequences.** New tests: the planner (the header for a replaced file with `#include "global.h"` or `#define UNUSED
1`, none with `#include "include_asm.h"` or `#define INCLUDE_ASM`; the nested `W_C_ORDER` message and the one across a
fragment and the module's file; an include of a module's source under `#if 0` refused; `sources` without `fragments`
not followed), the CLI (the fragment made a module with an `#include "global.h"`, then a `#define UNUSED 1`, prelude:
refused, then the header and its stubs, idempotent), and `test/local/decompiled-c.test.ts` step 9 on klonoa with agbcc,
run twice, the second time with `src/tail.c` starting with `#include "types.h"`, each through `make` to the SHA-1. The
closing list is re-run in a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 9).

## D86. Fix round 10 of phase 4: the review of fix round 9

**Context.** The review of fix round 9's closing run at `5e73637` (round c2) raised six findings: one major
(correctness-c2-1) and five minors. The major was reproduced by the reviewer on klonoa: D85 a's `headerInsertion` adds
`#include "include_asm.h"` to every file whose stubs are all replaced and that does not include that header by name or
`#define` `INCLUDE_ASM` itself. A `c` module renamed with `git mv`, as the scaffold's `AGENTS.md` describes, whose file
gets `INCLUDE_ASM` from the user's own `include/global.h` (which defines the macro and includes `macros.inc` under its
own guard, as `include_asm.h` does), gained the header; `generate` exited 0 with no diagnostic, and `make` failed in
the assembler (`include/macros.inc:26: Error: Macro 'thumb_func_start_local' was already defined`). Fix round 8's code
built the same tree. architecture-c2-1 is the same rule seen as a scope defect: it fires on a module rename, not only
on the fragment made a module it was written for. No gate changes what it requires.

**Decision.**

- (a) **Whether a file needs the header is decided from what defines the macro** (correctness-c2-1, architecture-c2-1).
  A file that gains a stub and keeps no `INCLUDE_ASM` statement of its own gains `#include "include_asm.h"` only when
  neither the file itself nor any header it reaches defines the macro: the planner follows the file's quoted includes
  that resolve under `include/` (as the Makefile's `cpp -I include` finds them: from a header, its own directory
  first, then `include/`), transitively and each header once, so a cycle ends, and adds nothing when one of them
  `#define`s `INCLUDE_ASM` or includes `include_asm.h`. The shell reads every file under `include/`
  (`readHeaderTexts`, `ProjectInputs.headerTexts`, `IncludeAsmWanted.headers`; `reconcileStubs` takes them as a fourth
  argument). An include that resolves to no file read (above `include/`, a `src/*.h`, an angle include) defines
  nothing as far as the planner knows. So the reviewer's rename keeps its `global.h` alone, and fix round 9's fragment
  made a module whose `types.h` only declares types still gains the header (D85 a holds for it). The fragment-only
  narrowing (the review's second option) was not taken: a renamed module whose `global.h` only declares types, and
  whose stubs `include_asm.h` served through a line the rename does not remove, is no different from that fragment.
  D85 a's "harmless" sentence, architecture §6.6 and the scaffold's `AGENTS.md` (the fragment paragraph and the rename
  paragraph) say so.
- (b) **Records** (gate-honesty-c2-1, correctness-c2-2, architecture-c2-2, architecture-c2-3). Fix round 9's section
  of phase-4.md counts its minors as the table does: eight fixed, one recorded, one nothing new. roadmap.md "Carried
  from phase 4": the a0-10 bullet says `write-project.ts` takes `SCAFFOLD_ROM_FILE` from `core/scaffold/vars.ts` and
  the other two names from `project-files.ts` since fix round 9, and the b2-7/b2-12 bullet lists `api/config.ts`'s
  re-export of `DECOMP_YAML_FILE` and `ROMLIFT_CONFIG_FILE`.

**Consequences.** New tests: the planner (the reviewer's rename with a `global.h` that defines the macro, directly,
through a nested header from its own directory and from `include/`, and through `include_asm.h` by name: no header; a
`global.h` of types alone, a cycle of headers none of which defines it, an include that resolves above `include/`, and
no headers given: the header; fix round 9's fragment with `types.h`: the header), the CLI (a `c` module renamed with its
source moved, whose `global.h` reaches a nested header that defines the macro: no header, idempotent; the same header
of types alone: the header), and `test/local/decompiled-c.test.ts` step 10 on klonoa with agbcc (the reviewer's flow:
`include/global.h` defining the macro and including `macros.inc`, `src/boot.c` including it, `make` to the SHA-1;
module boot renamed boot2 and `git mv src/boot.c src/boot2.c`; `generate` exit 0 with no diagnostic and no header added;
`make` to the SHA-1), with steps 5 and 9 (fix rounds 6, 8 and 9's cases) still building. The closing list is re-run in
a fresh worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 10).

## D87. Fix round 11 of phase 4: the review of fix round 10

**Context.** The review of fix round 10's closing run at `625d710` (round d0) raised six findings: two majors
(correctness-d0-1, architecture-d0-1) and four minors. The two majors are one defect raised under two lenses: D86 a's
`macroProvided` followed only the module file's own quoted includes, never those of the `src/*.c` fragments the file
`#include`s, though the planner reads those fragments (D83 a). A `c` module renamed with `git mv`, whose
`src/<module>.c` starts with `#include "part.c"` and whose `part.c` includes a `global.h` that defines `INCLUDE_ASM`
and includes `macros.inc`, gained `#include "include_asm.h"`; `generate` exited 0 with no diagnostic and `make` failed
in the assembler (`include/macros.inc:1: Error: Macro 'arm_func_start' was already defined`), where fix round 8's
code built the same tree. Three minors (gate-honesty-d0-1, correctness-d0-2, architecture-d0-2) are one record defect
under three lenses: an angle include of a header under `include/` (`#include <global.h>`, which the scaffold's `cpp
-nostdinc -I include` resolves there) was not followed, with the same failure, and phase-4.md said the scaffold's
`AGENTS.md` stated that limitation when it did not. The fourth minor (architecture-d0-3) is the shell reader
`readHeaderTexts`: a second directory walker that followed symbolic links, untested. No gate changes what it requires.

**Decision.**

- (a) **The fragments' includes are followed** (correctness-d0-1, architecture-d0-1). `macroProvided` starts from the
  module's file and every fragment `withFragments` read for it (`included`, transitively, each once): a fragment that
  `#define`s `INCLUDE_ASM` or includes `include_asm.h` provides the macro, and its includes are followed into the
  headers like the file's own. `planScanned` passes `included` to `headerInsertion`.
- (b) **Includes resolve as the scaffold's cpp resolves them** (correctness-d0-2, architecture-d0-2, gate-honesty-d0-1),
  the findings' code option rather than a recorded limitation: `#include "…"` from the including file's own directory
  first, then from `include/`; `#include <…>` from `include/` alone (`includeSpelling`, `headerPath`). The shell reads
  every `.h` under `src/` beside every file under `include/`, so a quoted `src/local.h` that defines the macro, or a
  `src/global.h` that shadows `include/global.h`, is read as cpp reads it. What stays unevaluated is an `#if` around an
  `#include`, an `#include` spelled with a macro and an include directory the user adds to `CPPFLAGS`; the scaffold's
  `AGENTS.md` says so, with the consequence (`make` stops in the assembler on a second `macros.inc`) and the remedy
  (delete the added line; romlift adds it only to a file with no `INCLUDE_ASM` line left of its own). phase-4.md's
  limitation sentence is replaced by that one; D86 a's "a `src/*.h`, an angle include" exception no longer holds.
- (c) **One directory walker** (architecture-d0-3). `readHeaderTexts` lists `include/` and `src/` with disk-state's
  `filesUnder`, now exported, which uses `lstat` and never follows a symbolic link into a directory: a link to a file is
  read as that file, a link to a directory or a dangling link is left out, so a link cycle ends. HEADER_DEPTH is gone.
  Unit tests: no `include/` or `src/` gives an empty map; nested files keyed by project path, only `.h` under `src/`;
  two links to `.` end, a link to a file is read; an unlistable directory or unreadable header is `E_IO_READ`;
  `readProject` passes `headerTexts`, and none with `withoutC`; `reconcileStubs`' fourth argument and the fragments
  (`c-stubs.test.ts`). `src/shell/index.md` names the headers among what read-inputs reads.
  **Replaced by D88 a and b** (fix round 12): the `lstat` walk read nothing behind a symbolic link to a directory, a
  regression against fix round 10 that broke the build of a module renamed with `git mv`; `readHeaderTexts` follows
  such a link, a cycle ending by real path (not exactly as cpp does: the layouts of D89 a and D90 a), and the shell
  keeps two link policies, each named.

**Consequences.** New tests: the planner (the reviewers' fragment flow, two fragments deep, an angle include in the
fragment, a fragment defining the macro or including `include_asm.h`: no header; a fragment whose `global.h` declares
types: the header; `#include <global.h>` directly and nested, `<include_asm.h>`: no header; an angle include never finds
`src/global.h`; a quoted include finds `src/local.h`, and `src/global.h` before `include/global.h`), the CLI (a `c`
module renamed with its source moved, for each of the three layouts: no header, no diagnostic, idempotent), and
`test/local/decompiled-c.test.ts` step 11 on klonoa with agbcc (the three layouts in turn, each built to the SHA-1, then
the module renamed with `git mv`: `generate` exit 0, no diagnostic, no header, `make` to the SHA-1; at `625d710`'s code
the step fails at "fragment: the stubs renamed, no header added"). The closing list is re-run in a fresh worktree with
`landed` 4 (phase-4.md, "The closing gate", fix round 11).

## D88. Fix round 12 of phase 4: the review of fix round 11

**Context.** The review of fix round 11's closing run at `9085564` (round d1) raised six findings: three majors
(gate-honesty-d1-1, correctness-d1-1, architecture-d1-1) and three minors. The three majors are one defect raised under
three lenses: D87 c made `readHeaderTexts` list `include/` and `src/` with disk-state's `lstat` walk, which never
follows a symbolic link into a directory. The headers behind a linked `include/` (listed as the bare entry `include`,
then dropped by the `include/` prefix filter), a linked subdirectory such as `include/gba -> ../shared/gba`, or a
linked directory under `src/` were no longer read, though the scaffold's `cpp -nostdinc -I include` follows those
links. A `c` module renamed with `git mv` whose defining `global.h` sat behind such a link gained
`#include "include_asm.h"`; `generate` exited 0 with no diagnostic and `make` stopped in the assembler
(`include/macros.inc:1: Error: Macro 'arm_func_start' was already defined`), where fix round 10's code (`625d710`)
built the same tree to the SHA-1. Only D87 c named the mechanism, and the read-inputs test asserted it as intended. The
minors: phase-4.md's summary header still ended at D86 and fix round 10's run (gate-honesty-d1-2); the records said
the shell has one walker with one link policy, while `readChunkFiles` and `readCTexts` follow links through `stat`
(architecture-d1-2); and the rule "a `.h` is a header" was written in the shell and in core with no shared definition
(architecture-d1-3). No gate changes what it requires.

**Decision.**

- (a) **`readHeaderTexts` follows a symbolic link to a directory** (gate-honesty-d1-1, correctness-d1-1,
  architecture-d1-1), the findings' code option, not the recorded limitation, since the limitation would keep a
  regression against fix round 10. disk-state's `filesUnder` takes `{ followLinks: true }`: it walks with `stat`, so a
  link to a directory, `include/` or `src/` itself among them, is walked under its own project path (`include/gba/
  macro.h`, as `#include "gba/macro.h"` names it), and a link to a file is read as that file. A cycle ends by real path
  (`realpath`), not by a depth bound: a directory whose real path is the project directory's or that of a directory
  the walk is already inside is not entered, as `find -L` ends one, so two links to `.`, a link to `..` and
  `include -> .` all end, while a second, non-cyclic path to a directory (`include/alias -> real`) is listed under both
  spellings, as cpp finds both. A dangling link or a link loop (ENOENT, ENOTDIR, ELOOP) is left out.
  **Amended by D89 a** (fix round 13): this is not exactly as cpp follows links, and the records no longer say "like
  cpp". A `..` in an include, in a header reached through a linked directory, is resolved against the link's path, not
  its target (the planner's `resolveInclude` normalizes it lexically), and a link whose target is the project
  directory, or a directory the walk is already inside (one of the link's own parent directories), is not entered
  (`include -> .` reads nothing, while cpp reads the files there); D90 a corrected this sentence, which fix round 13
  wrote as "a link back to the project or to a directory already walked", and added the third layout, a link to a
  directory above the project, which is entered and read in full. When the
  header that defines `INCLUDE_ASM` lies behind either layout, a `c` module renamed with `git mv` gains
  `#include "include_asm.h"`, `generate` exits 0 and `make` stops in the assembler; the remedy is deleting the added
  line, as for the unevaluated forms of D87 b. A cpp-exact resolution is carried to phase 6.
- (b) **Two link policies, each named** (architecture-d1-2), the finding's second option. `filesUnder` is the
  recursive walker of the disk snapshot and of `readHeaderTexts`; the snapshot keeps `lstat` (a link is one entry,
  hashed through to its target), since it lists what romlift wrote, and `readHeaderTexts` follows links, since it
  reads what cpp reads. `readCTexts` (`src/*.c`, one level) and `readChunkFiles` (`asm/nonmatchings/<module>/`, two
  levels) keep their `stat`-based fixed-depth listing, which follows a link as make and cpp do; so every reader of the
  build's inputs follows links, and only the snapshot does not. The comment in `disk-state.ts`, D87 c and phase-4.md
  say so; nothing is carried.
- (c) **One header predicate** (architecture-d1-3). `isHeaderPath` in `foundation/util/project-files.ts`, beside
  `isCSource`, is the rule both sites use: the shell's `src/*.h` listing and the reconciler's choice not to report an
  unread quoted `.h` include as an unread `src/*.c` fragment (`core/reconcile/include-asm.ts`).
- (d) **Records** (gate-honesty-d1-2). phase-4.md's scope line runs to D88, and its Verdict paragraph has fix round 11's
  run at `b42513e`. Corrected by D89 b: fix round 12's own closing run was interrupted during `npm test` and never
  finished, so no run of fix round 12 is recorded; fix round 13's closing run, at its records commit, is the run that
  covers fix round 12's code.

**Consequences.** New tests: read-inputs (a linked `include/gba` outside the project, a second path `include/alias ->
real`, a linked `src/sub`, a link to a file: read; two links to `.`, a link to `..`, a dangling link and a link loop:
ended or left out; `include/` and `src/` themselves links outside the project: read; `include -> .`: nothing; fix
round 11's test of the opposite policy is replaced), `isHeaderPath` (`paths.test.ts`), the CLI (a `c` module renamed
with its source moved, whose defining header is behind a linked `include/` or a linked `include/gba`: no header, no
diagnostic, idempotent; at `9085564`'s code it fails), and `test/local/decompiled-c.test.ts` step 12 on klonoa with
agbcc (a linked `include/gba` holding a defining `macro.h` reached through `include/glue.h`, then a linked `include/`;
each built to the SHA-1, then the module renamed with `git mv`: `generate` exit 0, no diagnostic, no header, `make` to
the SHA-1; at `9085564`'s code the step fails at "linked include/gba: the stubs renamed, no header added"). The scaffold's
`AGENTS.md` says romlift follows a symbolic link; architecture §6.6 and phase-4.md's known limitation say it too, with
the two layouts D89 a records. Fix round 12's closing run was interrupted during `npm test` and is not recorded (D89
b); the closing list was run next by fix round 13 (phase-4.md, "The closing gate", fix round 13).

## D89. Fix round 13 of phase 4: the review of fix round 12

**Context.** The review of fix round 12's records at `cc874b0` (round d2) raised six findings, all about records and
none about the product: one major (gate-honesty-d2-1) and five minors. The major and two minors (correctness-d2-2,
architecture-d2-2) are one defect under three lenses: fix round 12's closing run was interrupted during `npm test` and
never finished (its summary ends at `npm test` with no exit line, its log says "Interrupted while running"), yet D88 d
and phase-4.md's fix-round-12 section said the Verdict paragraph had that run and cited "The closing gate" for it,
which had no fix-round-12 section. The other three minors (gate-honesty-d2-2, correctness-d2-1, architecture-d2-1)
are one record defect under three lenses: D88 a and the scaffold's `AGENTS.md` said romlift follows a symbolic link
"like cpp", which two layouts contradict, each ending with `generate` exit 0 and a `make` that stops in the assembler.
The reviewers' own runs of the whole closing list at `cc874b0`, in fresh clones with `landed` 4, exited 0 at every
command. No gate changes what it requires.

**Decision.**

- (a) **The two link layouts are recorded, not changed** (gate-honesty-d2-2, correctness-d2-1, architecture-d2-1),
  the findings' record option. D88 a (amended), the scaffold's `AGENTS.md` (`test/golden/scaffold/scaffold.txt`
  regenerated), architecture §6.6 and phase-4.md's known limitations drop the "like cpp" claim and state that a `..`
  in an include behind a linked directory is resolved against the link's path, not its target, and that a link back
  to the project or to a directory already walked is not entered (corrected by D90 a: a link whose target is the
  project directory or a directory the walk is already inside, one of the link's own parent directories; a second
  path to a directory walked before is entered); the remedy is deleting the added
  `#include "include_asm.h"` line. A cpp-exact resolution (resolving a quoted include from a followed header's real
  directory, and reading through a link to the project or an ancestor) is carried to phase 6 (roadmap.md "Carried
  from phase 4"). No code under `src/` changes; its comments that say links are followed "as cpp does" go with the
  carried item (reworded by D90 b instead, with `src/shell/index.md` and two tests, which this sentence missed).
- (b) **Only runs that exist are cited** (gate-honesty-d2-1, correctness-d2-2, architecture-d2-2). D88 d, D88's
  consequences and phase-4.md's fix-round-12 section say that fix round 12's closing run was interrupted and is not
  recorded. Fix round 13 runs the whole closing list at its records commit in a fresh worktree with `landed` 4, detached
  in its own process group and waited on until every command had an exit line (corrected by D90 c, which fix round 13
  wrote as "in the foreground to its last command"), commits the `bench/results.json` artifact and adds "Fix round 13's
  closing run" and the Verdict sentence.

**Consequences.** Records only: `templates/AGENTS.md` and its golden, `docs/` and `bench/results.json`. The closing
list's result is in phase-4.md, "The closing gate", fix round 13.

## D90. Fix round 14 of phase 4: the review of fix round 13

**Context.** The review of fix round 13's closing run at `b189922` (round e0) raised seven findings: one major
(correctness-e0-1) and six minors. They are three record defects. First (correctness-e0-1, gate-honesty-e0-1,
architecture-e0-2): fix round 13 wrote, in seven places, that "a link back to the project or to a directory already
walked is not entered", while `filesUnder` (`disk-state.ts`) refuses a directory only when its real path is the project
directory's or one on the walk's current path (`inside`, built per branch), so a second, non-cyclic link to a directory
walked before is entered, as D88 a's own sentence and the read-inputs test say; and a link from `include/` or `src/` to
a directory above the project is entered and every file there read as text, a layout no record named. Second
(gate-honesty-e0-2, correctness-e0-2, architecture-e0-1): "as cpp does" survived in `src/shell/index.md`, in D87 c's
replacement note and in two tests, which D89 a's carry did not name. Third (correctness-e0-3, architecture-e0-3): fix
round 13's closing run was started detached in its own process group (`nohup`), not "in the foreground", as its records
said. The reviewers' runs found the run itself complete, every command exit 0. No gate changes what it requires.

**Decision.**

- (a) **The link rule says what the code does** (correctness-e0-1, gate-honesty-e0-1, architecture-e0-2), the findings'
  record option; no behaviour changes. The scaffold's `AGENTS.md` (golden regenerated), architecture §6.6, phase-4.md's
  known limitation, D88 a's amendment, D89 a, the fix-round-13 row and roadmap.md's carried item say: a link whose
  target is the project directory, or a directory the walk is already inside (one of the link's own parent
  directories), is not entered. They add the third layout: a link to a directory above the project is entered, all of
  it but the project directory below it, and every file there is read as text. The tree is not wrong, since a header
  no `#include` names never decides `INCLUDE_ASM`; the cost is the time and memory of reading it, and `E_IO_READ` on an
  unreadable file. Seeding `inside` with the project's ancestors was not chosen: it would stop reading the headers an
  `#include "up/other/x.h"` names through such a link, which cpp reads. A unit test asserts the recorded behaviour
  (`include/up -> ../..` lists the files above the project and none of the project's). The carried item now asks phase 6
  to read, through such links, only the files an `#include` names.
- (b) **"As cpp does" is gone from the records and the code's comments** (gate-honesty-e0-2, correctness-e0-2,
  architecture-e0-1), the findings' reword option rather than a longer carry: `src/shell/index.md`, the comments in
  `disk-state.ts` and `read-inputs.ts`, D87 c's replacement note, the read-inputs test's name and comment and
  `test/local/decompiled-c.test.ts`'s step list say links are followed, not exactly as cpp does (D89 a, D90 a). The
  roadmap's carried item no longer lists comments to fix. Comments only: no code path changes.
- (c) **The run is described as it ran** (correctness-e0-3, architecture-e0-3). phase-4.md's fix-round-13 closing run,
  its gate-honesty-d2-1 row and D89 b say it ran detached in its own process group and was waited on until every
  command had an exit line. Fix round 14's closing run is recorded with how it was launched.

**Consequences.** One new unit test (read-inputs, the link above the project); comments in two `src/shell/project`
files, `src/shell/index.md`, `templates/AGENTS.md` and its golden, `docs/`. The closing list is re-run in a fresh
worktree with `landed` 4 (phase-4.md, "The closing gate", fix round 14).

## D91. The owner's decision of 20 October 2026: the gba-kit trace is dropped

**Context.** The plan's gba-kit evaluation (plan.md, "gba-kit evaluation") proposed an optional `romlift trace` command
with `@gba-kit/gba-node` as an optional peer dependency, a trace file read as one more evidence source, the tracing code
moved into gba-kit as a supported API, and roadmap 6.C built it with `g6.ram-code-mapped` and `g6.evidence-conflict`
reading a trace. The evaluation itself measured how little a trace reaches: 5.6% of Klonoa's code region in 600 boot
frames, 8.4% after 440 in-level frames, against 98.8% classified statically in about four seconds. D76 g recorded that
the owner dropped the integration and left the plan's rewrite to phase 6. Bruno Macabeus's words, given on 20 October
2026: **"I think we can skip this part of the plan, since very few functions are called and found by gba-kit"**.

**Decision.**

- (a) **Dropped**: the `romlift trace` command, the optional peer dependency `@gba-kit/gba-node`,
  `src/shell/trace/gba-kit.ts`, `src/foundation/formats/trace-json.ts` (the trace's format) and
  `src/shell/evidence/read-trace.ts` (its reader), the trace fact kinds (`executed`, `returned-call`,
  `indirect-target`, `copied-to-ram`, `data-extent`), and any change in the gba-kit repository (the pull request that
  would have made its tracing code a supported API). None of these files existed in the tree at `89deb54`; only their
  architecture and roadmap entries go.
- (b) **Kept, because none depends on a trace**: code run from RAM through hand-written `[[overrides]]` entries with
  `runs_at` (the non-identity `AddressMap`, the walk's run-space targets, the ldscript's `runs_at` emission with
  `AT(<load>)` and `__load_<module>`, the RAM-copy fixture's expectations; architecture §6.7, D46).
- (c) **`g6.ram-code-mapped` is restated without a trace.** ci: every committed fixture whose `expect.json` has
  `ramCopy` (the override appended by hand after `init`) is mapped and links to its SHA-1, as before. real: on Klonoa the
  range `0x0804F318 -> 0x03000388` is given as an `[[overrides]]` entry with `runs_at` in the bench config
  `bench/overrides/klonoa.json` (`{"schema": 1, "overrides": [{start, size, kind: "code", mode?, runsAt}], "source"}`,
  written by p6-ram-code); the gate appends it after `init`, runs `analyze --update --write`, requires one module
  spanning exactly the range with `runAt` `0x03000388`, its ldscript `AT(...)` and `__load_<module>`, then `./setup.sh`
  and `make` to the dataset's SHA-1. Its `needs` no longer name `parseTrace` or `runTrace`.
- (d) **`g6.evidence-conflict` is restated over the evidence that remains.** With the trace gone and phase 5's legacy,
  ELF and map importers dropped (D92), library signatures are the only external source of proposals, and they can
  contradict the analysis and the config, so the gate stays: a signature proposal that contradicts the analysis (a
  function in the other mode at a found entry) or the config (a listed function in the other mode; a function under a
  `data` override) gives `W_EVIDENCE_CONFLICT` from `checkProposals` and changes nothing, the kept proposals being
  exactly those kept without the contradiction (architecture §7.4, §13; D93 freezes `CheckProposals`).
- (e) **What no producer is left for goes.** With no evidence importer: `core/evidence` (`EvidenceFact`,
  `EvidenceSource`, `mergeEvidence`), `core/legacy`, `shell/evidence`, the `ProposalSource` variants `{kind: 'legacy'}`
  and `{kind: 'evidence', id}` with their `from` spellings `legacy` and `evidence:<id>` (the lead's, D93), and the rule
  `seed.evidence-hint` with its `evidence` origin (p6-analysis-layout's). `W_EVIDENCE_CONFLICT` survives with the
  proposal screen; `W_LEGACY_ENTRY_INSIDE` and `W_LEGACY_ENTRY_REJECTED` go with legacy import (D92). The plan's
  gba-kit evaluation stays in plan.md as the measured reason, with its integration marked dropped by the owner.

**Consequences.** romlift has three runtime dependencies and no optional peer dependency (`g1.runtime-deps`); code run
from RAM needs a hand-written override, which the analysis then honours (the plan's "Phase 6 is where … code run from
RAM stop[s] needing overrides" no longer holds: release 1 keeps the override); the RAM gate proves the mapping, not its
discovery. The word "evidence" keeps its meaning (an external fact, AGENTS.md), and signature proposals are the only
such facts in release 1.

**Rejected.** Keeping a trace importer without the command (a format with no producer). Deleting `g6.evidence-conflict`
(a source that can conflict remains, so the gate has a subject). Proposing `runs_at` from `seed.ram-copy`'s IWRAM
copies (a new rule after the gate's restatement; not asked).

## D92. The owner's decision of 20 October 2026: phase 5 is skipped; rename and objdiff move into phase 6

**Context.** Phase 5 (Migration) planned legacy import, the reconciler and `rename`, the `expected/` and `objdiff.json`
writers, the C data ranges and the Klonoa switch-over (roadmap "Phase 5", D51, D52). D76 g recorded the owner's scope
decision and left its plan to phase 6. Bruno Macabeus's words, given on 20 October 2026: **"We don't need it. Skip phase
5"**, and then, asked what to keep, he chose **"Keep rename and objdiff"**.

**Decision.**

- (a) **Phase 5 never runs and never lands**: there is no `docs/phase-5.md`, no `phase-5` tag, and
  `test/gates/phase.json` goes from `{ "landed": 4 }` to `{ "landed": 6 }` when phase 6 lands. `bench gates --require 6`
  and every path that reads `landed` (provenance, the gate record) work with no phase-5 gate: architecture §1's phase-5
  row lists no gate id and says the phase was skipped, which `test/gates-index.test.ts` accepts for a skipped phase
  only.
- (b) **Dropped**: 5.B legacy import (the luvdis-cfg, ldscript-symbols and thumb-aliases parsers, renames-toml,
  `import-legacy`, read-elf, read-map and read-legacy, `analyze --evidence`, the evidence merge), 5.D the Klonoa
  migration tooling (`bench/migration/`, `bench/src/migration.ts`), 5.I the switch-over pull request. Nothing in the
  Klonoa repository is touched, created or pushed. The gates `g5.evidence-merge`, `g5.import-legacy`,
  `g5.klonoa-rehearsal` and `g5.klonoa-switch` are deleted, with the gate input `klonoa` that only they read. D51 and D52
  are superseded; architecture §12's owner decision 2 (adopting a legacy repository's boundaries) is moot.
- (c) **Moved into phase 6**, as components of its own waves (D93): 5.A the reconciler's move and remove cases and
  `romlift rename` (`g5.reconciler`, `g5.rename` become `g6.reconciler`, `g6.rename`, both ci); 5.C the `expected/` and
  `objdiff.json` writers and the C data ranges, which replace phase 4's C-data assertion for a module that declares a
  range (`g5.expected-bytes`, `g5.c-data-ranges` become `g6.expected-bytes`, ci and real, and `g6.c-data-ranges`, ci,
  whose C object is `build/src/<module>.o`, D74 f); and the part of 5.0 they need, the `[[modules]]` key `data_start`
  (`ModuleConfig.dataStart`).
- (d) **The objdiff gate moves with them.** The gate the owner moved from phase 3 to phase 5 (phase-3.md Q1, "Move gate
  to phase 5", D68 a) is `g6.objdiff` (real) and applies as D34 writes it: on every tuning ROM whose readable build
  links, every agreeing function scores 0 under objdiff-cli but `unnamed-target`. Its baseline is phase-3.md Q1's table,
  the differences the committed classifier counted that D34 gates: fe7j 200, klonoa 320, pokeemerald 13,788, sa2 1,374,
  sa3 564, tmc 895 (`unnamed-target`, reported only: 55, 0, 2,758, 143, 44, 357). The carried minors architecture-r2-2
  (one REL/RELA addend decoder shared with `foundation/formats/elf.ts`, the `R_ARM_*`/`SHT_*` constants in one place) and
  architecture-r2-3 (fixture tests for `objdiffDifferences`' `sectionBase` and `baseField` plumbing) come with it. If the
  gate still fails after phase 6's fix rounds, the phase does not land: the measured counts and the options go to the
  owner (phase-6.md, "Owner questions"); no amendment of D34 is assumed.

**Consequences.** The gate index loses four phase-5 ids and renames five; `g4.cli-contract`'s `rename` recipes apply in
phase 6; `explain`'s signature part, `analyze --update` and `init` read only `sig:<library>@<version>` from `from`
(D91 e); the Klonoa decomp keeps its own tooling. Release 1 has no import path for an existing decomp's function list.

**Rejected.** Renumbering phase 6 as phase 5 (every `g6.*` id, the roadmap and the records cite phase 6). Keeping the
phase-5 gate files as pending (a gate no phase can land is not a gate). Keeping `{kind: 'legacy'}` for a future importer
(nothing ships before its phase).

## D93. Phase-6 component boundaries as executed, and the contracts frozen for them

**Context.** Roadmap 6.0–6.I splits phase 6 into a lead, four parallel components (6.A signature builder and specs, 6.B
matcher and placement rules, 6.C trace and code run from RAM, 6.D proposals plumbing and full explain) and an
integrator. D91 drops the trace half of 6.C, D92 moves phase 5's reconciler, rename, writers, data ranges and objdiff
gate in, and the section "Carried from phase 4" holds the minors phase 4 carried (D76 h to D90). As in phases 1 to 4
(D54, D56, D62, D74), the owner asked for no checkpoints: every owner decision of architecture §12 is taken with its
documented safe default (signature files stay local and gitignored, D40; §12 item 3, a border across a short branch,
stays as built, D15), and any gate change, waiver or limitation the owner has not authorised in his own words is an
owner question in phase-6.md, never assumed.

**Decision.** Phase 6 runs as twelve components in three waves on the branch `phase-6` (cut from `main` at `89deb54`,
`landed` 4), each on its own flat branch and worktree under `romlift-wt/` (the flat `phase-6-<component>` spelling,
because Git cannot hold `phase-6` and `phase-6/<component>` at once; D55 j); roadmap.md "Phase 6", "As executed
(D93)", lists them with what they take, and phase-6.md records their merges.

- (a) **Wave 1**: `p6-lead` (this record, the gates, the contracts below, the documents of D91 and D92; then the
  integration after each wave), `p6-analysis-layout` (the rule `seed.evidence-hint` and its origin deleted, D91 e; the
  analysis's alignment bit tests through `insnAligned`, architecture-b2-8; one owner of the legal-start rule in
  core/layout and the gate oracle over it, architecture-r1-3, a0-4, a1-5; the override semantics of correctness-b0-5;
  `test/gates/g4.toml-mutations.test.ts`), `p6-hygiene` (the carried minors that change no behaviour: architecture-r1-2's
  aliases, r1-4, r1-6 with a2-8, r1-8's remainder, a2-6) and `p6-reconcile-carried` (the C scanner and include resolution
  split out of the planner, architecture-b2-9; the closed union of the disk snapshot, b2-11; r1-7's remaining test moves;
  the shell's walks listing regular files only, gate-honesty-e1-2). **Wave 2**: `p6-signatures-build` (6.A: specs for m4a,
  libagbsyscall, libgcc and the serial libraries, `extractSignatures`, `buildSignatures`, `locateSignatures`, `romlift
  signatures build`, the library fixtures, `bench/tools/convert-poc-signatures.ts`), `p6-c-data-expected` (5.C: the
  `expected` and `objdiff` writers, the C data ranges replacing the ASSERT for a module with `data_start` and its
  semantic checks, the c-data fixture's ranges, the objdiff gate's classifier minors architecture-r2-2 and r2-3),
  `p6-ram-code` (6.C without the trace: the non-identity `AddressMap`, run-space walk targets, the ldscript `runs_at`
  emission, the RAM-copy fixture's `ramCopy`, `bench/overrides/klonoa.json`), `p6-rename` (5.A: `rename-tokens.ts`, the
  move and remove cases, `planRename`, `rename`, the CLI, the matchings split, correctness-r0-5's remainder) and
  `p6-include-links` (the cpp-exact include resolution behind a symbolic link through
  `ProjectInputs.headerRealPaths`, D89 a, D90 a, gate-honesty-e1-1). **Wave 3**: `p6-signatures-match` (6.B: the five
  placement rules, `matchSignatures`, `resolvePlacements`, `proposeFromSignatures`, `romlift signatures <rom>`,
  `bench signatures` with its judged, held-out and leave-one-out runs), `p6-proposals` (6.D: `checkProposals`, the
  signature proposals of `init` and `analyze --update`, `init --no-signatures`, the `LibraryRegion` wiring into module
  inference, explain's signature part and its `sig/` goldens) and a twelfth component whose name and files the
  integrator records at its merge (phase-6.md). The waves of the wave-2 and wave-3 components are as planned when
  wave 1 started; a component that moves is recorded at its merge.
- (b) **The frozen signature contract** (`core/signatures/schema.ts`, `spec.ts`; plain readonly data, D19):
  ``MemberId = `${string}@${string}.o` ``; `SignatureRuleId = 'sig.unique-fit' | 'sig.link-order-run' |
  'sig.neighbour-spacing' | 'sig.pinned-both-sides' | 'sig.short-member-window'` (`SIGNATURE_RULE_IDS` in strength
  order); `SignatureReference {dataset, commit, romSha1}`; `LinkOrderMember {id, addr}` (the member's address in that
  reference, which fixes the spacing); `SignatureFunction {id, name, mode, size, bytes, mask}` and `SignatureTable {id,
  name, size, bytes, mask, names?}` (lower-case hex, two digits per byte; `names` one entry per whole aligned word, a
  `MemberId` or null); `LibraryVersion {id, idNote, references, linkOrder: {reference, members}[], functions, tables}`;
  `SignatureFile {schema: 3, library, builtWith, versions}`; `SignaturePlacement {library, version, member, name, kind:
  'function' | 'table', addr, size, mode?, rule, constants?: {offset, reference, rom}[]}`; `SignatureSpec {library,
  versions: {id, idNote, references: {dataset, objects, tables?}[]}[], reviewedNames: Record<MemberId, {name,
  reason}>}`. `parseSignatureFile(json)` and `parseSignatureSpec(json)` return `{ok: true, value} | {ok: false, error}`,
  validate by hand (core/signatures may not import zod), refuse unknown keys and never throw. Architecture §7.1 wrote a
  reference as `{project, commit, romSha1}` and a link-order member as a bare `MemberId`; the dataset name (the spec's
  word) and the member's address (which the spacing rules read) replace them.
- (c) **The empty registries and codes.** `core/signatures/rules/index.ts` exports `SIGNATURE_RULES: Readonly<Record<string,
  RuleMeta>> = {}` (to p6-signatures-match); `core/signatures/codes.ts` exports `SignatureCodes = defineCodes({})`, in
  the `core/diagnostic-codes.ts` union (to p6-signatures-build, then p6-signatures-match).
- (d) **Proposals** (`core/proposals/types.ts`): `ProposalSource` is `signature | analysis | layout`; `sourceKey`
  spells `sig:<library>@<version>` or undefined (D91 e). The config, patch and workflow tests that used the dropped
  sources use a signature source instead.
- (e) **Config**: the `[[modules]]` key `data_start` (`ModuleConfig.dataStart?: Addr`), TOML spelling `data_start` in
  the parser's key table and its message spelling, serialised right after `kind`; syntax only (its semantic checks are
  p6-c-data-expected's); the canonical goldens carry a case.
- (f) **Workflow types** (`core/workflow/types.ts`): `InitOptions.signatures?: boolean` (false = `--no-signatures`);
  `InitInputs.signatureFiles?` and `AnalyzeUpdateInputs.signatureFiles?: readonly SignatureFile[]`;
  `ProjectInputs.headerRealPaths?: ReadonlyMap<string, string>` (a header's project spelling to its real path, for
  p6-include-links); `CheckProposalsContext {analysis: AnalysisResult; config?: RomliftConfig}`, `ProposalCheck {kept:
  readonly Proposal[]; conflicts: readonly Diagnostic[]}`, `type CheckProposals = (proposals, cx) => ProposalCheck`.
  `core/workflow/explain.ts`: `ExplainSignature {library, version, name, rule?: SignatureRuleId}` and `signature?` on
  `ExplainReport` (the type only; p6-proposals fills it).
- (g) **Barrels and command lists.** `src/api/signatures-types.ts` (`romlift`: the frozen types, the two validators,
  `isMemberId`, `SIGNATURE_RULE_IDS`, `SignatureCodes`, the CheckProposals and ExplainSignature types),
  `src/api/internal-signatures.ts` (`romlift/internal`: `SIGNATURE_RULES`); empty: `src/api/signatures-build.ts`
  (`romlift`) and `signatures-files.ts` (`romlift/node`) to p6-signatures-build, `signatures-match.ts` (`romlift`) to
  p6-signatures-match, `rename.ts` (`romlift`) and `rename-files.ts` (`romlift/node`) to p6-rename, `proposals.ts`
  (`romlift`) to p6-proposals; `cli/commands/lists/signatures.ts` (one command, `signatures build <spec>` and
  `signatures <rom>`) to p6-signatures-build, `lists/rename.ts` to p6-rename. The edge table of `test/helpers/architecture.ts`
  drops the `core/evidence`, `core/legacy` and `shell/trace` rows (architecture §2).
- (h) **The gates.** The g6 files' expected interfaces and `needs` name these contracts; `g6.ram-code-mapped` and
  `g6.evidence-conflict` as D91 c, d; `g6.signatures-judged` compares names through the placement member's symbol (the
  `MemberId` before '@'), reports reviewed display names without gating them, takes its floors from
  `bench/baseline/poc-2026-10-16.json` for the five PoC ROMs and judges tmc by the ELF checks with no floor;
  `g6.signatures-rebuild` builds with `romlift signatures build <spec> --out <dir> --json` and compares every field but
  `builtWith`; `g6.explain-coverage` also requires `SIGNATURE_RULES` to hold exactly `SIGNATURE_RULE_IDS` (stricter:
  it loosens nothing); `g4.cli-contract` gains the `signatures` and `rename` recipes and `init --no-signatures`, each run
  once its command or option is registered.
- (i) **The exit loop's build command.** Roadmap 6's exit list built the signature files with `npx romlift signatures
  build`; romlift is not published (D76 d), and npx would query the registry, so the closing list runs `node
  --conditions=source src/cli/main.ts signatures build "$s"` instead.
- (j) **Integration** (the lead after each wave): merge the wave's components in listed order, typecheck, `npm test`,
  `npm run bench -- gates --require 4 --tier ci`; after wave 2, `UPDATE_GOLDEN=1` only for the library fixtures and the
  `expected`/`objdiff` writers, every diff reviewed; after wave 3, build the signature files, raise `phase.json` to
  `{ "landed": 6 }` in its own commit, run the closing list (real tier before ci) in a fresh worktree, commit
  `bench/results.json` as the run's artifact. A gate that still fails after the fix rounds is recorded with measured
  numbers as an owner question, and the phase is not merged; a CI job GitHub refuses to start is not a pass.

**Consequences.** Every wave-2 and wave-3 component codes against frozen types and owns files no other component of its
wave touches; the g6 gates stay `pending` or `fail` until their exports and writers land, and no g5 gate exists.

**Rejected.** Freezing the matcher's internal shapes (candidate, fit) now: they are p6-signatures-match's. A zod schema for
signature files (forbidden in core/signatures). Keeping the `phase-6/<component>` branch spelling (Git refuses it beside
`phase-6`).

## D94. Phase-6 closing round: four matcher refinements, and leave-one-out counted by counterpart

**Context.** The wave-3 integration recorded that `g6.signatures-judged` and `g6.signatures-loo` fail on the real tier
(phase-6.md Q7). Measured at the closing round (`bench signatures`, `bench signatures --loo`, the built files of the six
specs): on pokeemerald eight 20-byte librfu wrappers that differ only in a masked pool word were all placed at
`0x082E4A00` by `sig.link-order-run`, each "run" reaching `rfu_CB_pollConnectParent` by skipping the links between them
inside `librfu_rfu.o`, and the resolver kept `rfu_REQ_RFUStatus` there (`rfu_REQ_pollConnectParent` in the ELF); on sa2
`Mod.o` (6 bytes) ends off a word and the next object starts on the next word, so sa2's own chain broke there and Fire
Emblem 7's `DivRem@gba-syscall.o` (8 bytes, its padding counted) took the address; on sa2 and sa3 `sSetupInfos` (agb_flash,
every byte masked, no word naming a function) was placed by spacing alone inside another object. Leave-one-out failed
only on member ids: a member a left-out reference shared is renamed in the rebuilt version (Emerald's
`BgAffineSet@BgAffineSet.o` becomes Fire Emblem 7's `BgAffineSet@gba-syscall.o`, the first remaining reference's id), and
the bench counted the rename as one added and one missing member at the same address.

**Decision.**

- (a) **No member over a placed member.** Within one library version no rule places a member over the bytes of another
  placed member (`overlapsPlaced`, core/signatures/rules/state.ts): a library's members are linked side by side.
- (b) **A fully masked member needs a pointer.** A member whose every byte is masked fits anywhere, so
  `sig.neighbour-spacing` and `sig.link-order-run` place it only where one of its words names a placed function of the
  version and holds its address (`evidenced`). m4a's pointer tables (`gMPlayJumpTableTemplate`, `gXcmdTable`) are proved
  by their functions; `sSetupInfos`, whose words name tables, is not placed by spacing.
- (c) **Runs.** `sig.link-order-run` weighs the runs of every chain of the version together (the `chains` sweep, which
  replaces the per-chain `chain` sweep: `ChainRule.place(state)` reads `state.chains`), ties in chain then link order;
  skips a link only when the skipped member's object is neither the object before nor the one after the gap (an object
  is linked whole); and lets the next member start at the next word where one object ends and another begins (the
  linker's section padding). The PoC's step 2 had none of these; its libraries (m4a, libagbsyscall, libgcc) never showed
  the cases, and every PoC floor of `g6.signatures-judged` still holds.
- (d) **Leave-one-out by counterpart.** `bench signatures --loo` maps each member of the rebuilt version to the full
  build's member that a remaining reference links at the same address (`counterparts`), counts `moved` for a member at
  another address than the full build placed it, `added` for a placement at an address where the full build placed no
  member of the version, and `missingShared` for a shared member whose counterpart is not placed. The gate file is
  unchanged; this is how its words ("adds no placement, moves none, and still places every member that another
  reference of the version also has") are counted. It changes what the gate reads, so phase-6.md puts it to the owner
  (Q8).

**Consequences.** `bench signatures`: every judged check passes on the six tuning ROMs (no wrong placement, table or
size, no name differing from a reference's own) with every PoC floor held; the sealed ROMs pass by counts; leave-one-out
reports 0 added, 0 moved and 0 missing on all seven runs. librfu's two stray placements on fe7j and sa3 (ROMs that do not
link librfu) are gone. Five rule tests fail on the old matcher and pass on the new one; the explain goldens are unchanged;
`looCounts`' unit test moves its added member to an address the full build left unplaced, and two cases cover the
counterparts.

**Rejected.** Preferring, on a reference ROM, that reference's own chain (the matcher would need to know which ROM it
matches). Trimming a trailing zero halfword from unsized members in the builder so `DivRem` and `Mod` merge
(`g6.signatures-rebuild` compares the real builds with the PoC's converted files). Counting leave-one-out by member id
alone (a renamed member is counted as one added and one missing member, against the gate's words).

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
