> This is the proof of concept's own README, copied verbatim from `/Users/macabeus/ApenasMeu/decompiler/romlift-poc/README.md` and kept as the record of its rules, numbers and lessons; the PoC itself lives outside this repository and is not part of it.

# romlift proof of concept

A quick, throwaway TypeScript port of the plan's analysis engine: given a GBA ROM and nothing else,
recover the function entries, then score them against the `FUNC` symbols of an ELF that rebuilds the
same ROM and explain every miss. It exists to validate the idea and to find what is still missing on
the way to 100% of the function entries. `init` also scaffolds a project that rebuilds the ROM
byte-for-byte, with every function emitted as raw bytes (readable instructions are the next step).

```sh
npm install
npm run romlift -- score ../kleod/baserom.gba ../kleod/kleod.elf -v --cfg ../klonoa-empire-of-dreams/functions_merged.cfg
npm run romlift -- analyze some.gba
npm run romlift -- init some.gba out/        # scaffold: decomp.yaml, romlift.toml, one raw .s per function, Makefile, ldscript
npm run romlift -- generate out/ [--rom x.gba]  # regenerate asm/ + romlift.toml from decomp.yaml; --rom for a worktree without the ROM
npm run romlift -- signatures some.gba -v    # what the library signatures in signatures/ recognise: modules, names, data
npm run romlift -- signatures build signatures/specs/m4a.json   # rebuild a library's signature file from its reference checkouts
cd out && make                               # rebuilds some.gba and checks its SHA-1
```

Layout: `src/rom.ts` (bytes), `src/thumb.ts` and `src/arm.ts` (control-flow decoders),
`src/analysis.ts` (descent, `bl` verdicts, validity, evidence, pointer harvest, gap scan),
`src/elf.ts` and `src/truth.ts` (ELF symbol readers), `src/score.ts` (precision, recall, miss
diagnosis), `src/signatures/build.ts` and `src/signatures/apply.ts` (library signatures: build from
reference projects, apply to a ROM), `src/emit.ts` (tiling into chunks and modules, raw emission,
the scaffold), `src/cli.ts`. `signatures/<library>.json` are the built signature files, one per
library with its versions inside, `signatures/specs/*.json` their build specs.
`ROMLIFT_TRACE=1` prints every acceptance in order; `ROMLIFT_TABLES=0` and `ROMLIFT_ARMSCAN=0`
switch off the two rules named below.

## Results

Each ROM is judged by its own matching ELF, built from the checkouts at these commits: kleod
(unchanged), sa2 `393357f7c` (2026-07-21), sa3 `59df6083` (2026-10-16), FireEmblem7J `f27a029`
(2026-09-29), pokeemerald `731ad5bfd` (2026-10-01). Values are precision / recall of function entries
after the startup region (the cartridge entry, the interrupt entry and what they name with `adr`),
which is scored as one unit because each project types its labels differently: kleod makes three of
them `FUNC`, Emerald none.

| ROM | ELF functions | Plan's prototype | This PoC, all rules | Missed | False |
| --- | --- | --- | --- | --- | --- |
| Klonoa (kleod) | 559 | 99.63% / 94.66% | 99.82% / 99.46% | 3 | 1 |
| Sonic Advance 2 | 2,892 | 99.83% / 99.10% | 99.79% / 100.00% | 0 | 6 |
| Sonic Advance 3 | 4,693 | 99.89% / 99.45% | 99.87% / 100.00% | 0 | 6 |
| Fire Emblem 7 (J) | 7,735 | 99.82% / 99.47% | 99.86% / 99.86% | 11 | 11 |
| Pokémon Emerald | 15,856 | 99.96% / 99.78% | 99.96% / 100.00% | 0 | 6 |

Run time: 1 to 2 s per ROM, 7 s for Emerald, 19 s for sa3 (the gap walker waits for anchors over
several passes; this is unoptimised). The extent of a found function equals the ELF's size for
99.96% of the sized functions (24,995 of 25,005).

## The 14 remaining misses are not function starts

`score -v` prints each miss with the test it fails. All 14 fall inside a function this PoC did find,
and the bytes say they are labels the decomps chose to type as `FUNC`:

- Klonoa's `sub_0804F378`, `sub_0804F3A6` and `sub_0804F698` lie inside `SoundMainRAM` (932 bytes
  from `0x0804F318`, the same extent sa2, sa3 and Emerald give it). Those three ELFs do not type the
  same offsets as functions.
- FE7J's eleven (`sub_800D484`, `sub_8064AD0`, `sub_8010DC4`, ...) begin right after a
  `bl _call_via_r0` (libgcc's `bx r0` thunk, which returns normally), at a loop's `bne`, or inside
  the mixer, and use registers set by the code before them. FE7J's own disassembler split its
  functions after the thunk calls and the repo kept the split; they are continuations, not entries.

Reaching them would mean declaring a new function after every call, which splits real functions
everywhere else. Library signatures for m4a, as below, are the honest way to carry such labels.

## What was added to reach this

Each rule names the evidence it rests on; the plan's analysis section should absorb them.

| Rule | Why | What it recovered |
| --- | --- | --- |
| Pointer-table evidence: a valid candidate pointed at by a run of three or more Thumb pointers to valid targets | Leaf handlers have no prologue and anchor nothing; the table is the only reference | the m4a `ply_*` handlers on every ROM |
| A branch into another function leaves the current one, and counts as a return | A function is one contiguous run; hand-written code shares tails | `ply_rept`, `MP2K_event_patt`, ARM `PutOamLo` |
| A `swi` followed by non-code, and a `mov pc, rN` with no table, end the function | BIOS resets and callbacks through a register | `SoftReset`, `VBlankIntr`, the GameCube multiboot handler |
| A function's extent is its code plus adjacent pools; far pools are claimed but not part of it | Hand-written code loads pools hundreds of bytes away | `m4aSoundVSync`, `MPlayMain` |
| Density counts zero padding before a pool word as covered | agbcc pads each pool to a word boundary | `Cmd_getsecretpowereffect` |
| Tiled hole: the Thumb reading of a gap's first bytes that ends where the next function starts is accepted even when it is not dense or its stack is unbalanced; the gap waits for that anchor before anything else is taken from it | Mixers keep ARM blocks and tables inside a Thumb function | `SoundMainRAM` on all five ROMs |
| ARM gap scan: an ARM function opens with an unconditional, non-branch instruction, may keep pool words and a table it refers to in front of it, and may keep internal holes when it fills its gap | Hand-written ARM puts pools before the code and dispatches through branch tables | the heap, OAM and map-flood routines |
| An ARM reading is preferred over a prologue-less Thumb reading of the same bytes | Pool words and ARM opcodes decode as Thumb pairs | avoids 14-byte Thumb stubs in front of ARM functions |
| A run of Thumb code pointers decoded as instructions is a table | Instruction pairs rarely form in-ROM odd pointers | a 146-byte false entry in Emerald's script tables |
| A tiny unreferenced candidate must be anchored at its start and not open with a branch | `bx lr` stubs are real; `b` fragments after a jump table are not | ten 2-byte false entries in FE7J |
| Candidate readings are recomputed each round | A reading goes stale as neighbours get accepted | the Emerald mixer's end anchor |
| The bytes a dense function's walk never reached inside its extent are claimed as its dead code | A compiled function is contiguous; a branch arm nothing jumps to is still its bytes | a 4-byte false entry inside FE7J's `IsMuActive` |
| A block at the start of a gap that the function before it names with `add rd, pc, #imm` and that leaves only by branching back into that function is merged into it | Hand-written interrupt handlers store local blocks as callbacks | Emerald's six GameCube multiboot handlers, and that function's extent now matches the ELF |
| The startup region (entry, interrupt entry, what they name with `adr`, contiguous from the ROM start) is one unit: `asm/crt0.s` in the scaffold, excluded from entry scoring | Every project lays it out as one crt0 file and types its labels by its own convention | 11 "false" entries across the five ROMs that were only a typing convention |

## Library signatures: a library's names without teaching the engine about the library

The analysis stays engine-agnostic: it sees bytes and the architecture, nothing else, and the
numbers above are its numbers. What it cannot know is that 3% of Klonoa's code is Nintendo's m4a
sound driver, that the four-byte functions after it are libagbsyscall's BIOS call wrappers, and
that the division routines are libgcc's. Every GBA decomp learns that by hand and gives the same
functions the same names. Library signatures carry that knowledge as data, the way IDA's FLIRT,
Ghidra's Function ID, Binary Ninja's signature libraries and decomp-toolkit's SDK signature
database do for their targets: a known function as a masked byte pattern plus its name. `init` and
`generate` apply them through the override channel the TOML already has, adding names, extents and
module borders on top of the analysis, never a rule to it. `--no-signatures` switches it off.

**One file per library, never per game.** `signatures/m4a.json`, `signatures/libagbsyscall.json`
and `signatures/libgcc.json` each hold the library's versions; a library that shipped in several
revisions has one version per revision. m4a has two: `2001`, the bytes Klonoa, Sonic Advance 2 and
3 and Fire Emblem 7 link (`m4a0.o` of 0xC1C bytes, `m4a.o` of 0x1598), and `2004`, Emerald's
(0xF80 and 0x1890). No source carries an SDK revision label, so the id is the earliest known
release that ships those bytes, and the spec says so. libagbsyscall and libgcc have one version
each (`agb`, `agbcc`).

**Building a version.** `signatures build signatures/specs/<library>.json` takes, per version, one
or more reference projects whose ELF rebuilds their ROM (the checkout, its ROM, ELF and linker map,
and which linked objects are the library: `src/lib/m4a/*.o`, `libagbsyscall.a(*)`, `libgcc.a(*)`,
plus the names of the data tables). For each FUNC symbol in those objects it records the symbol's
bytes with a mask over what the link changes: the targets of `bl` and of branches that leave the
function, and every aligned word outside instructions that looks like an address (RAM, ROM). A
data table is recorded whole; a table of function pointers also records which functions its words
name. References merge by symbol name, so a reference that links more of the library adds the
members the first one lacks: libagbsyscall is the union of four projects' wrappers (22), libgcc of
three projects' members (69, with `fp-bit`, `__ashrdi3`, `__ashldi3`). The references stay in the
file as provenance only; a signature file knows nothing about any game.

**Applying them.** A signature is placed by evidence, strongest first: it has at least 12
unmasked bytes and fits at exactly one place in the ROM; or it is one of a run of neighbours in one
reference's link order that tile the ROM contiguously (a 4-byte `swi; bx lr` wrapper alone is
nothing, eleven of them in order are libagbsyscall); or it fits at the spacing the reference link
gives it from a neighbour already matched, right next to one, or at the only place within 64 bytes
of one; or both matched neighbours agree on where it must be and it fits there except for one or
two words, which are the constants the game passes to the library (`m4aSoundInit`'s sound mode and
player count, reported in the TOML); or, for a short member another reference contributed, it is
the only fit within 64 bytes of anything matched of that version. Spacing and order only mean
something between members of the same reference; this use of link order is what sets these apart
from per-function FLIRT-style matching. A pointer table is accepted only when every word that
names a matched function points at it. Where two versions or two libraries claim the same bytes
the one that matched more there wins, decided per module, because sa3 links the 2001 m4a next to
the libgcc members Emerald has.

**What it changes in the scaffold.** The functions get the reference's names in `romlift.toml`
(`0x0804F294 = { name = "SoundMain" }  # m4a 2001`), the extent of a function the analysis split
is restored (the mixer's ARM loops fold into `SoundMainRAM` as local labels, `umul3232H32` is one
unit again, the `bx r3` stub that the ELFs keep untyped becomes `chk_adr_r2`), the data tables are
labelled in `data/data.s` and listed in a `[data]` table, and each library becomes a module of the
project: `asm/m4a.s` with `asm/nonmatchings/m4a/MPlayStart.s` and so on, between the game's own
`main`, `main_2`, ... modules, in `ldscript.txt`, which is now generated; its `[[modules]]` entry
carries `library` and `version`. A border must be a word-aligned chunk start, because the linker
word-aligns every object. The TOML names win over the signatures' once edited, so a rename
survives `generate`, and a function the signatures know that the analysis missed is accepted as
given, like a hand-added entry.

**Judged by the same ELFs.** The benchmark scores the analysis first and the signatures after, so
library knowledge never flatters the agnostic numbers. For the signatures it checks that every
matched function starts where the ELF has a FUNC symbol (or at an address the exception list
already calls untyped code), that every matched table is an OBJECT of that size or at least a label
there, and it reports extents and names. Names are not gated: each project has its own convention
(`ply_fine` in Emerald and FE7J, `MP2K_event_fine` in sa2 and kleod), and a signature carries its
reference's. All five scaffolds still rebuild byte-for-byte with the library modules in place, and
`generate` reproduces them.

| ROM | m4a (version) | libagbsyscall | libgcc | tables | Entries not in the ELF | Names agree / differ | Extents |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Klonoa | 94 (2001) | 6 | 20 | 10 | 0 (1 listed untyped: `chk_adr_r2`) | 116 / 0 | 78 / 78 |
| Sonic Advance 2 | 94 (2001) | 12 | 24 | 10 | 0 | 130 / 0 | 126 / 127 |
| Sonic Advance 3 | 94 (2001) | 13 | 65 | 10 | 0 | 169 / 2 | 165 / 169 |
| Fire Emblem 7 (J) | 94 (2001) | 18 | 22 | 10 | 0 (3 listed untyped) | 67 / 64 | 22 / 22 |
| Pokémon Emerald | 109 (2004) | 15 | 67 | 10 | 0 | 189 / 1 | 187 / 188 |

The one word in which Klonoa's `m4aSoundInit` differs from sa2's is the sound mode; FE7J's differs
in that and the player count. The extent that differs on sa2, sa3 and Emerald is `ld_r3_tp_adr_i`,
whose ELF size (1,822 bytes) is a symbol-table quirk; the name that differs on sa3 and Emerald is
the second `_fpadd_parts`, a static that `fp-bit.o` and `dp-bit.o` both define and the signature
file has to suffix. FE7J's 64 differing names are its own convention (`ply_patt`, `MPlyJmpTblCopy`,
`TrackStop_rev01`), and its tables are matched at the addresses its ELF only labels `gUnk_`.

## What the false entries are

- Linker veneers in FE7J (six, 4 bytes each), which the ELF does not type as functions.
- Local subroutines of the hand-written sound engine reached by `bl` (`bx r3` thunks, 2 to 8
  bytes), and the ARM mixing loops inside `SoundMainRAM`. They are code; the ELFs fold them into
  their parent. The scaffold would emit them as separate `.s` units, which is harmless.
- FE7J's `0x080889FC`, a real 34-byte leaf function the ELF only gives a local label.

Each is listed with a category in `bench/dataset/real/<rom>.json`, and the run reports a listed
exception that it no longer needs, so the lists stay exact.

## The scaffold

`init <rom> <outdir> [--name <build name>]` tiles the code region into one chunk per function (an
entry inside another function's extent is folded into it as a local label, and the bytes between
functions become `unk_XXXXXXXX` chunks), draws the module borders (crt0, the game's code, each
library the signatures matched), then writes:

- `asm/nonmatchings/<module>/<name>.s`: the chunk's original bytes as `.2byte`/`.4byte` data under
  a `thumb_func_start` / `arm_func_start` label, pool words and table entries one per line;
- `asm/<module>.s`, which includes them in ROM order; `asm/rom_header.s`; `asm/crt0.s` with the
  startup region's pieces under their own labels; `data/data.s` with one `.incbin` per stretch of
  the data region and a label on every known data symbol; `ldscript.txt`, generated from the
  module list;
- `Makefile` (needs only `arm-none-eabi-as`, `ld`, `objcopy`; `ld` also writes the `.map`; it
  assembles whatever `asm/<module>.s` exist), `baserom.sha1`, `romlift.toml`, `decomp.yaml` and
  `.gitignore`. `make` rebuilds the ROM and checks the hash.

`decomp.yaml` is the [decomp_settings](https://github.com/ethteck/decomp_settings) file every
matching tool reads from the project root. `init` fills it from the cartridge header (name from the
title, version from the game code's region letter, the ROM's SHA-1) and the build names, and
writes two tool blocks: `tools.asmlift` (`target: agbcc`, the built ELF as symbol source, and a
candidate-compile template for `--score-against`, which needs agbcc built into `tools/agbcc`) and
`tools.romlift` (`config: romlift.toml`, this tool's own block, checked with a `z.strictObject`
through `toolBlock`). The text is parsed back through `@match-kit/decomp-yaml` before it is written,
so a file `init` produces always meets the spec.

`generate [<dir>] [--rom <rom.gba>]` is the other half: it finds the nearest `decomp.yaml` from
`<dir>` (default: the working directory) with `searchDecompYaml`, reads `tools.romlift.config` and
`versions[].paths.target`, checks the ROM's SHA-1 against the version's, re-runs the analysis and
rewrites the generated tree only (`asm/`, `data/data.s`, `ldscript.txt`, `romlift.toml`), removing
stale function files first. The TOML is read before that: a renamed entry names the `.s` file and
label, an address the analysis did not find becomes a function anyway (it splits the function it
lands in), and a `[data]` entry labels a data symbol. The rewritten TOML keeps all of it, so a hand
edit survives the next `generate`. A git worktree has no
`baserom.gba`, since the ROM is never committed: `generate --rom <path>` points at one, and the
SHA-1 check still applies. Running `generate` on a freshly scaffolded project reproduces the
committed tree byte for byte (`git status` stays clean).

All five ROMs rebuild byte-for-byte (`make` prints `<rom>.gba: OK`), and again after a `generate`
in place, which the benchmark's scaffold check now runs: Klonoa 551 functions and 70 gaps in six
code modules, sa2 2,892 and 447, sa3 4,696 and 868, FE7J 7,729 and 1,541, Emerald 15,856 and 3,205
(fewer than the entry counts because the library signatures fold split pieces back together). Since every chunk
is data, the match proves the tiling, the linker script and the scaffold, not the disassembler:
that is the plan's phase 1, still to do. There are no C stubs yet either, because compiling them
needs agbcc in the scaffold.

## Scope

- Raw emission only: the `.s` files hold bytes, not instructions.
- Rules are tuned on these five ROMs. Nothing here is a held-out score; the plan's phase 2 gate on
  unseen ROMs still applies.
- `src/analysis.ts` is a direct port of the Python prototype plus the rules above, not the layered
  design.
