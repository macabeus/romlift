# shared-tail (positive; the plan's shared tail). Sharer's only exit is `b .LsharedTail` into Owner's
# epilogue. A branch into another function's code leaves the function (walk.branch-into-function);
# followed instead, Sharer's walk would cover Owner's claimed bytes and fail validity.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := shared-tail
SRCS := tail.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
