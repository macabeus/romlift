# thumb-pointer-run (negative: zero entries beyond the real functions). gTasks is four Thumb pointers to
# accepted functions; read as Thumb it is a run of shifts that ends in Last without a return, so no
# reading of it is an entry. The forward scan of the next gap steps over a zero padding word
# (gap.skip-padding-and-pointers) to find Spare, the real unreferenced leaf behind it.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := thumb-pointer-run
SRCS := run.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
