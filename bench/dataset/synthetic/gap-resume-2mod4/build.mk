# gap-resume-2mod4 (positive; the gap scan resumes on a 2-mod-4 halfword, D60 a). libgcc's _call_via_r0 ..
# _call_via_r3 sit back to back, 2 bytes each; only _call_via_r0 is called. The gap after it starts on 2
# mod 4 with `bx r1`, which is not padding: the scan resumes there (the profile lets hand-written Thumb sit
# on 2 mod 4), and gap.forward-chain takes _call_via_r1 .. _call_via_r3 up to After. Resuming on the next
# word instead loses _call_via_r1.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := gap-resume-2mod4
SRCS := stubs.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
