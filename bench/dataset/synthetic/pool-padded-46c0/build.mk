# pool-padded-46c0 (negative: zero entries beyond the real functions). Setup's pool follows a 0x46C0
# padding halfword. The pool words are Setup's (walk.pc-load-is-pool) and inside its extent across the
# padding (claim.adjacent-pools), so the stub-shaped first word is never a candidate.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := pool-padded-46c0
SRCS := pad.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
