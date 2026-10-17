# src/cli

The `romlift` command: `main.ts`, argument parsing, the `CommandSpec` registry, exit codes, one file per
command under `commands/` with one command list per component, and the text and NDJSON reporters. No
command reads stdin or prompts (architecture §2.1). The registry lists only implemented commands and
knows nothing of phases (D29).
