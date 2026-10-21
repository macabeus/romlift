# AGENTS.md

Instructions for agents (and people) working in this repository: a matching decompilation of @@title@@. The goal is C
source that `make` builds into a ROM identical, byte for byte, to the original (SHA-1 in `@@sha1File@@`). The project
was created by [romlift](https://github.com/macabeus/romlift) @@romliftVersion@@ (`package.json` pins it).

## Build

| Command | What it does |
| --- | --- |
| `./setup.sh` | once per clone or git worktree: checks the toolchain, builds agbcc into `tools/agbcc/bin`, copies `@@romFile@@` from the main worktree, installs romlift, generates the tree when `asm/` is absent |
| `make` | builds `@@builtRom@@` and compares its SHA-1 with `@@sha1File@@`; exits 0 only on a match, the only verdict that counts |
| `make rom` | builds `@@builtRom@@` without the comparison |
| `npx romlift generate` | rewrites the generated files from `romlift.toml` and the ROM |
| `make clean` | removes `build/` and the built ROM |

`@@romFile@@` is the original ROM. It is never committed (`.gitignore`); bring your own copy.

**`ROMLIFT_CLI`, until romlift is published.** romlift is not on the npm registry yet (a pre-release limitation), so
`package.json`'s pinned version does not resolve and `./setup.sh` cannot install it. Set `ROMLIFT_CLI` to a romlift
command (for example `ROMLIFT_CLI="node /path/to/romlift/dist/cli/main.js" ./setup.sh`, from a built checkout of
romlift): setup.sh then skips the npm install and runs that command instead of `npx romlift`. Run every other romlift
command of this file through node the same way (`node /path/to/romlift/dist/cli/main.js generate` for `npx romlift
generate`).

## What is generated and what is yours

- **Tool-owned, never edit:** `asm/`, `data/`, `ldscript.txt`, `symbols.ld`, `modules.mk`. `romlift generate`
  rewrites them from `romlift.toml` and the ROM, and a hand edit is lost on the next run. They are not committed
  (`.gitignore`): `./setup.sh` generates them in a fresh clone or worktree, where `asm/` is absent.
- **Yours:** `romlift.toml` (modules, function names and boundaries, symbols; the one place to change what is
  generated), `src/*.c`, `include/`, `Makefile`, `mk/*.mk`, `setup.sh` and this file. romlift wrote them once and does
  not overwrite them; `npx romlift scaffold --diff` shows how they differ from the current templates.

## Decompiling a function

Every module of kind `c` has a `src/<module>.c` holding one line per function, in ROM order:

```c
INCLUDE_ASM("asm/nonmatchings/<module>", FunctionName);
```

`INCLUDE_ASM` (`include/include_asm.h`) assembles the function's generated file,
`asm/nonmatchings/<module>/FunctionName.s`, in place. To decompile the function, replace that line with C that compiles
to the same bytes, then run `make`; never edit the `.s` file. To rename a function or move a boundary, change its entry
in `[functions]` of `romlift.toml` and run `npx romlift generate`: it rewrites the generated files and brings the
`INCLUDE_ASM` lines of `src/*.c` in line with them (it adds the line of a function the module gained and removes the
line of one it lost or renamed), and it never touches a line of C you wrote. A function you have already decompiled
is the exception: rename its C definition to the new name before (or together with) the `romlift.toml` edit, and move
its C to the other module's file when the edit moves it. Otherwise `romlift generate` refuses and writes nothing
(`E_C_STALE_DEFINITION`, `E_C_DEFINITION_MOVED`), since the new `INCLUDE_ASM` line would define the function twice.
`INCLUDE_ASM` lines inside `#if`/`#ifdef` blocks are yours too: `romlift generate` never edits them and puts new
ones outside them, and when an edit leaves one naming a function its module no longer has it refuses
(`E_C_CONDITIONAL_STUB`) until you rename or remove it. A definition inside such a block holds nothing for the default
build: the function keeps its `INCLUDE_ASM` line, in the block's `#else` branch or outside the block. To rename a
decompiled function, change both its C name and `romlift.toml`; renamed in C alone, `romlift generate` refuses
(`E_C_STALE_DEFINITION`) rather than add its `INCLUDE_ASM` line again.

To rename a `c` module, change its `name` in `[[modules]]` and move its source in the same step
(`git mv src/<old>.c src/<new>.c`), then run `npx romlift generate`: it replaces the file's
`INCLUDE_ASM("asm/nonmatchings/<old>", …)` lines with the new directory's and keeps your C. Renamed in
`romlift.toml` alone, the old file is left unbuilt (`W_C_FILE_UNUSED`), and if it holds decompiled C `romlift
generate` refuses (`E_C_DEFINITION_MOVED`) until you move it.

romlift reads an `#if` block inside a function as the compiler would, one branch at a time, so a branch may open a
brace the other does not (`#ifndef NONMATCHING` around a `do {` and its `} while (0);`). At file scope, the branches
of a block must end alike: a head split across `#if`/`#else` is fine, but a macro call with no `;` in one branch
(`ASM_FUNC("…", void f(void))`) against a definition in the other is not. romlift cannot read such a file exactly:
while its `INCLUDE_ASM` lines already match `romlift.toml` it only warns (`W_C_UNSCANNABLE`) and edits nothing, and
when they would have to change it refuses (`E_C_UNSCANNABLE`): change them yourself, or end the branches alike.

Each C module is compiled by `tools/agbcc/bin/<compiler>` (`[[modules]] compiler` in `romlift.toml`, default
`[build] compiler`), with the flags `modules.mk` lists; `mk/<compiler>.mk` holds the recipe.

## Data defined in C fails the link

The linker script places only the code (`.text`) of a C object. A C file that defines data (a `const` array, a
string table, an initialised or zero-initialised global) fails the link with:

```
src/<module>.c defines data; see AGENTS.md (romlift does not place C data yet)
```

That is deliberate: romlift cannot yet place a C object's data at its address in the ROM. Keep the data in the
generated `data/` files and refer to it by its symbol (`extern`), until a later romlift release's data ranges let a C
array replace its slice of the ROM.
