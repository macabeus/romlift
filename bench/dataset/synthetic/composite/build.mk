# composite (phase 4, g4.e2e-fixtures and g4.toml-mutations; architecture §8.1). Several phenomena in one
# ROM of several objects: C functions from agbcc in five sources, hand-written assembly between them that
# an assembly-only module must hold (a shared tail, a Thumb entry at 2 mod 4, a `bx pc` veneer into ARM),
# pools, calls and a callback pool word that cross module borders, a switch's jump table, and a data tail
# (menu.c's .rodata, linked after all the code). `init --module-size 0x200` (expect.json init.args) cuts the
# C code into several C modules with legal borders inside them; expect.json's illegalBorder moves one C
# module's start to a word-aligned address inside a function, which is no legal border, so `generate`
# fails with E_MODULE_BORDER.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := composite
SRCS := main.c math.c hand.s game.c menu.c sound.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
