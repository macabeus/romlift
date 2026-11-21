# large-data-referenced (rule-specific: accept.prologue-and-end-anchored). Mix is a 4.2 KiB function with
# a prologue that only a data table names (seed.data-pointer): data sits before it, so it is not
# anchored at start, and nothing loads it from a pool, but it ends where Last, a callee of main,
# starts. The gap scan cannot recover it: the forward chain stops at the data word before it, and the
# end-anchor and backward-prologue scans look at most gapScan.backwardWindow and
# gapScan.prologueDistance (4096) bytes below the gap end, past which its entry lies. Without
# accept.prologue-and-end-anchored Mix is missed.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := large-data-referenced
SRCS := mix.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
