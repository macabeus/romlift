# noreturn-call-then-next (positive; the plan's never-returning call followed by the next function).
# Abort ends with `bl Fatal` to a function agbcc knows never returns, so no epilogue follows: a zero
# halfword of alignment and Abort's literal pool come next, then Next. The walk must end Abort's path at
# that bl because non-code follows it (walk.noreturn-call-before-noncode, after stripping the zero
# padding: walk.trailing-zero-padding) and judge the bl never-returning (bl.noreturn-before-noncode);
# Abort is reached only through a pool pointer, so it must also pass validity.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := noreturn-call-then-next
SRCS := main.s abort.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
