# src/shell

The only code that touches the file system, processes, hashing (`node:crypto`) or the environment:
locating and loading a project, reading evidence files, running binutils and agbcc, applying a write
plan atomically under a lock. The shell decides nothing; every policy is a pure function in `core/`
(D17, D36). Only `fs.ts` lists directories, sorted by code unit (D5).

## Phase 4: projects

| Path | Responsibility |
| --- | --- |
| `project/locate.ts`, `project/read-inputs.ts` | finding a project from the working directory, reading its ROM, TOML, `src/*.c`, the chunk files of the tree on disk (`readChunkFiles`) and the headers the C reconciliation follows (`readHeaderTexts`: every file under `include/` and every `.h` under `src/`, listed by `disk-state.ts`'s `filesUnder` with `followLinks`, which follows a symbolic link to a directory, not exactly as cpp does (D89 a, D90 a), and ends a cycle at a directory it is already inside or at the project directory; the disk snapshot's listing never follows one) into `ProjectInputs` |
| `project/disk-state.ts`, `project/apply-writes.ts`, `project/lock.ts`, `project/spelling.ts` | the disk snapshot, the manifest and journal a plan reads, applying a write plan atomically (an edit hashed again right before its write and judged by core's `staleEdit`), the project lock and case-only renames |
| `project/write-project.ts`, `project/fresh-tree.ts`, `project/templates.ts` | `init`'s writes, a tree written into a fresh directory, the scaffold templates and the agbcc pin |
| `config/load.ts`, `config/save.ts` | reading `romlift.toml` and saving `analyze --update --write`'s patch under the lock |
| `fs.ts` | adds `isDirectory` (absent only on ENOENT or ENOTDIR, any other failure E_IO_READ) |
