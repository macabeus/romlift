# code-end-unsized-last (negative: zero entries beyond main and Last; the code ends after Last).
# Last has no .size (FUNC size 0); the OBJECT gValue right after its `bx lr` starts with a `$d` mapping
# symbol. The ELF's code end is that `$d` (bench/src/truth.ts elfCodeEnd, D61 a), where the analysis
# ends the code; addr + size would end it at Last's entry, 8 bytes before.
# main neither returns nor opens with push {.., lr}, so only crt0's pool pointer finds it.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := code-end-unsized-last
SRCS := last.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
