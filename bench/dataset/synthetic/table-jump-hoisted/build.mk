# table-jump-hoisted (positive; the plan's table jump with hoisted instructions). agbcc compiles
# Dispatch's switch to `lsl; ldr r1, =.L10; add; ldr; mov pc, r0` over a table of case addresses placed
# after the function's pool, with the load of gState hoisted above the bounds check, so the walk must
# find the table base as the nearest pc-relative load whose value is a table just ahead
# (walk.table-nearest-pool-load), follow every case and claim the table; without the table the jump
# reads as a computed return and Dispatch ends at its pool.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := table-jump-hoisted
SRCS := main.s switch.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
