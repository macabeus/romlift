# handwritten-2mod4 (positive; the plan's hand-written function at a 2-mod-4 address). JumpAdd starts
# right after the 6-byte Lead, at 2 mod 4, and is found only as a `bl` target (seed.call; neither the
# gap scan nor a data pointer reaches an unaligned entry). It ends in `mov pc, r2` with no table near,
# a computed jump that ends the path (walk.mov-pc-without-table). A callee is accepted without
# validity, so that rule moves nothing here (computed-jump-callback carries it); Tail, a loaded pointer
# right after JumpAdd, is taken because it tiles after it (accept.tiles-after-accepted).
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := handwritten-2mod4
SRCS := half.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
