# src/core

The pure core. Every decision romlift makes lives here: provenance, compiler profiles, analysis and its
rules (one file per rule), proposals, layout, evidence, signatures, config, the model, reconciliation, emission,
verification, the write plan, the scaffold and the workflows. (Legacy import was dropped with phase 5, D76 g.)

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
| `proposals/types.ts` | the one proposal shape, its sources (signature, evidence, legacy, analysis, layout) and `sourceKey` |
| `layout/` | module inference options (`types.ts`); legal borders and `inferModules` (D20) |
| `model/` | the frozen model (`types.ts`), the struct-of-arrays item table and `itemAt` (`item-table.ts`), labels per module (`resolver.ts`), the paths writers and checks share (`paths.ts`), and `buildModel` with its parts and codes (D62 b) |
| `emit/` | the emission stream's data and writer contract (`tree.ts`), `emitTree`, the printer (`print/`) and one file per writer (`writers/`, registry in `writers/index.ts`) |
| `verify/` | the self-checks (tiling, re-encode, module size, text layout, paths) and their report (`report.ts`) |
| `write-plan/` | the write policy (`plan-writes.ts`), its types and owned roots (`types.ts`), the manifest and journal codecs |
| `workflow/config-from-discover.ts` | the in-memory config of a discover run (D62 c) |

## Phase 4: one shot

| Path | Responsibility |
| --- | --- |
| `config/` | adds the TOML parser and its key checks (`parse.ts`, `keys.ts`), the canonical serializer (`serialize.ts`), the comment-keeping patch planner (`patch.ts`), the decomp.yaml reader (`decomp-yaml.ts`), the project ROM check (`rom-sha1.ts`) and their codes |
| `reconcile/` | the C tokenizer (`c-tokens.ts`), the file-scope scanner, `compiledDefinitions` and the INCLUDE_ASM planner (`include-asm.ts`), text edits (`text-edit.ts`) and their codes |
| `model/` | adds the C units (`c-unit.ts`: stub chunks, compile settings, the stub assembly), the C-data ASSERT lines (`c-data-assert.ts`) and the chunk-file readers of a tree on disk (`paths.ts`: `chunkNamesOf`, `moduleChunkStubs`) |
| `scaffold/` | the scaffold's variables and placeholders (`vars.ts`) and its rendering (`render.ts`) |
| `workflow/` | `generateProject` (`generate.ts`), the C stubs reconciled with the model (`c-stubs.ts`), `init`'s plan and directory verdict (`init.ts`, `init-config.ts`), `analyze --update` (`analyze-update.ts`), `scaffold --diff` (`scaffold-diff.ts`), the project inputs (`types.ts`) |
| `write-plan/` | adds `reconciled` edits and the one staleness rule of an edit (`staleEdit`, read by the shell at write time too), and the project's write plan (`project-plan.ts`) |
