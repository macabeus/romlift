# src/cli

The `romlift` command: `main.ts`, argument parsing, the `CommandSpec` registry, exit codes, one file per
command under `commands/` with one command list per component, and the text and NDJSON reporters. No
command reads stdin or prompts (architecture §2.1). The registry lists only implemented commands and
knows nothing of phases (D29).

| Command | File | List | Since |
| --- | --- | --- | --- |
| `doctor [--json] [--full]` | `commands/doctor.ts` | `lists/toolchain.ts` | phase 1 |
| `analyze <rom> [--json] [--disable <rule>...]` | `commands/analyze.ts` | `lists/analysis.ts` | phase 2 |
| `explain <addr> --rom <rom> [--json]` | `commands/explain.ts` | `lists/analysis.ts` | phase 2 |

`analyze` and `explain` read the ROM through the shell (`readBytes`, `sha1Of`) and call the workflows
`core/workflow/discover.ts` and `core/workflow/explain.ts`. Their `--json` output is NDJSON with every
address spelt by `hexAddr` and nothing that depends on the path, the time or the locale: `analyze` prints
one `function` line per function, one `rejection` line per rejection, the `diagnostic` lines and the
`summary` (`counts`: functions, rejections, diagnostics); `explain` prints one `explain` line holding the
report, the diagnostics and the summary. `--disable` reaches the analysis only through the internal
tuning (D37); an id that names no registered rule is a usage error (exit 2), as is `explain` without
`--rom` in phase 2.
