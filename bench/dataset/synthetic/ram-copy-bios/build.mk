# ram-copy-bios (positive; code copied to IWRAM by the BIOS). main copies block A with CpuSet in 32-bit
# units and block B with CpuFastSet, each through a `swi; bx lr` library stub, and reaches IwramDouble
# (block A) and IwramTriple (block B) only through veneers naming their IWRAM addresses. seed.ram-copy
# takes the size from the control word in r2 (its count times the unit, 4 bytes for both here, CpuFastSet's
# count rounded up to a multiple of 8 words: block B's 10 words move as 16; a fill would copy nothing): a
# rule that took r2 for a byte count would see a CpuSet of 0x04000004 bytes and lose block A, and block B
# would be cut at ten bytes.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-bios
SRCS := bios.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
