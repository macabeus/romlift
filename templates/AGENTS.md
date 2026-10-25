# AGENTS.md

Instructions for agents (and people) working in this repository: a matching decompilation of @@title@@. The goal is C
source that `make` builds into a ROM identical, byte for byte, to the original (SHA-1 in `@@sha1File@@`). The project
was created by [romlift](https://github.com/macabeus/romlift) @@romliftVersion@@ (`package.json` pins it).

## Build

| Command | What it does |
| --- | --- |
| `./setup.sh` | once per clone or git worktree, and again after a pull: checks the toolchain, builds agbcc into `tools/agbcc/bin`, copies `@@romFile@@` from the main worktree, installs romlift, generates the tree when `asm/` is absent or `romlift.toml` changed since the last `romlift generate` |
| `make` | builds `@@builtRom@@` and compares its SHA-1 with `@@sha1File@@`; exits 0 only on a match, the only verdict that counts |
| `make rom` | builds `@@builtRom@@` without the comparison |
| `npx romlift generate` | rewrites the generated files from `romlift.toml` and the ROM |
| `make expected` | builds each module's objdiff target, `expected/<module>.o` (no compiler; `objdiff.json` lists the C modules') |
| `npx romlift rename <old> <new>` | renames a function or symbol in `romlift.toml` and in the C of `src/` and `include/` together |
| `make clean` | removes `build/`, the built ROM and the `expected/` objects |

`@@romFile@@` is the original ROM. It is never committed (`.gitignore`); bring your own copy.

**`ROMLIFT_CLI`, until romlift is published.** romlift is not on the npm registry yet (a pre-release limitation), so
`package.json`'s pinned version does not resolve and `./setup.sh` cannot install it. Set `ROMLIFT_CLI` to a romlift
command (for example `ROMLIFT_CLI="node /path/to/romlift/dist/cli/main.js" ./setup.sh`, from a built checkout of
romlift): setup.sh then skips the npm install and runs that command instead of `npx romlift`. Run every other romlift
command of this file through node the same way (`node /path/to/romlift/dist/cli/main.js generate` for `npx romlift
generate`).

## What is generated and what is yours

- **Tool-owned, never edit:** `asm/`, `data/`, `expected/`, `ldscript.txt`, `symbols.ld`, `modules.mk`,
  `objdiff.json`. `romlift generate` rewrites them from `romlift.toml` and the ROM, and a hand edit is lost on the next
  run. They are not committed
  (`.gitignore`): `./setup.sh` generates them in a fresh clone or worktree, where `asm/` is absent. **After a `git
  pull` or a checkout that changes `romlift.toml`, run `npx romlift generate` (or `./setup.sh`) before `make`:**
  `modules.mk` records the SHA-1 of the `romlift.toml` it was generated from, and `make` stops with a message while
  they differ, rather than build a stale tree. After one that changes the romlift version `package.json` pins, run
  `./setup.sh` and then `npx romlift generate` yourself: neither `make` nor `./setup.sh` notices a new romlift.
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
is the exception: rename its C definition to the new name before (or together with) the `romlift.toml` edit (or let
`npx romlift rename` do both, below), and move its C to the other module's file when the edit moves it. Otherwise `romlift generate` refuses and writes nothing
(`E_C_STALE_DEFINITION`, `E_C_DEFINITION_MOVED`), since the new `INCLUDE_ASM` line would define the function twice.
When the other module's file does not exist yet (a new module), create it with only the C: `romlift generate` adds
its `#include "include_asm.h"` and the module's other `INCLUDE_ASM` lines around it.
`INCLUDE_ASM` lines inside `#if`/`#ifdef` blocks are yours too: `romlift generate` never edits them and puts new
ones outside them, and when an edit leaves one naming a function its module no longer has it refuses
(`E_C_CONDITIONAL_STUB`) until you rename or remove it. A definition inside such a block holds nothing for the default
build: the function keeps its `INCLUDE_ASM` line, in the block's `#else` branch or outside the block, unless every
branch of a block with an `#else` defines it (`#ifdef NONMATCHING` C `#else` a `NAKED` definition `#endif`). To rename a
decompiled function, change both its C name and `romlift.toml`; renamed in C alone, `romlift generate` refuses
(`E_C_STALE_DEFINITION`) rather than add its `INCLUDE_ASM` line again.

**`npx romlift rename <old> <new>`** makes both edits at once: it renames the entry of `romlift.toml` named (or aliased)
`<old>` on its one line, drops its `from` key (the name is yours from then on), and renames every identifier `<old>` of
`src/` and `include/` (never a comment, a string or a character literal; the `INCLUDE_ASM` line included). It never runs
`romlift generate`: run it next, and the chunk file follows. It refuses, changing nothing, when `<new>` is already a
name of the project (an entry, an alias or a module of `romlift.toml`, or a name the generated files use, such as a
default `unk_…`, `gUnk_…` or `_0800…` label), when `<old>` names nothing, or when a file it cannot edit names `<old>`:
a symbolic link (an edit would replace the link with a file), a file that is not UTF-8 text, or a binary. It warns
(`W_RENAME_SKIPPED`) of every other such file it left alone.

**Entries named by library signatures.** romlift recognises library code (m4a, libgcc, the BIOS call stubs, …) by its
bytes and names it: such an entry of `[functions]` or `[symbols]` carries `from = "sig:<library>@<version>"`, and the
library gets an `asm` module of its own (`[[modules]]` with `library` and `version`). Every `romlift generate` checks an
entry with `from` against the code it finds (a warning, `W_LISTED_INVALID`, when they disagree); the TOML still
decides. Rename such an entry like any other: the rename drops its `from`. `npx romlift analyze --update --write`
renames only entries that still carry a default name, so a name you gave is never replaced.

Write decompiled C in `src/<module>.c` itself, or in a `src/*.c` file directly under `src/` that it `#include`s at
file scope (romlift reads that file, and the `src/*.c` files directly under `src/` it includes, as part of the module:
their C and their `INCLUDE_ASM` lines). romlift
never edits an included file: when a `romlift.toml` edit means an `INCLUDE_ASM` line in it must go or be renamed, it
refuses (`E_C_FRAGMENT_STUB`, naming the file), and when a new line's place in ROM order lies inside it, it refuses
too (`E_C_STUB_UNPLACED`); change the included file yourself, then run `npx romlift generate` again. romlift reads no
other file: when `src/<module>.c` includes one of another name (`#include "part.inc"`, a file in a subdirectory of
`src/`, any quoted include but a `.h`), `romlift generate` refuses to add an `INCLUDE_ASM` line to it
(`E_C_STUB_UNPLACED`), since that file may define the function. Never `#include` another module's source: `make`
compiles it on its own, so its functions would be built twice, and `romlift generate` refuses
(`E_C_MODULE_INCLUDED`), even under `#if 0`. To make an included file a module of its own, remove its `#include` in
the same step as you add the module to `romlift.toml`; `romlift generate` then gives the file the new module's
`INCLUDE_ASM` lines and, unless the file gets `INCLUDE_ASM` from its own lines, from a `src/*.c` it includes or from a
header either includes (one that `#define`s it or includes `include_asm.h`, at any depth), that header, which its old
lines took from the file that included it. romlift finds a header as the Makefile's `cpp -nostdinc -I include` does,
symbolic links included: `#include "…"` in the including file's own directory first (the directory the file was
opened in, its links followed, so a `..` in a header behind a linked directory leads to the parent of the link's
target), then in `include/`; `#include <…>` in `include/` only. It reads every file under `include/` and every `.h`
under `src/`, through a linked `include/` or a linked directory under it or under `src/` too, and through a link to the
project directory, to one of the link's own parent directories or to a directory above the project only the files an
`#include` names. It does not evaluate an `#if` around an `#include`, an `#include` spelled with a macro, or an include directory
you add to `CPPFLAGS`. When a header that romlift does not reach for one of these reasons defines `INCLUDE_ASM` and
romlift adds `#include "include_asm.h"` anyway, `make` stops in the assembler (`Macro … was already defined`): delete
that line (romlift adds it only to a file that has no `INCLUDE_ASM` line left of its own, as a rename leaves it).

To rename a `c` module, change its `name` in `[[modules]]` and move its source in the same step
(`git mv src/<old>.c src/<new>.c`), then run `npx romlift generate`: it replaces the file's
`INCLUDE_ASM("asm/nonmatchings/<old>", …)` lines with the new directory's and keeps your C. It adds
`#include "include_asm.h"` only when the file gets `INCLUDE_ASM` neither from its own lines nor from a `src/*.c` it
includes nor from a header either includes, found as the paragraph above says: a `global.h` that defines the macro and
includes `macros.inc` itself is left alone, since a second `macros.inc` would stop the assembler. Renamed in
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

## Comparing a function with objdiff

`romlift generate` writes, for each module, `expected/<module>.s` (the module as its build unit assembles it: a C
module's generated `.s` files, every function as `INCLUDE_ASM` would include it) and `expected/rom/<module>.s` (its
bytes in the ROM). `make expected` assembles both and writes the ROM's bytes over the first object, keeping its symbols
and relocations: `expected/<module>.o` is the target object, whatever you have decompiled, and
`objdiff.json` lists one unit per C module, in ROM order, with that target and the object `make` builds from
`src/<module>.c`, `build/src/<module>.o`. Open the project in objdiff (or run `objdiff-cli`) after `make expected`: it
runs `make build/src/<module>.o` itself before each diff (`build_base`), never `make expected` (`build_target` is
false), so run `make expected` again after a `romlift generate` that changed `expected/`. Before you change anything,
objdiff scores every function at 100% but those with a jump table or a call to the function right after them, where it
reads the original bytes of a relocated word as an offset (a few in most projects); compare those by eye.

## Code that runs from RAM

Some code is copied from the ROM to RAM and runs there (m4a's `SoundMainRAM`, an interrupt handler). romlift does not
find it by itself: declare each such range in `romlift.toml` by hand, with its load address in the ROM, its size and the
address it runs at,

```toml
[[overrides]]
start = 0x0804F318
size = 0x3A4
kind = "code"
mode = "thumb"
runs_at = 0x03000388
```

then run `npx romlift analyze --update --write` (it adds the module borders the range needs: a range that runs from RAM
is a module of its own, `ram_<RUNADDR>`) and `npx romlift generate`. The linker script places that module at its run
address, loaded at its ROM address, and defines `__load_<module>`, its load address, which the code that copies it
names. `runs_at` must lie outside the ROM and away from every other range's run addresses, keep its ROM start's word
alignment (`runs_at` minus `start` a multiple of 4) and end inside the 32-bit address space; `romlift generate` refuses
anything else with `E_OVERRIDE_INVALID`. No function or symbol may be named `__load_<module>`, the linker script's name
for a range's load address.

## Data defined in C

The linker script places the code (`.text`) of a C object. A C file that defines data (a `const` array, a string table,
an initialised or zero-initialised global) fails the link with:

```
src/<module>.c defines data; see AGENTS.md (only read-only data is placed, in a data range: data_start)
```

unless its module declares a **data range**: the bytes from `data_start` to the next module's start (or the ROM's end)
are then that C file's read-only data, and a `const` array defined there replaces its slice of the ROM. Declare it in
`romlift.toml` on the `c` module whose C defines the data, then run `npx romlift generate`:

```toml
[[modules]]
name = "main"
start = 0x080000F4
kind = "c"
data_start = 0x0800014C
```

`data_start` must be word-aligned, lie past the module's start and in the data at the end of the code (`romlift
generate` refuses an address where code lies, inside a module that runs from RAM, or overlapping another module's
range, with `E_DATA_RANGE_INVALID`), and the range cuts only its own module or a `data` module: a `data` module starting
at `data_start` is dropped, one that holds it ends there. The linker script then places `src/<module>.c`'s `.rodata` at
`data_start` and checks that it is the range's exact size:

```
src/<module>.c's read-only data is not the <size> bytes of its data range [<data_start>, <end>); see AGENTS.md
```

So the C file must define every byte of the range, in ROM order, with nothing between: no generated file holds those
bytes any more. Every label of the range that assembly still names (`gUnk_<ADDR>`, or its `[symbols]` name) must be a
symbol of that C file, under the same name. Data the C file puts in RAM (initialised or zero-initialised globals) still
fails the link with the first message: keep it in assembly and refer to it by its symbol (`extern`).
