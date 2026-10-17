# bx-lr-stub-chain (positive; the plan's chain of `bx lr` stubs). DummyHookA-C are one- and
# two-instruction stubs that nothing references, each starting where the bytes before it end (give or
# take zero alignment). A tiny candidate is taken only anchored at its start and not opening with a
# branch (accept.tiny-anchored-at-start), proposed by the forward chain of the gap scan.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := bx-lr-stub-chain
SRCS := stubs.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
