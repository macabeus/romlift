# src/shell

The only code that touches the file system, processes, hashing (`node:crypto`) or the environment:
locating and loading a project, reading signature specs, reference builds and built signature files, running binutils
and agbcc, applying a write plan atomically under a lock. (The evidence and trace readers were dropped, D91, D92.) The shell decides nothing; every policy is a pure function in `core/`
(D17, D36). Only `fs.ts` lists directories, sorted by code unit (D5).

## Phase 4: projects

| Path | Responsibility |
| --- | --- |
| `project/locate.ts`, `project/read-inputs.ts` | finding a project from the working directory, reading its ROM, TOML, `src/*.c`, the chunk files of the tree on disk (`readChunkFiles`) and the headers the C reconciliation follows (`readHeaderTexts`: every file under `include/` and every `.h` under `src/`, listed by `disk-state.ts`'s `filesUnder` with `followLinks`, which follows a symbolic link to a directory but enters none to the project directory, to a directory it is already inside or to one above the project; then every file an `#include` of the C or of a header read names, as `cpp -nostdinc -I include` opens it, from the including file's real directory (phase 6); the disk snapshot's listing never follows one) into `ProjectInputs` |
| `project/disk-state.ts`, `project/apply-writes.ts`, `project/lock.ts`, `project/spelling.ts` | the disk snapshot, the manifest and journal a plan reads, applying a write plan atomically (an edit hashed again right before its write and judged by core's `staleEdit`), the project lock and case-only renames |
| `project/write-project.ts`, `project/fresh-tree.ts`, `project/templates.ts` | `init`'s writes, a tree written into a fresh directory, the scaffold templates and the agbcc pin |
| `config/load.ts`, `config/save.ts` | reading `romlift.toml` and saving `analyze --update --write`'s patch under the lock |
| `fs.ts` | adds `isDirectory`; from phase 6 `isRegularFile`, `readText` and `readJson` (architecture-6, D95); each, like every other read and stat site of the shell, reads absence through `isAbsentError`, ENOENT, ENOTDIR or ELOOP (a link loop, since fix round 4, architecture-r2-4, D99 c; `readInitDir`, `readDigests`, the C-text and rename reads of `project/read-inputs.ts` and `project/disk-state.ts`'s optional reads since fix round 6, architecture-o1-6), and any other failure is E_IO_READ; only `project/apply-writes.ts`' removal of a file takes ENOENT alone as already gone |

## Phase 6: evidence

| Path | Responsibility |
| --- | --- |
| `signatures/build-from-references.ts`, `signatures/locate.ts` | building a signature file from a spec's reference ELFs, maps and ROMs, and locating the built files (`signatures/` or `ROMLIFT_SIGNATURES`, `W_SIGNATURES_ABSENT`; `loadSignatureFiles`, the one call of the four commands that read them, D95 b), p6-signatures-build |
| `project/read-inputs.ts` | adds each followed header's real path (`ProjectInputs.headerRealPaths`) for the cpp-exact include resolution, p6-include-links |

## Final review (fix round 1, D106)

| Path | Responsibility |
| --- | --- |
| `project/verify-run.ts` | `runToolchainChecks`: carries out `core/workflow/verify.ts`'s toolchain plan (writes the tree into a temporary directory, finds binutils, assembles and links), the composition `verify`, the bench and the gates share (architecture-1) |
| `fs.ts` | adds `readTextIfPresent` (absent is `undefined`, any other failure E_IO_READ), which `toolchain/corpus-inputs.ts` reads through instead of a catch-all, so an unreadable corpus input stops the digest rather than dropping out of it (architecture-5); `project/lock.ts` reads through it too and keeps reading an unreadable lock (a directory there) as one it cannot take, E_PROJECT_LOCKED, as its test requires; the remaining catch-all sites of `project/disk-state.ts` (`snapshotEntry`, `oneFile`, `readExecutables`) are recorded exceptions, carried past the final review |
| `project/locate.ts` | adds `projectConfigIgnored` (`W_PROJECT_CONFIG_IGNORED`: `verify`, `model` or `explain --rom` inside a project) |
| `project/read-inputs.ts` | a missing project ROM is E_IO_READ naming the remedies; `generate --rom` while the project's own ROM is missing warns `W_PROJECT_ROM_ABSENT` |
| `signatures/locate.ts`, `signatures/build-from-references.ts` | `W_SIGNATURES_ABSENT` and an unreadable reference say that signature files are not shipped and that a build needs the reference decomp checkouts under `ROMLIFT_BENCH_ROOT` |
| `toolchain/npm.ts` | with `ROMLIFT_CLI` set, init's lock step runs no npm (`W_LOCKFILE_DEFERRED` says so) |
