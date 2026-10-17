# bench/dataset/synthetic

The synthetic tier (architecture §8.1, D28): self-authored fixture ROMs, one phenomenon each, built
from our own assembly and C with binutils and pret/agbcc. Their builds are committed (a few KiB each;
`.gitignore` re-includes `*/build/**`), so unit, golden and gate tests read them with no toolchain;
`.github/workflows/fixtures.yml` rebuilds them on every pull request to prove they are reproducible.

## Layout

| Path | What it holds |
| --- | --- |
| `common/crt0.s` | The shared cartridge start: an ARM `b` at 0x08000000 over a GBA header that `checkRom` accepts (0x96 at 0xB2, the complement at 0xBD), then `start_vector` at 0x080000C0, which sets the stacks and calls `main` through a pool pointer with `mov lr, pc; bx r1` |
| `common/rom.ld` | The linker script: crt0 first, then the fixture's objects in `SRCS` order at the cartridge base; `.iwram` runs at 0x03000000 with its load address after the ROM code |
| `common/rules.mk` | The make rules every `build.mk` includes |
| `common/macros.inc` | `thumb_func_start`, `non_word_aligned_thumb_func_start`, `arm_func_start`, `func_end`, as romlift's dialect spells them |
| `<name>/build.mk` | `NAME`, `SRCS` (link order) and the toolchain record (`AGBCC_COMMIT`, `AS_VERSION`); its comment names the phenomenon and the rule the fixture makes decisive |
| `<name>/*.s`, `<name>/*.c` | The sources; C is compiled by agbcc `-O2 -mthumb-interwork -fhex-asm` without a preprocessor, so it holds no comments |
| `<name>/expect.json` | `{negative?, entries: [{addr, mode, extent?}], codeEnd?}`, frozen by `test/gates/g2.synthetic-analysis.test.ts` |
| `<name>/build/<name>.gba`, `.elf` | The committed build |

`common/` has no `build/common.gba`, so no fixture lister takes it for a fixture.

**Startup.** `_start` (0x08000000) and `start_vector` (0x080000C0) are the FUNC symbols of every
fixture's startup region, which ends at 0x080000F4. Like the bench on the real tier, `expect.json`
counts the ELF's functions from the end of the startup region on: its entries are exactly the fixture's
FUNC symbols at or after 0x080000F4 (a FUNC outside the ROM, such as code linked to IWRAM, is none).
An extent is the ELF size; where the size ends in padding that the walk does not reach (the `nop` after
`bx pc` in `bx-pc-veneer`), the extent stops before it, within the bench's 4-byte padding allowance.

## Commands

```
npm run fixtures -- rebuild [--only <name>] [--json]   # build into build/ and write the toolchain record
npm run fixtures -- check [--only <name>] [--json]     # rebuild into a temporary directory and compare
```

`check` compares the `.gba` bytes, the sorted `(name, value, size, type)` list of the ELF symbol table
and the toolchain record: an agbcc commit other than the record fails, a different `as --version` is a
note, and when nothing names the agbcc commit in use (no `ROMLIFT_AGBCC_COMMIT`, and the agbcc
directory is not a git checkout's top level) that is a note and the bytes decide. agbcc comes from
`ROMLIFT_AGBCC` (a directory holding `bin/agbcc`), else `$ROMLIFT_BENCH_ROOT/pokeemerald/tools/agbcc`;
binutils from the PATH. `rebuild` needs the commit named.

The committed builds were made with pret/agbcc `da598c1d918402c42c0c0d7128ba14567f3175e9` (master on
17 October 2026) and `GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126`.
The same bytes and symbol lists come out of binutils 2.43.1 (devkitARM) and 2.42 (Ubuntu 24.04 apt,
agbcc built on Linux), and of the agbcc installed in `pokeemerald/tools/agbcc`.

## The fixtures

The rule column names the rules the fixture is built to make decisive. Each was checked against a
copy of the proof of concept's analysis (`romlift-poc/src/analysis.ts`) with that one rule switched
off: an entry, an extent or the code end of that fixture moves. Two fixtures guard something a
whole-rule switch cannot isolate: `false-stub-2byte` the not-a-branch condition inside
`accept.tiny-anchored-at-start` (with the rule off no tiny candidate is accepted, so the fragment stays
out either way; `bx-lr-stub-chain` carries that rule), and `code-copied-to-ram` the code end.

| Fixture | Kind | Phenomenon | Rule made decisive |
| --- | --- | --- | --- |
| `far-jump` | positive | agbcc's `bl .L @far jump` over a 2.4 KiB body (C) | `bl.target-inside-caller` |
| `table-jump-hoisted` | positive | agbcc switch with a hoisted load before the bounds check (C) | `walk.table-nearest-pool-load` |
| `leaf-handler-pointer-table` | positive | three prologue-less handlers named only by a pointer table | `accept.pointer-table-run`, `seed.data-pointer` |
| `noreturn-call-then-next` | positive | `bl Fatal` to a noreturn function, zero padding, pool, next function (C) | `walk.noreturn-call-before-noncode`, `walk.trailing-zero-padding` |
| `bx-lr-stub-chain` | positive | unreferenced `bx lr` stubs tiling after a function | `accept.tiny-anchored-at-start` |
| `arm-pools-in-front` | positive | unreferenced ARM routine whose literals precede it | `gap.arm-scan` |
| `bx-pc-veneer` | positive | Thumb `bx pc; nop` into a two-instruction ARM body | `walk.bx-pc-veneer`, `seed.veneer` |
| `code-copied-to-ram` | positive | an ARM routine linked at 0x03000000, loaded after the ROM code; code end before it | (code end) |
| `swi-reset` | positive | `swi 0` followed by the pool | `walk.swi-before-noncode` |
| `shared-tail` | positive | `b` into another function's epilogue | `walk.branch-into-function` |
| `data-table-between-functions` | positive | halfword tables between functions, each followed by a function found another way | `seed.pool-pointer`, `accept.prologue-and-loaded`, `gap.end-anchor`, `gap.backward-prologue-chain` |
| `handwritten-2mod4` | positive | a trampoline at 2 mod 4 ending in `mov pc, r2` | `walk.mov-pc-without-table`, `accept.tiles-after-accepted` |
| `unreferenced-leaf` | positive | an unreferenced leaf after a called one (C); the suppressed split: without the rule, `Leaf` is missed, lies in no found extent and has no prologue, so the held-out classifier must call it `glued` | `gap.forward-chain` |
| `local-subroutine` | rule-specific | a helper inside its caller's extent, called with `bl` | `bl.near-is-call` |
| `pops-unpushed-frame` | rule-specific | far `bl` to the caller's own epilogue past a 1.6 KiB table; callees before the entry, with a prologue, and already accepted | `bl.target-pops-unpushed-frame`, `bl.target-before-entry`, `bl.target-has-prologue`, `bl.self-or-accepted` |
| `mov-lr-pc-bx` | rule-specific | ARM `mov lr, pc; bx r1` to an `adr`-named routine | `walk.mov-lr-pc-bx-is-call`, `seed.adr` |
| `adr-handler-block` | rule-specific | an `adr`-named block after the pool that branches back in | `gap.adr-block-absorb` |
| `dead-code-in-extent` | rule-specific | an unreachable stub-shaped block inside a function | `claim.dead-code-in-extent` |
| `prologueless-thumb-over-arm` | rule-specific | ARM `push {r4-r6, r8-r10, lr}` (0xE92D4770) reads as Thumb `bx lr` | `gap.arm-over-prologueless-thumb` |
| `mixer-tiled-hole` | rule-specific | Thumb mixers with ARM routines inside, filling holes | `gap.tiled-hole`, `gap.tiled-hole-inner` |
| `data-thumb-push-pop` | negative | five push/pop-shaped data records | `valid.calls-code`, `valid.decodes`, `valid.dense`, `valid.pool-not-code`, `valid.balanced-stack` |
| `thumb-pointer-run` | negative | four Thumb pointers decoding as shifts; a zero word before an unreferenced leaf | `gap.skip-padding-and-pointers` |
| `pool-word-push-lr` | negative | a far literal 0xBD00B500 (`push {lr}; pop {pc}`) | `claim.far-pools`, `valid.no-claimed-code` |
| `pool-padded-46c0` | negative | a pool after 0x46C0 padding whose word reads as a stub | `walk.pc-load-is-pool`, `claim.adjacent-pools` |
| `code-end-data-decodes` | negative | stub-shaped data after the last function; a `main` loop with no prologue | `seed.startup-pointer` (code end) |
| `false-stub-2byte` | negative | a lone `b` fragment after a jump table's cases | (the not-a-branch condition of `accept.tiny-anchored-at-start`) |

`seed.rom-entry`, `seed.call`, `walk.pc-load-is-pool` and `claim.adjacent-pools` move outcomes in
every fixture.

**Not made decisive here**, in the proof of concept's analysis: `bl.noreturn-before-noncode` (after
`walk.noreturn-call-before-noncode` ends the path, the verdict changes no entry, extent or code end),
`valid.in-rom-unclaimed` (a claimed entry's first instruction is claimed too, so
`valid.no-claimed-code` rejects it in the same check), `valid.not-pointer-table` (a run of Thumb
pointers whose reading returns must hold a pointer to an address `0x080047x0`, and every shorter suffix
of it then reads as a valid function), `accept.prologue-and-end-anchored` (the end-anchored gap scan
finds the same candidates), the seeds that need options (`seed.listed`, `seed.override`,
`seed.evidence-hint`) and `region.padding`, `region.data-after-code` (claims only). `g2.rule-coverage`
needs a fixture or a decision record for each.
