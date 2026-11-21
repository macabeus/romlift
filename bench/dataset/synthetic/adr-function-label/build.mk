# adr-function-label (rule-specific; the readable printer, D72 c: the owner's answer to Q7 of phase 3). A Thumb
# `adr` (main, which also calls it) and an ARM `adr` (Work_arm, after it) take the word-aligned address of Handler,
# a Thumb function; the source names it by a local label. The printer must name an adr's target by a label that
# links to the target itself, never Handler's, which links to Handler + 1: the text-layout check refuses
# `adr r0, Handler` in Thumb, and GNU as with -mthumb-interwork assembles the ARM one to Handler + 1.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := adr-function-label
SRCS := adr.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
