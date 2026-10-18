# pointer-word-in-gap (positive; gap.forward-chain declines a word holding an accepted Thumb function + 1,
# D60 f). A callback word holding Leaf + 1 opens a gap, then Unreferenced (a Thumb function nothing calls),
# then undefined words. Read as Thumb the callback word runs on into Unreferenced up to its return, a valid
# reading the forward chain would take for one function; it declines it because the word is Leaf's
# address, the skip slot steps over it, and the chain takes Unreferenced. Taking the word as code makes it
# a false entry and loses Unreferenced inside it.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := pointer-word-in-gap
SRCS := pointer.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
