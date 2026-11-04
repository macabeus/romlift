# src/cli

The `romlift` command: `main.ts`, argument parsing, the `CommandSpec` registry, exit codes, one file per command
under `commands/` (listed by `commands/index.ts`), and the text and NDJSON reporters. No command reads stdin or
prompts (architecture §2.1). The CLI has five commands, the ones a user of a project runs (D108); the checks and
tools a maintainer runs are `npm run` scripts and the bench.

| Command | File |
| --- | --- |
| `init <rom> [dir] [--name <name>] [--module-size <bytes>] [--no-signatures] [--json]` | `commands/init.ts` |
| `generate [--rom <rom>] [--dry-run] [--out <dir>] [--json]` | `commands/generate.ts` |
| `update [--write] [--json]` | `commands/update.ts` |
| `rename <old> <new> [--json]` | `commands/rename.ts` |
| `explain <addr> [--rom <rom>] [--signatures <dir>] [--json]` | `commands/explain.ts` |
| `--version` | `main.ts` |

`commands/command-common.ts` holds what several commands share: the exit codes of a refusal and of a checked run
(`refusedExitCode`, `verifyExitCode`), the diagnostics of a result (`allDiagnostics`), the op counts of a write plan
and the NDJSON helpers. The CLI may take values from only some `src/api` barrels (architecture §2, D106 a).

`init` writes a new project (`core/workflow/init.ts` plans it, `shell/project/write-project.ts` writes it).
`generate` regenerates the tree and reconciles `src/*.c` (`generateProject`, `core/workflow/c-stubs.ts`), writes
through the write plan under the project lock and never writes `romlift.toml`. `update` prints (and with `--write`
saves) the patch of `core/workflow/update.ts`. `rename` edits `romlift.toml` and the C together
(`core/workflow/rename.ts`, `shell/project/rename-project.ts`). A project is found from the working directory upward
(`shell/project/locate.ts`).

`explain` reads the ROM through the shell and calls `core/workflow/explain.ts`: with `--rom` the discover analysis of
that bare ROM (`W_PROJECT_CONFIG_IGNORED` when run inside a project), else the project's ROM and `romlift.toml`
(confirm mode, `confirmProject`). It reports the address's claim, owner, provenance, rejections and verdicts, and the
chunk and the item that hold it in the model (D35): the `explain` line carries `chunk` (`name`, `kind`, `module`) and
`item` (`kind`, `span`, and per kind the instruction's `mode`, `size`, `specId` and `.inst` text, a pool's `value`, a
table entry's `target` and `thumbBit`, a raw instruction's `reason`, a data note), and the text two lines `chunk:` and
`item:`. Its `--json` output is one `explain` line, the diagnostics and the summary, with every address spelt by
`hexAddr` and nothing that depends on the path, the time or the locale.

Exit codes: 0 ok, 3 a failed self-check, 1 an error diagnostic that is not a self-check's (the input, the model, a
write), 2 usage.
