# code-end-data-decodes (negative: zero entries beyond main and Last; the code ends at Last's end).
# gPalette after the last function decodes as `movs; bx lr` stubs and a push/pop frame. Code ends at
# the last accepted function; what follows is data (region.data-after-code), not scanned for entries.
# main neither returns nor opens with push {.., lr}, so only crt0's pool pointer, taken as startup
# evidence without a validity check, finds it (seed.startup-pointer).
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := code-end-data-decodes
SRCS := end.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
