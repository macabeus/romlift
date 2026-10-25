# c-data (phase 4, g4.c-data-fails-loud; phase 6, g6.c-data-ranges; architecture §6.6, §8.1, D21, D92). One C
# source whose functions read a const halfword table, which the link puts after all the code: the ROM has one C
# module, main, and a data tail. `init`, `setup.sh` and `make` reach the SHA-1 (the table stays in the data
# module); the overlay, overlay/src/main.c, is the module decompiled as a decompiler writes it, with the table
# defined in C as a `const` array. Without a data range the link must fail with the ldscript's ASSERT that names
# src/main.c (g4.c-data-fails-loud); with main's data range at the table, expect-ranges.json's `data_start`
# (measured from build/c-data.elf: sPrices, 16 bytes at 0x0800014C, the ROM's last bytes), the array from
# build/src/main.o replaces its ROM slice and the build reaches the SHA-1 (g6.c-data-ranges).
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := c-data
SRCS := main.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
