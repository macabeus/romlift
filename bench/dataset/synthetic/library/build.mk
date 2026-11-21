# library (phase 6, signatures; architecture §7, §8.1, roadmap 6.A): reference 1 of libfix, the self-authored
# library of the signature fixtures, built with a GNU map (MAP := yes) so the signature builder reads its objects.
# main calls every member it links, so the discover analysis finds each one by its call. spec.json builds libfix's
# one version from this fixture and library-ref2 (signatures.golden.json is the file it gives); library-game is the
# game the placement rules are measured on. The rule each member is written to exercise there:
#   fix_math.o  FixMulShift, FixClamp: sig.unique-fit (long, distinctive; FixMulShift's bl is masked)
#   fix_mem.o   FixFillWords, FixCopyHalves: sig.unique-fit (an IWRAM pool word masked whole);
#               FixScale: sig.pinned-both-sides (library-game changes one of its two literal constants)
#   fix_stub.o  FixSwiDiv, FixSwiSqrt, FixSwiCpuSet, FixSwiHalt: sig.link-order-run (4-byte BIOS call stubs)
#   fix_util.o  FixAbs: sig.unique-fit (14 bytes, so padding ends every run at it);
#               FixReturnZero, FixReturnOne: sig.neighbour-spacing (4 bytes other code has too)
#   fix_data.o  gFixTable: a table with three function pointers (its names) and a constant
# FixShort (sig.short-member-window) is library-ref2's.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := library
SRCS := main.s fix_math.s fix_mem.s fix_stub.s fix_util.s fix_data.s
MAP := yes
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
