# arm-pools-in-front (positive; the plan's ARM function with pools in front). ArmSetVector is ARM,
# unreferenced, and loads two words placed before its entry (gArmWords). The gap scan reads ARM a few
# words ahead of the gap's start and takes a candidate there when its pools lie in front of it
# (gap.arm-scan); the words themselves are not code.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := arm-pools-in-front
SRCS := arm.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
