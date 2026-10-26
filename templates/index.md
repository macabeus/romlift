# templates

The scaffold a romlift project is created with (architecture §6.3, D74). They ship inside the npm package
(`files` in package.json). This `index.md` describes the directory and is not itself a template.

`MANIFEST.json` lists every scaffold file: its project path (`target`), the template it is rendered from
(`source`, relative to this directory) and whether it is written executable. It is read by
`readTemplates` (romlift/node) and decoded by `decodeScaffoldManifest` (`src/core/scaffold/vars.ts`), which
refuses an unknown member, a target that is not a project path, a repeated target and an unknown placeholder.

| Target in a project | Source here | Rendered by |
| --- | --- | --- |
| `Makefile` | `Makefile` | its template; `include modules.mk` and the `mk/<id>.mk` fragments |
| `setup.sh` (executable) | `setup.sh` | its template; the five duties of §6.3 |
| `AGENTS.md` | `AGENTS.md` | its template: the project's agent instructions |
| `README.md` | `README.md` | its template |
| `.github/workflows/build.yml` | `build.yml` | its template |
| `.gitignore` | `gitignore` | its template (npm drops a file named `.gitignore` from a package) |
| `mk/<id>.mk` | `compilers/<id>.mk` | one per build compiler (`BUILD_COMPILERS`, D47): the C pattern rule |
| `<name>.sha1` (`@@sha1File@@`) | none | romlift: `<sha1>  <name>.gba` in sha1sum format |
| `package.json` | none | romlift: the exact romlift version pinned |
| `.gitmodules` | none | romlift: `tools/agbcc` at `agbcc.json`'s URL |
| `include/global.h`, `include/gba/types.h`, `include/gba/io_reg.h` | `include/…` | their templates: the types and I/O registers decompiled C includes (plan.md's scaffold table; final-review docs-and-plan-1) |
| `include/macros.inc` | none | romlift: `DIALECT.macrosInc` |
| `include/include_asm.h` | none | romlift: `INCLUDE_ASM_HEADER` (`src/foundation/asm/dialect.ts`) |

`agbcc.json` (`{ "url", "commit" }`, decoded by `decodeAgbccPin`) is read, never copied: it pins the agbcc
that `.gitmodules` and `setup.sh` name (pret/agbcc `da598c1d918402c42c0c0d7128ba14567f3175e9`, the commit
the synthetic fixtures were built with).

Templates and manifest targets spell a value of `ScaffoldVars` as `@@<placeholder>@@`, one of `name`,
`romFile`, `builtRom`, `sha1`, `sha1File`, `romliftVersion`, `title`, `agbccUrl`, `agbccCommit`
(`SCAFFOLD_PLACEHOLDERS`). The template files land in phase 4's wave 2 (`p4-scaffold`); the manifest is the
phase lead's.
