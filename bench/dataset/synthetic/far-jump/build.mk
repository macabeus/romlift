# far-jump (positive; the plan's far jump). agbcc compiles MainLoop's `if (x != 0)` around a body
# longer than a `b` reaches (2 KiB), so the branch over the body becomes `bl .L<n> @far jump`, and the
# prologue pushes lr for it. Its target, the endless loop after the body, lies before the code end of
# MainLoop's first reading, so the `bl` is a jump inside the caller (bl.target-inside-caller). The loop
# never returns, so no later rule of the ladder calls the `bl` a jump: without that rule the loop
# becomes a false entry.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := far-jump
SRCS := main.s far.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
