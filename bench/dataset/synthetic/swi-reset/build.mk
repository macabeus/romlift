# swi-reset (positive; the plan's `swi` reset). DoReset ends with `swi 0` (SoftReset) followed by its
# pool: a BIOS call before non-code ends the path as a return (walk.swi-before-noncode), so DoReset is
# valid; without it the walk runs into the pool and DoReset is rejected.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := swi-reset
SRCS := reset.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
