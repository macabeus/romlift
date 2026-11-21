# library-ref2 (phase 6, signatures; architecture §7, §8.1, roadmap 6.A): reference 2 of libfix (library/build.mk
# names every member and its rule). It links fix_math.o, fix_util.o (the library fixture's sources) and fix_short.o,
# which the library fixture lacks, so the version takes FixShort from here and only matches the others by member id:
#   fix_short.o  FixShort: sig.short-member-window (6 bytes; in library-game it sits after FixReturnOne, outside
#                the span FixClamp and FixAbs give it here, and GameShift has its bytes far from the library)
# Built with a GNU map (MAP := yes). Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := library-ref2
SRCS := main.s fix_math.s fix_short.s fix_util.s
MAP := yes
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
