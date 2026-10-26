# src

The romlift package: four layers, each allowed to import only the layers below it (architecture §2).

| Directory | Responsibility |
| --- | --- |
| `foundation/` | Code with no project knowledge: ROM bytes, the instruction set, the assembler dialect, file-format parsers, the diagnostic mechanism, utilities. Imports nothing outside `foundation/`, no npm package, no `node:*`. |
| `core/` | The pure core: analysis, layout, model, emission, verification, config, signatures, proposals, reconcile, scaffold, write planning and the workflows that compose them. Plain data in, plain data out; only allowlisted globals. (`core/evidence` was never built, D91, D92.) |
| `shell/` | The only code that touches files, processes, hashing or the environment. It reads inputs, calls one workflow and applies the plan the core returned; it decides nothing. |
| `cli/` | Argument parsing, the command registry, one file per command, and the text and NDJSON reporters. |

The entry points `index.ts` (`romlift`), `node.ts` (`romlift/node`), `isa.ts` (`romlift/isa`) and
`internal.ts` (`romlift/internal`) contain only `export * from './api/<component>.ts'` lines; each
`api/<component>.ts` barrel is owned by one component (D43). From phase 2, `romlift` exports the profiles and
`analyze` (`api/profile.ts`, `api/analysis.ts`); `romlift/internal` exports the tuned analysis, the rule
registry, `defineRule`, `diagnoseMisses` and `makeReading` (`api/internal-analysis.ts`). They are created by component 1.0 of
phase 1, as is every file listed for it in [roadmap.md](../docs/roadmap.md).

From phase 3, `romlift` exports the config, proposal and layout types with `BUILD_COMPILERS`, `sourceKey` and
`validateConfig` (`api/config-types.ts`), the model types with `itemAt`, `resolverFor`, `wordValueOf` and the
shared paths (`api/model.ts`), the emission stream's types (`api/emit.ts`), the verify report
(`api/verify.ts`) and the write plan's types with the manifest and journal codecs (`api/write-plan.ts`); the
phase-3 lead created them, with the empty `api/{layout,internal-emit,project,workflow-generate}.ts` that the
wave-2 and wave-3 components fill (D62). `api/workflow-generate.ts` holds `generate` (its result is plain data;
`generatedEntries` re-emits its stream), the phase-3 `init` equivalents `initConfig`, `initModel` and
`generateFromRom`, `discoverModel` and `freshTreePlanInputs`; `romlift/node`'s `api/project.ts` adds
`writeFreshTree`, the one way a fresh tree is written (D65).

From phase 4 `romlift` and `romlift/node` add the one-shot pieces (`api/one-shot-types.ts`, `api/one-shot-files.ts`,
`api/scaffold.ts`, `api/scaffold-files.ts`, `api/config-files.ts`, `api/workflow-one-shot.ts`); from phase 6 the
signatures (`api/signatures-types.ts`, `api/signatures-match.ts`, `api/signatures-build.ts`, `api/signatures-files.ts`,
`api/internal-signatures.ts`), rename (`api/rename.ts`, `api/rename-files.ts`) and the reconciler
(`api/reconcile.ts`). Since the final review `api/project.ts` also exports `runToolchainChecks`, the runner of `verify
--assemble/--link`, with core/workflow/verify.ts's plan (D106 a).
