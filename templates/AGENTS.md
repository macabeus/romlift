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

## What is generated and what is yours

- **Tool-owned, never edit:** `asm/`, `data/`, `ldscript.txt`, `symbols.ld`, `modules.mk`. `romlift generate`
  rewrites them from `romlift.toml` and the ROM, and a hand edit is lost on the next run. They are committed so a
  fresh worktree builds.
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
line of one it lost or renamed), and it never touches a line of C you wrote.

Each C module is compiled by `tools/agbcc/bin/<compiler>` (`[[modules]] compiler` in `romlift.toml`, default
`[build] compiler`), with the flags `modules.mk` lists; `mk/<compiler>.mk` holds the recipe.

## Data defined in C fails the link until phase 5

The linker script places only the code (`.text`) of a C object. A C file that defines data (a `const` array, a
string table, an initialised or zero-initialised global) fails the link with:

```
src/<module>.c defines data; see AGENTS.md (data ranges arrive in phase 5)
```

That is deliberate: romlift cannot yet place a C object's data at its address in the ROM. Keep the data in the
generated `data/` files and refer to it by its symbol (`extern`), until romlift's data ranges (phase 5) let a C array
replace its slice of the ROM.
