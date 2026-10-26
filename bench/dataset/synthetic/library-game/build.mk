# library-game (phase 6, signatures; architecture §7, §8.1, roadmap 6.A): a game that links libfix
# (library/build.mk names every member) with other neighbours, the ROM the placement rules are measured on:
#   game.s       main, then GameShift (FixShort's bytes) and GameReturnZero (FixReturnZero's), and GameFiller,
#                which keeps GameShift beyond the matcher's 64-byte window of the library
#   fix_math.o   FixMulShift, FixClamp: sig.unique-fit
#   fix_mem.o    FixFillWords, FixCopyHalves: sig.unique-fit; FixScale: sig.pinned-both-sides (its first literal
#                constant is 0x00005678 here, 0x00001234 in the references: one differing word)
#   fix_stub.o   the four 4-byte stubs, in link order: sig.link-order-run
#   fix_util.o   FixAbs: sig.unique-fit; FixReturnZero, FixReturnOne: sig.neighbour-spacing
#   fix_short.o  FixShort, after FixReturnOne (library-ref2 links it between fix_math.o and fix_util.o):
#                sig.short-member-window
#   game_tail.s  GameTail, a neighbour no reference has; it loads a Thumb pointer into its own code, which
#                valid.in-rom-unclaimed rejects (the explain golden of that rule)
#   fix_data.o   gFixTable, after the code
# Built with a GNU map (MAP := yes). Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := library-game
SRCS := game.s fix_math.s fix_mem.s fix_stub.s fix_util.s fix_short.s game_tail.s fix_data.s
MAP := yes
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
