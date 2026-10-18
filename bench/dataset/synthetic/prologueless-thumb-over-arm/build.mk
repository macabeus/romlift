# prologueless-thumb-over-arm (rule-specific: gap.arm-over-prologueless-thumb). At ArmSum both readings
# are candidates: a Thumb `bx lr` stub without a prologue, anchored after main, and an ARM function that
# explains more bytes. A Thumb reading wins only with a prologue or when the ARM one explains no more;
# otherwise ArmSum would become a 2-byte Thumb entry.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := prologueless-thumb-over-arm
SRCS := arm.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
