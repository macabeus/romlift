# data-table-between-functions (positive; the plan's data table between functions). gSizesA,
# gOffsetsB and gOffsetsC are halfword tables between functions. gSizesA decodes as shifts that run into
# the accepted Mid without a return; the offsets do not decode. No table becomes an entry, and the
# forward scan of each gap stops at its table.
# Mid is reached only through a pool pointer and opens with push {.., lr} (seed.pool-pointer,
# accept.prologue-and-loaded). Tidy, unreferenced, ends where Last1 starts (gap.end-anchor). Frame, a
# two-instruction frame with no reference, ends where Last2 starts (gap.backward-prologue-chain).
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := data-table-between-functions
SRCS := tables.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
