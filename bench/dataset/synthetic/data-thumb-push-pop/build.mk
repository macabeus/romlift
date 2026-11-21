# data-thumb-push-pop (negative: zero entries beyond main and Last1-Last5). Five data records decode as
# prologue-and-epilogue shapes, each rejected by one validity rule: gRecordCall calls a zero word
# (valid.calls-code), gRecordUndefined holds an undefined halfword (valid.decodes), gRecordHole branches
# over a hole (valid.dense; it does not end where Last3 starts, so it is no tiled hole), gRecordLoad
# loads from Last5's code (valid.pool-not-code), and gRecordPops pops more than it pushed
# (valid.balanced-stack) and ends where Last5 starts, so only that rule keeps it from tiling the gap.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := data-thumb-push-pop
SRCS := data.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
