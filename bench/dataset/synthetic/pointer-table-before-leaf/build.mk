# pointer-table-before-leaf (negative: zero entries beyond the real functions). gTasks is four Thumb
# pointers to the task functions; read as Thumb it is a run of shifts that falls into Leaf, an
# unreferenced leaf right behind it, and returns there. A Thumb-tagged word names the table, so it is
# proposed in the first harvest round, while Leaf is still unclaimed: every other validity rule passes
# and the table, which tiles after TaskD, would be taken as a function swallowing Leaf. Only
# valid.not-pointer-table rejects it (four of its six words are Thumb code pointers). Leaf is then
# accepted as the callee of Caller, an unreferenced function the gap scan finds after main, so no shorter
# suffix of the table reads as a function either.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := pointer-table-before-leaf
SRCS := tasks.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
