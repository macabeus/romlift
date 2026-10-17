# shared-tail (positive; the plan's shared tail). Sharer's only exit is `b .LsharedTail` into Owner's
# epilogue. A branch into another function's code leaves the function (walk.branch-into-function);
# followed instead, Sharer's walk would cover Owner's claimed bytes and fail validity.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := shared-tail
SRCS := tail.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
