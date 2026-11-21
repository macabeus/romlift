# multi-compiler (phase 4, g4.multi-compiler; architecture §8.1, D47). Two C sources, one per C module:
# main.c is compiled by agbcc, old.c by old_agbcc with -mno-thumb-interwork. The compilers differ where
# old.c's leaves are: agbcc pushes lr in a leaf and returns with `pop {r1}; bx r1`, old_agbcc returns with
# `bx lr`; the flag makes old.c's one non-leaf return with `pop {pc}`. So old.c under agbcc alone, or
# without its flag, gives other bytes. `--module-size 0xA4` (expect.json init.args) closes the first C
# module, main, at OldMix, the first function of old.c, so each source is its own C module; the decompiled
# C of both is overlay/src/<module>.c, under the names `init` gives the functions.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := multi-compiler
SRCS := main.c old.c
OLD_AGBCC_SRCS := old.c
CFLAGS_old := -mno-thumb-interwork
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
