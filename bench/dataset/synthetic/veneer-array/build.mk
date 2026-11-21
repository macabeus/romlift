# veneer-array (positive; gap.end-anchor's veneer-array element, D60 b). Four `ldr r3, [pc, #k]; bx r3`
# stubs lie end to end right after a table of data words, their pools after the array. main calls
# Veneer2 and Veneer3; Veneer0 and Veneer1 are reached by nothing. The end anchor takes Veneer1 (it ends
# exactly where Veneer2, a stub of the same shape, starts) and then Veneer0, though each has two
# instructions, fewer than gapScan.minInsns, and its pool after the array does not fill the hole. Without
# the element case both are lost.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := veneer-array
SRCS := veneers.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
