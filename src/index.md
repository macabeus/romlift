# src

The romlift package: four layers, each allowed to import only the layers below it (architecture §2).

| Directory | Responsibility |
| --- | --- |
| `foundation/` | Code with no project knowledge: ROM bytes, the instruction set, the assembler dialect, file-format parsers, the diagnostic mechanism, utilities. Imports nothing outside `foundation/`, no npm package, no `node:*`. |
| `core/` | The pure core: analysis, layout, model, emission, verification, config, signatures, evidence, write planning and the workflows that compose them. Plain data in, plain data out; only allowlisted globals. |
| `shell/` | The only code that touches files, processes, hashing or the environment. It reads inputs, calls one workflow and applies the plan the core returned; it decides nothing. |
| `cli/` | Argument parsing, the command registry, one file per command, and the text and NDJSON reporters. |

The entry points `index.ts` (`romlift`), `node.ts` (`romlift/node`), `isa.ts` (`romlift/isa`) and
`internal.ts` (`romlift/internal`) contain only `export * from './api/<component>.ts'` lines; each
`api/<component>.ts` barrel is owned by one component (D43). They are created by component 1.0 of
phase 1, as is every file listed for it in [roadmap.md](../docs/roadmap.md).
