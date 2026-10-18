# ram-code-entries (positive; code copied to IWRAM and linked at its load address). main copies the block
# RamBlock..RamBlockEnd to 0x03000000 through CopyWords(source, destination, size) and reaches IwramDouble
# and IwramTriple only through veneers `ldr r3, =<IWRAM address>; bx r3`. The block is the last code in the
# ROM, so without the copy nothing places a function there: seed.ram-copy maps the veneers' IWRAM pointers
# to IwramDouble and IwramTriple at their load addresses, which moves the code end over the block, and the
# ARM gap scan then finds IwramNegate, the block's unreferenced first routine.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-code-entries
SRCS := ram.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
