# Research notes

> Exported from the Research notes tab of the Claude Docs artifact <https://claude.ai/code/artifact/7963dcce-e818-490a-a959-ca96941bdc23> (revision 2, 2026-10-17). "This repo" / "this repository" in the text means the Klonoa decomp repository (klonoa-empire-of-dreams), where the notes were written.

Source-level findings behind the plan. Paths are in this repository unless a section says otherwise.

## `generate_asm.py`, step by step

The script runs Luvdis once and then repairs its listing as text. It is 2,996 lines at `693ccb7` and 3,199 on `origin/main`.

| Step | What it does | Why the step exists |
| --- | --- | --- |
| 1 | Checks the ROM against a hard-coded SHA-1 | Guard |
| 2 | Runs Luvdis with the cfg, `--default-mode THUMB` and `--stop 0x08052000`, then rewrites `FUN_xxxx` names to `sub_XXXX` | Luvdis drops the address comment for `sub_` names, and later passes parse that comment |
| 3 | Writes the 192 header bytes as `asm/rom_header.s` | Luvdis prints the header as code or bytes |
| 4a | Splits the listing at function macros, splits again at "return, padding, `push {lr}`" and at short leaf shapes, then merges pieces that do not end in a return | Luvdis tracks no function ends, and the cfg is wrong in both directions |
| 4b | Turns instructions back into data, first by pointer shape, then by PC-relative load, assembling before and after each rewrite | Luvdis decodes unreached bytes as Thumb |
| 5 | Adds and removes `INCLUDE_ASM` lines in `src/*.c` | The function set moves when a heuristic changes |
| 6 | Applies per-ROM fixups: one dead patch, misplaced pool words, two `.global` labels | Hard-coded addresses |
| 6.5 | Restores `.2byte` branches where the address can be checked against the ROM | Luvdis prints a branch raw when its target has no label |
| 7 | Downgrades absorbed function macros to plain labels | Fragment merging |
| 8 | Renames by string replacement in `.s` and `.c` files | The TOML `[renames]` table |
| 8.5 | Rewrites loads to `.inst.n` in functions that do not start on a 4-byte boundary | `as` rejects a misaligned pool target |
| 9 | Emits everything from `0x52000` as one `.incbin`, and moves decompiled functions to `asm/matchings` | Data is not analysed |

Of the script's 58 functions, 5 are never called (553 lines) and one more pass is disabled. The 660 `[[data_regions]]` entries in the TOML are only tested for presence (`scripts/generate_asm.py:1420`). The script was 426 lines in the first commit and has been touched by 42 commits across all branches, 22 of them on this branch.

## Luvdis

Luvdis is a Thumb-only disassembler: a linear sweep, then emulation of each function. The copy in `tools/luvdis` is 0.8.0 at `53e5f4a`, last changed in June 2021. References are to `tools/luvdis/luvdis/`.

| Topic | Behaviour | Effect on this ROM |
| --- | --- | --- |
| Instruction sets | Thumb only. `arm_func` lines are parsed and dropped (`config.py:34`) | Startup code comes out as `.byte` |
| Discovery | Config entries are always accepted. Otherwise: `bl` targets inside accepted functions, and `push {.., lr}` sites called at least twice (`analyze.py:438`) | 3 functions added to the 653 Thumb entries given |
| `bl` | Always returns (`analyze.py:490`) | A far-jump target becomes a function or a label |
| Returns | `bx` through the saved `lr` counts. `pop {.., pc}` never does, because of a 24-bit mask (`analyze.py:508`) | Code built without interworking would be rejected |
| Function ends | Not tracked (`analyze.py:540`) | Splitting needs a second tool |
| Literal pools | Only the word a PC-relative load reads, in walked code (`analyze.py:471`) | 4,130 of 14,211 loads stay numeric |
| Jump tables | None (`analyze.py:510`) | 74 `mov pc` sites; tables and cases fall to the default mode |
| Unlabelled targets | The branch is printed as `.2byte` with the mnemonic in a comment (`analyze.py:668`) | 3,597 raw branches before repair |
| Pool symbols | Only an odd value that hits a known function (`analyze.py:701`) | Data addresses stay numeric |
| Round trip | Of 65,536 halfwords, `as` rejects 33 and assembles 17 to other bytes | Harmless on compiler output |
| Cost | 6.8 s and 74 MB here, from about 3.15 million decodes for 165,000 instructions | No caching of decoded paths |

Its acceptance test emulates registers and a stack with a sentinel in `lr`. That idea is sound, and the plan keeps a lighter form of it as the stack-balance rule.

## gbadisasm

gbadisasm is a 940-line C tool: typed labels, a worklist, and one linear sweep per label through Capstone 3.0.5. Upstream last changed in January 2020. `D:` is `disasm.c` at `e35982b` of camthesaxman/gbadisasm.

| Topic | Behaviour |
| --- | --- |
| Config | `arm_func` and `thumb_func` with an address and a name. Entries are hints: a plain branch to one removes its function status (`D:441`) |
| Reach | Direct branches only. A `bx` target is followed only when `ldr`, `adr` or `add rX, pc` comes directly before it (`D:483`) |
| Far jumps | A `bl` ends the sweep and demotes its target when a pool label or a zero halfword follows it (`D:430`) |
| Functions | There is no function object. A function is a `bl`-type label, and its size is the bytes swept (`D:537`) |
| Pools | One 4-byte label per PC-relative load, printed as `ldr rX, _ADDR @ =value` (`D:601`) |
| Jump tables | Thumb only: `lsl`, `ldr [pc]`, `add`, `ldr`, `mov pc`, with one stray instruction allowed (`D:207`). The table runs until its first case |
| Output | Stops after the last label (`D:910`). It omits `.syntax unified` and the macro definitions |
| Round trip | Of 65,536 halfwords, 913 fail to assemble and 313 assemble to other bytes |
| On this ROM | No config: 1 function. `AgbMain` only: 22 functions. Full cfg: upstream aborts on an assert (`D:913`) |

The jiangzhengwenjz fork adds directives for labels, far jumps, pools, jump tables and data. It also bounds a sweep at the next label, follows `bx pc`, and sizes ARM tables from the preceding `cmp`. On this ROM it completes in 2.4 s and demotes 59 cfg entries to labels.

The far-jump test in gbadisasm depends on sweep order, which is what makes upstream abort here. The plan decides the same question from the finished control-flow graph instead.

## What this ROM contains

Each item is a case that defeats a simple disassembler. Numbers are from the prototype unless a source is named.

- **Far jumps.** 560 `bl` instructions are jumps, in 17 functions. The function at `0x0800D188` is 28,668 bytes with its trailing pool, 28,652 without. The larger figure equals kleod's unit `code_0800D188.o`.
- **Entries with no direct caller.** 274 of 534: 53 were found through a literal-pool pointer, 156 through a data table and 65 by the gap scan.
- **Jump tables.** 67 tables with 3,219 entries. One 125-entry dispatch at `0x08003FA4` has ten instructions between the table read and `mov pc`.
- **End of code.** `0x08051BD4`. The script's `0x08052000` turns 1,068 bytes of data into Thumb instructions in `asm/libgcc.s`.
- **ARM code.** Startup at `0x080000C0`, ARM routines up to `0x0800043C`, and Thumb-to-ARM veneers from `0x08051BA4` that begin with `bx pc`. Three of the ARM routines are unreferenced.
- **Code run from RAM.** `m4aSoundInit` copies `0x400` bytes from `0x0804F318` to `0x03000388`. The gba-kit trace also saw a DMA copy from `0x080000FC` to `0x02000004`.
- **Hand-written code.** The m4a mixer has entries at 2-mod-4 addresses and calls its own local subroutines with `bl`. libgcc returns with `mov pc, lr`.
- **Data inside code.** A 260-byte table at `0x08000318`, between ARM routines.
- **A call that never returns.** `swi 0` at `0x08051462`, followed directly by a pool.
- **Module starts inside units.** 7 of the TOML's 11 module starts fall inside one of the 34 units in kleod's linker map.
- **The curated list.** Judged by kleod's ELF, 283 of the 662 cfg entries are not functions, and 183 functions are missing from it.

## Defect history

The commits that shaped the lessons in the plan, oldest first. All dates are 2026.

| Date | Commit | Symptom | Root cause |
| --- | --- | --- | --- |
| 03-14 | `3bde0fb` | First commit: a 711-entry cfg merged from Ghidra and Luvdis, and a 426-line generator | The merge was done outside the repo and never validated |
| 03-15 | `be061fd` | "Functions" that fall through, real functions missing | The cfg was wrong in both directions; text heuristics were added to split and merge |
| 03-19 | `f2cb0dd` | Jump tables and pools printed as instructions | Luvdis decodes unknown bytes as Thumb |
| 03-20 | `fff33ed` | Thousands of branches emitted as `.2byte` | Luvdis prints raw bytes when a target has no label; 1,835 were restored |
| 03-20 | `c841d4c` | Alignment padding shifted code; `as` rejected loads | Fragments at 2-mod-4 addresses, so `non_word_aligned` macros and later `.inst.n` |
| 06-12 | `99b6a9b` | The ARM and Thumb mixer could not be generated | Thumb-only pipeline; `asm/m4a0.s` taken from kleod |
| 07-20 | `c9c6bcc` | The committed tree failed a clean build | A pool decoded as code looked non-returning and absorbed a C function |
| 08-07 | `c9340c7` | Non-pointer pool words stayed as code | Shape heuristics; the first fix moved 2.9 MB of ROM |
| 08-14 | `6be0678` | 1,454 ROM bytes were in no `.s` file | A filter deleted a merged group it meant to fold |
| 08-14 | `ef51a03` | A pool printed as `.byte` plus a "dead code" stub | A cfg entry inside a literal-pool word |
| 08-15 | `cb86fb9` | 42 cfg entries pointed at data | The list was never validated |
| 08-15 | `8a118ac` | A live function was reported dead | 73 calls are emitted as `.4byte`, so the call graph missed them |
| 08-18 | `eed890c` | A "function" nothing calls | It was a `bl` far-jump target inside a 28,652-byte function |
| 09-05 | `7f0f076` | Byte-exact candidates scored non-zero in objdiff | Pool padding decoded as an instruction |

## What the review changed

An independent reviewer ran the first prototype on other ROMs and found it wrong in ways one ROM could not show. The plan and the prototype were revised before this version.

| Finding | Evidence from the review | Change |
| --- | --- | --- |
| Rules tuned on Klonoa failed elsewhere | On Emerald the first prototype reported 164 false entries, one of them a 786,034-byte "function" in read-only data, and put the end of code about 10 MB too far | Candidates now need the validity and evidence tests, and all five ROMs are scored |
| Alignment is not evidence of a far jump | Hand-written functions sit at 2-mod-4 addresses. One misread call grew a function to 1.5 MB | The alignment clause is gone. A `bl` closer than 1,536 bytes is always a call |
| A call followed by non-code is not always a jump | agbcc emits no epilogue after `abort()` | Such a call is marked as never returning, and the target decides between call and jump |
| Scores were self-graded | "329 of 329" counted only functions the prototype had found. "289 of 662" judged the cfg by the prototype's own rules | Scores now come from ELF function symbols: precision, recall and the misses |
| The acceptance test did not test the split | A single `.incbin` passes a SHA-1 check | Numeric gates on precision, recall, extents and unseen ROMs |
| `.4byte Symbol` is not always the same bytes | The linker sets bit 0 for a Thumb function, and Emerald has 125 even words equal to a function address | A word is printed by name only when the linker would produce the same value |
| Gaps in the scaffold | No home for C-defined data or for bytes outside functions, and no pinned tool version | Orphan-byte units, a data-range item in phase 5, and a pinned version |
| Internal contradictions | Milestone numbering, the `rename` exception, the macros path | Fixed in place |

The second prototype's remaining errors are listed per ROM in the Prototype tab.

## What the proof of concept changed

The TypeScript port was used to chase every remaining miss on the five ROMs. Each finding either became a rule or was classified as truth noise.

| Finding | Evidence | Change |
| --- | --- | --- |
| Leaf handlers with no prologue are reachable only from a table | The m4a command table is a run of 48 Thumb pointers; each handler ends in `bx lr` and anchors nothing | Pointer-table evidence |
| Hand-written code jumps into its neighbours | `ply_rept` branches into `MP2K_event_goto`; `PutOamLo` branches into `PutOamHi`'s loop | A foreign branch leaves the function and counts as a return |
| `SoftReset` is `svc 1; svc 0` then a pool | Its only caller, `VBlankIntr`, then read as "calls non-code" | `swi` before non-code ends the function |
| The GameCube multiboot handler does `mov pc, r2` with r2 loaded from a struct | No table exists | A register jump with no table is an exit, not an error |
| Hand-written mixers keep far pools and ARM blocks inside one Thumb function | `SoundMainRAM` is 932 bytes on four ROMs with the same layout | Extent limited to adjacent pools; tiled-hole acceptance; the gap waits for its anchor |
| ARM functions keep pool words and tables in front of them | `PutOamHi` loads `[pc, #-16]`; `DrawGlyph` sits behind a 32-byte mask table its pool points at; `MapFloodCore` behind a branch table | ARM gap scan looks ahead for a function that refers back to the skipped words |
| Pool words and ARM opcodes decode as plausible Thumb | 14-byte Thumb stubs claimed the front of ARM functions | An ARM reading is preferred over a prologue-less Thumb one |
| A pointer table decodes as Thumb with one `bx` in it | A 146-byte false entry in Emerald's script tables ending at a function | Runs of Thumb code pointers are rejected |
| A cached reading of a candidate ran past a neighbour accepted later | Emerald's `SoundMainRAM` end anchor was never seen | Candidate readings are recomputed each round |
| Some `FUNC` symbols are labels | FE7J's `sub_800D484` follows a `bl _call_via_r0` and uses r4 from the caller; `sub_8010DC4` starts at a loop's `bne`; kleod names three offsets inside `SoundMainRAM` | Classified as truth noise; a signature pack can carry such names |
| Updating sa3's checkout typed four former false entries as functions | 2 to 4 byte stubs at `080B2D88`, `080B2D8C`, `080B8CA8`, `080B6774` | The tool had them right; precision figures understate it |

Build notes for the benchmark checkouts on this Mac: sa2 and sa3 tool builds need Apple's `ar` first in `PATH` (Homebrew binutils makes archives Apple's `ld` rejects); sa2's checkout carried Linux ARM64 tool binaries that had to be rebuilt natively; `satr-agbcc/build.sh` fails on `old_agbcc` with gcc-13 but the main `agbcc` builds.

The kleod checkout (dataset `klonoa`) carries two uncommitted changes to its tracked `Makefile`, both needed to rebuild it on macOS and both recorded in the `buildNote` of `bench/dataset/real/klonoa.json`: `CPP` is `$(TOOLCHAIN)cpp`, the cross preprocessor, instead of `$(CC) -E`, because Apple clang defines `__APPLE__`, which selects the IDE-only branches of `include/global.h` and `include/gba/defines.h`; and the `asm/data/` pattern rule is moved before the `asm/` rule, because GNU Make 3.81 (the one macOS ships) takes the first matching pattern rule where later versions take the shortest stem, and `asm/data/` files must go through `preproc`. Neither changes the built bytes: the ROM matches the dataset's SHA-1. The other four tuning checkouts have no change to a tracked file.
