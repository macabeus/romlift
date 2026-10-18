# src/core

The pure core. Every decision romlift makes lives here: provenance, compiler profiles, analysis and its
rules (one file per rule), proposals, layout, evidence, legacy import, signatures, config, the model,
reconciliation, emission, verification, the write plan, the scaffold and the workflows.

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
