# adr-label-and-data (negative; seed.adr proposes only an unclaimed address past the function's extent
# that reads as ARM code, D60 g). Work_arm names its own label .Lresume with `adr` (a return address it
# stores, inside its extent) and the table after its code (two undefined ARM words it loads with `ldm`).
# Neither is a function; proposing every adr target above the entry makes both false ARM entries.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := adr-label-and-data
SRCS := adr.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
