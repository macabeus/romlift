# src/core

The pure core. Every decision romlift makes lives here: provenance, compiler profiles, analysis and its
rules (one file per rule), proposals, layout, signatures, config, the model, reconciliation, emission,
verification, the write plan, the scaffold and the workflows. (Legacy import and the evidence importers were dropped
with phase 5 and the gba-kit trace, D91, D92: `core/evidence` and `core/legacy` are not built.)

- Bytes and plain data in, plain data out. No files, processes, clocks, hashing or environment: the
  shell injects digests and reads inputs (D3, D44).
- Only the globals of the allowlist in architecture §2; no `Map`/`Set` iteration except through
  `sortedKeys`/`sortedEntries` where the architecture requires it (D5).
- Content errors are returned as diagnostics, never thrown; each module that raises codes owns a
  `codes.ts` (D45).
- `workflow/` composes the other modules; nothing in core imports it (D36).

## Phase 2: provenance, profiles and the analysis

| Path | Responsibility |
| --- | --- |
| `provenance/` | rule ids and metadata (`rule-id.ts`), provenance and rejections (`provenance.ts`), the trail (`trail.ts`), the miss-reason and origin vocabularies (`vocabulary.ts`) |
| `profile/` | the compiler profile type (`types.ts`), agbcc's numbers, idioms and slot orders (`agbcc.ts`), the registry (`registry.ts`) |
| `analysis/types.ts` | the analysis result and options, the internal `Reading`, the view, one contract per rule kind with the per-rule assignments (D56) |
| `analysis/{address-map,pointers,limits,codes,reading,codec,explain}.ts` | load/run addresses, the pointer index, safety bounds (settle and fixpoint rounds, the candidate budget, the zero-run and walk limits), diagnostic codes, the reading builder, the `romlift/analysis@1` codec of the result, the analysis part of `explain` for one address (the lockstep oracle was deleted in the phase-2 fix round, D59) |
| `analysis/walk/` | the Thumb and ARM walks (`thumb.ts`, `arm.ts`), the cursor and walk environment (`cursor.ts`), the record a walk fills (`record.ts`), the reading queries rules share (`predicates.ts`) and the paged instruction index (`insn-index.ts`) |
| `analysis/driver/` | the PoC's control flow (D48): `run`, `grow`, `fill-gaps`, `accept`, `settle`, `validity`, `epoch`, `worklist`, `confirm`, `diagnose`, `reuse`; the state (`state.ts`), its derived facts (`facts.ts`), the trail and rejections (`trail.ts`), the view (`view.ts`); and `rules.ts`, the only importer of `rules/index.ts` |
| `analysis/rules/` | `define-rule.ts`, `index.ts` and one directory per family, one file per rule (§4.1) |

## Phase 3: emission

| Path | Responsibility |
| --- | --- |
| `config/` | the in-memory project config and its zod schema (`schema.ts`), the build compilers (`compilers.ts`, D47) |
| `proposals/types.ts` | the one proposal shape, its sources (signature, analysis, layout; D91 e) and `sourceKey` |
| `layout/` | module inference options (`types.ts`); legal borders, with why a start is refused, and `inferModules` (D20, D109) |
| `model/` | the frozen model (`types.ts`), the struct-of-arrays item table and `itemAt` (`item-table.ts`), labels per module (`resolver.ts`), the paths writers and checks share (`paths.ts`), and `buildModel` with its parts and codes (D62 b) |
| `emit/` | the emission stream's data and writer contract (`tree.ts`), `emitTree`, the printer (`print/`) and one file per writer (`writers/`, registry in `writers/index.ts`) |
| `verify/` | the self-checks (tiling, re-encode, module size, text layout, paths) and their report (`report.ts`) |
| `write-plan/` | the write policy (`plan-writes.ts`), its types and owned roots (`types.ts`), the manifest and journal codecs |
| `workflow/config-from-discover.ts` | the in-memory config of a discover run (D62 c) |

## Phase 4: one shot

| Path | Responsibility |
| --- | --- |
| `config/` | adds the TOML parser and its key checks (`parse.ts`, `keys.ts`), the canonical serializer (`serialize.ts`), the comment-keeping patch planner (`patch.ts`), the decomp.yaml reader (`decomp-yaml.ts`), the project ROM check (`rom-sha1.ts`) and their codes |
| `reconcile/` | the C tokenizer (`c-tokens.ts`), the file-scope scanner, `compiledDefinitions` and the include resolution (`c-scan.ts`), the INCLUDE_ASM planner (`include-asm.ts`), text edits (`text-edit.ts`) and their codes |
| `model/` | adds the C units (`c-unit.ts`: stub chunks, compile settings, the stub assembly), the C-data ASSERT lines (`c-data-assert.ts`) and the chunk-file readers of a tree on disk (`paths.ts`: `chunkNamesOf`, `moduleChunkStubs`) |
| `model/extents.ts` | the least extents of the unsized work-RAM symbols, from the accesses Thumb code makes through their addresses, and `W_POOL_WORD_PAST_SYMBOL` (D110) |
| `scaffold/` | the scaffold's variables and placeholders (`vars.ts`) and its rendering (`render.ts`) |
| `workflow/` | `generateProject` (`generate.ts`), the C stubs reconciled with the model (`c-stubs.ts`), `init`'s plan and directory verdict (`init.ts`, `init-config.ts`), `update` (`update.ts`), the toolchain plan of the tree checks the gates and the bench run (`verify.ts`), the project inputs (`types.ts`) |
| `write-plan/` | adds `reconciled` edits and the one staleness rule of an edit (`staleEdit`, read by the shell at write time too), and the project's write plan (`project-plan.ts`) |

## Phase 6: evidence

Frozen by the lead (D93); the parts marked with an owner land in waves 2 and 3.

| Path | Responsibility |
| --- | --- |
| `signatures/schema.ts`, `signatures/spec.ts`, `signatures/issues.ts`, `signatures/zod-helpers.ts`, `signatures/sealing.ts` | the schema-3 signature file, the placement and the rule ids; the committed spec and `isLibraryName`; their zod validators (`parseSignatureFile`, `parseSignatureSpec`, D95 d), the zod building blocks both share and the refusal text of their first issue; `isSealedDataset` (the one sealing rule, D32, apart from the spec format) |
| `signatures/codes.ts`, `signatures/rules/` | the signature codes (the matcher's four `W_SIGNATURE_*`; the builder's land with p6-signatures-build) and the five placement rules, one file each, with their registry (`SIGNATURE_RULES`, the metadata; `PLACEMENT_RULES`, the rules match.ts runs) and the state they share (`rules/state.ts`) |
| `signatures/{extract,match,resolve,policy,propose}.ts` | the builder's pure part (p6-signatures-build), the matcher, overlap resolution, its policy and the proposals (p6-signatures-match) |
| `config/` | adds the `[[modules]]` key `data_start` (`dataStart`), syntax only |
| `reconcile/c-scan.ts`, `reconcile/rename-tokens.ts`, `reconcile/rename-asm.ts` | the file-scope scanner and include resolution split out of the planner (p6-reconcile-carried); identifier-only renames (p6-rename), in C and in a module's hand-written assembly source (D109) |
| `workflow/types.ts` | adds the signature files `init` and `update` read, `InitOptions.signatures`, `ProjectInputs.headerRealPaths` and the `CheckProposals` contract |
| `workflow/proposals.ts`, `workflow/signature-layer.ts`, `workflow/rename.ts`, `workflow/explain.ts` | the proposal screen alone (`checkProposals`, p6-proposals); the signature layer (`signaturesOver`, `signatureLayer`, `foldSignatures`, `updateProposals`, the library-module notes, `signatureNotes`; D95 b); `planRename` and `renameModelNames` (p6-rename, D95 c); explain's signature part (`ExplainSignature`, filled by p6-proposals) |
| `layout/module-proposals.ts` | the runs_at borders and library modules a project lacks (`planRunsAtBorders`, `planLibraryModules`, `regionsWithoutModule`), with infer-modules.ts's `freeModuleName` the one naming rule (D95 b) |
