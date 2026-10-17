# unreferenced-leaf (positive; the plan's unreferenced leaf, and the suppressed-split fixture of D25).
# agbcc emits Leaf, which nothing calls or names, right after the called First; it has no prologue and
# starts where First's bytes end. Only the forward chain of the gap scan finds it (gap.forward-chain),
# since gFill keeps it from ending where Last starts. With that rule disabled, Leaf is an ELF FUNC that
# the run misses, inside no found extent and without a prologue: the held-out classifier must call the
# miss `glued`.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := unreferenced-leaf
SRCS := main.s leaf.c tail.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
