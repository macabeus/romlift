# push-lr-2mod4 (positive; gap.end-anchor's `push {.., lr}` on 2 mod 4, D60 c). Helper, a hand-written
# function nothing calls, sits on 2 mod 4 right after a data halfword that decodes as `movs r0, #1`, and
# ends where Next starts. Both readings are valid and fill the gap to Next: the word candidate at the
# data halfword and the halfword candidate at Helper's `push {r4, lr}`. Ranked by the end anchor's rule (a
# prologue wins), Helper is taken and the data halfword is no entry; without the halfword candidate the
# data halfword is taken and Helper is lost.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := push-lr-2mod4
SRCS := handwritten.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
