# false-stub-2byte (negative: zero entries beyond the real functions). The `b .Lcase1` after Choose's
# case blocks is a one-instruction candidate anchored after Choose's code. A tiny candidate must not open
# with a branch (accept.tiny-anchored-at-start), so the fragment is never an entry; `bx lr` stubs are.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := false-stub-2byte
SRCS := stub.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
