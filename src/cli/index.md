# src/cli

The `romlift` command: `main.ts`, argument parsing, the `CommandSpec` registry, exit codes, one file per
command under `commands/` with one command list per component, and the text and NDJSON reporters. No
command reads stdin or prompts (architecture §2.1). The registry lists only implemented commands and
knows nothing of phases (D29).

| Command | File | List | Since |
| --- | --- | --- | --- |
| `doctor [--json] [--full]` | `commands/doctor.ts` | `lists/toolchain.ts` | phase 1 |
| `analyze <rom> [--json] [--disable <rule>...]` | `commands/analyze.ts` | `lists/analysis.ts` | phase 2 |
| `explain <addr> --rom <rom> [--json]` | `commands/explain.ts` | `lists/analysis.ts` | phase 2 (chunk and item: phase 3) |
| `model --rom <rom> [--json]` | `commands/model.ts` | `lists/emission.ts` | phase 3 |
| `verify --rom <rom> [--assemble] [--link] [--printer readable\|raw] [--json]` | `commands/verify.ts` | `lists/emission.ts` | phase 3 |

`analyze` and `explain` read the ROM through the shell (`readBytes`, `sha1Of`) and call the workflows
`core/workflow/discover.ts` and `core/workflow/explain.ts`. Their `--json` output is NDJSON with every
address spelt by `hexAddr` and nothing that depends on the path, the time or the locale: `analyze` prints
one `function` line per function, one `rejection` line per rejection, the `diagnostic` lines and the
`summary` (`counts`: functions, rejections, diagnostics); `explain` prints one `explain` line holding the
report, the diagnostics and the summary. `--disable` reaches the analysis only through the internal
tuning (D37); an id that names no registered rule is a usage error (exit 2), as is `explain` without
`--rom` in phase 2.

`explain` adds, from phase 3, the chunk and the item that hold the address in the model configFromDiscover and
buildModel make of the same discover result (D35): the `explain` line gains `chunk` (`name`, `kind`, `module`)
and `item` (`kind`, `span`, and per kind the instruction's `mode`, `size`, `specId` and `.inst` text, a pool's
`value`, a table entry's `target` and `thumbBit`, a raw instruction's `reason`, a data note), and the text two
lines `chunk:` and `item:`.

`model` and `verify` take `--rom` because phase 3 has no project: the config is the one `configFromDiscover`
builds from the ROM's discover analysis, and `core/workflow/generate.ts` runs the confirm analysis over it.
`model --json` prints `encodeModel`'s NDJSON (the `romlift/model-json@1` header, one line per chunk), the
analysis diagnostics and the summary (`counts`: modules, chunks, items, functions). `verify --json` prints one
`{"type":"check","id","status","detail"}` line per check in `CHECK_IDS` order (tiling, reencode, module-size,
text-layout, paths, then assemble and link when asked), the diagnostics, and the summary
(`{"type":"summary","ok","exitCode","sha1"?,"counts"}`, `sha1` the linked image's with `--link`), the contract the
g3 gate headers freeze. `--assemble` and `--link` write the tree into a fresh directory under `os.tmpdir()`
(`shell/temp-dir.ts`, removed afterwards), never the working directory, and only after the self-checks pass.
Exit codes: 0 ok, 3 a failed check, 1 an error diagnostic that is not a self-check's (the input, the model,
binutils missing), 2 usage.
