# bx-pc-veneer (positive; the plan's `bx pc` veneer). AddOne is a Thumb `bx pc; nop` that enters the ARM
# body AddOne_arm at the next word (walk.bx-pc-veneer records it, seed.veneer proposes it). The body has
# two instructions, fewer than an ARM gap-scan candidate needs, so the veneer is its only evidence.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := bx-pc-veneer
SRCS := veneer.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
