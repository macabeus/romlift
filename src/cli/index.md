# src/cli

The `romlift` command: `main.ts`, argument parsing, the `CommandSpec` registry, exit codes, one file per
command under `commands/` with one command list per component (`commands/lists/`), and the text and NDJSON
reporters. No
command reads stdin or prompts (architecture §2.1). The registry lists only implemented commands and
knows nothing of phases (D29).

| Command | File | List | Since |
| --- | --- | --- | --- |
| `doctor [--json] [--full]` | `commands/doctor.ts` | `lists/toolchain.ts` | phase 1 |
| `analyze <rom> [--json] [--disable <rule>...]` | `commands/analyze.ts` | `lists/analysis.ts` | phase 2 |
| `analyze --update [--write] [--json]` | `commands/analyze.ts` | `lists/analysis.ts` | phase 4 (in a project) |
| `explain <addr> [--rom <rom>] [--json]` | `commands/explain.ts` | `lists/analysis.ts` | phase 2 (chunk and item: phase 3; without `--rom` in a project: phase 4) |
| `model [--rom <rom>] [--json]` | `commands/model.ts` | `lists/emission.ts` | phase 3 (without `--rom` in a project: phase 4) |
| `verify [--rom <rom>] [--assemble] [--link] [--printer readable\|raw] [--json]` | `commands/verify.ts` | `lists/emission.ts` | phase 3 (without `--rom` in a project: phase 4) |
| `init <rom> [dir] [--name <name>] [--module-size <bytes>] [--json]` | `commands/init.ts` | `lists/one-shot.ts` | phase 4 |
| `generate [--rom <rom>] [--dry-run] [--out <dir>] [--json]` | `commands/generate.ts` | `lists/one-shot.ts` | phase 4 |
| `scaffold --diff [--json]` | `commands/scaffold.ts` | `lists/scaffold.ts` | phase 4 |
| `signatures build <spec> [--out <dir>] [--json]` | `commands/signatures.ts` | `lists/signatures.ts` | phase 6 |
| `signatures <rom> [--signatures <dir>] [--json]` | `commands/signatures.ts` | `lists/signatures.ts` | phase 6 |
| `init <rom> --no-signatures` | `commands/init.ts` | `lists/one-shot.ts` | phase 6 (the flag) |
| `rename <old> <new> [--json]` | `commands/rename.ts` | `lists/rename.ts` | phase 6 (moved from phase 5, D92) |
| `--version` | `main.ts` | none | final review (end-to-end-user-12) |

`verify` only parses and prints: its composition is `core/workflow/verify.ts` (the toolchain plan and the report) and
`shell/project/verify-run.ts` (the runner), and the CLI may take values from only some `src/api` barrels (architecture
§2, D106 a). `verify`, `model` and `explain` with `--rom` inside a project warn `W_PROJECT_CONFIG_IGNORED`.

`commands/command-common.ts` holds what several commands share: the exit codes of a refusal and of a verify report
(`refusedExitCode`, `verifyExitCode`), the diagnostics of a result (`allDiagnostics`), the op counts of a write
plan and the NDJSON helpers.

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

With `--rom`, `model` and `verify` read no project (phase 3's form): the config is the one `configFromDiscover`
builds from the ROM's discover analysis, and `core/workflow/generate.ts` runs the confirm analysis over it. From
phase 4, without `--rom` inside a project (found from the working directory upward, `shell/project/locate.ts`), they
and `explain` read the project's ROM and `romlift.toml` (confirm mode, `confirmProject`), and project-mode `verify`
builds the C units from their reconciled `INCLUDE_ASM` statements (architecture §6.4). `init` writes a new project
(`core/workflow/init.ts` plans it, `shell/project/write-project.ts` writes it); `generate` regenerates the tree and
reconciles `src/*.c` (`generateProject`, `core/workflow/c-stubs.ts`), writes through the write plan under the project
lock and never writes `romlift.toml`; `analyze --update` prints (and with `--write` saves) the patch of
`core/workflow/analyze-update.ts`; `scaffold --diff` compares the scaffold files with the current templates and
writes nothing.
`model --json` prints `encodeModel`'s NDJSON (the `romlift/model-json@1` header, one line per chunk), the
analysis diagnostics and the summary (`counts`: modules, chunks, items, functions). `verify --json` prints one
`{"type":"check","id","status","detail"}` line per check in `CHECK_IDS` order (tiling, reencode, module-size,
text-layout, paths, then assemble and link when asked), the diagnostics, and the summary
(`{"type":"summary","ok","exitCode","sha1"?,"counts"}`, `sha1` the linked image's with `--link`), the contract the
g3 gate headers freeze. `--assemble` and `--link` write the tree into a fresh directory under `os.tmpdir()`
(`shell/temp-dir.ts`, removed afterwards), never the working directory, and only after the self-checks pass.
Exit codes: 0 ok, 3 a failed check, 1 an error diagnostic that is not a self-check's (the input, the model,
binutils missing), 2 usage.
