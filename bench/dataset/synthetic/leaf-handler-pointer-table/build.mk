# leaf-handler-pointer-table (positive; the plan's pointer table of leaf handlers). HandlerA-C have no
# prologue, nothing calls them, and the first sits after the table's data words, so it is anchored by
# nothing: only its pointer, one of a run of three Thumb pointers to valid targets, is evidence
# (accept.pointer-table-run, proposed by seed.data-pointer); B and C then tile after it
# (accept.tiles-after-accepted). Leaf handlers of a 2-instruction size are never taken by a gap scan.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := leaf-handler-pointer-table
SRCS := handlers.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
