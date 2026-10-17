# dead-code-in-extent (rule-specific: claim.dead-code-in-extent). The `movs r0, #0; bx lr` after Pick's
# `b .Ldone` is unreachable, word-aligned and inside Pick's extent. A dense function's unreached bytes
# are claimed as its dead code; left free, they are a stub anchored after Pick's code and become a
# false entry.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := dead-code-in-extent
SRCS := dead.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
