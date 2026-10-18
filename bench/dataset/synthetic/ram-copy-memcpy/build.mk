# ram-copy-memcpy (positive; code copied to IWRAM by a copy with memcpy's argument order). main copies the
# block RamBlock..RamBlockEnd to 0x03000000 with CopyBytes(dest, src, n) (agbcc C) and reaches IwramDouble
# and IwramTriple only through veneers that name their IWRAM addresses. seed.ram-copy reads the copy's
# roles off what CopyBytes does: it loads through its second argument and stores through its first, and
# counts its third down by one per byte stored; a rule that took r0 for the source would see no IWRAM
# destination and lose the block, which is the last code in the ROM.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-memcpy
SRCS := main.s copy.c block.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
