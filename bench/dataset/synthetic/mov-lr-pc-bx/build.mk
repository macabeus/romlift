# mov-lr-pc-bx (rule-specific: walk.mov-lr-pc-bx-is-call; also seed.adr). In ARM, `mov lr, pc; bx r1` is
# a call, so ArmApply's walk goes on after the `bx` to its real return; read as a return, the rest of
# ArmApply is cut off and found again as a false ARM entry. ArmAddOne has two instructions, so only
# ArmApply's `adr` proposes it.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := mov-lr-pc-bx
SRCS := call.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
