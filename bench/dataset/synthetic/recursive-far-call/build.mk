# recursive-far-call (rule-specific: bl.self-or-accepted). Rec (C) guards x == 0 with a call to Fatal,
# which never returns, then runs a 2.4 KiB body and calls itself: `bl Rec` lies more than 1,960 bytes
# past the entry, so it looks like agbcc's far jump, and its target, Rec's own entry, lies before the
# caller's code end. Rec's only return, `gOut = r; return r + 1`, follows that call. The bl is a call
# because its target is the caller itself (bl.self-or-accepted); without that rule
# bl.target-inside-caller makes it a jump to the entry, the walk ends there, and Rec's extent and the
# code end lose the return and its pool.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := recursive-far-call
SRCS := main.s rec.c
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
