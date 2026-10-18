# data-named-between-data (positive; a function named only by data, between two blocks of data).
# ScriptCallback (`push {lr}; bl Helper; pop {pc}`) is named by one word of a command table in .rodata and
# by nothing else; data lies right before and right after it, so the forward chain stops at the data, the
# end anchor and the backward chain find nothing that fills or anchors, and no pointer run surrounds the
# word. seed.data-pointer proposes it and accept.prologue-and-calls-accepted takes it: a prologue, a
# return and a call that lands on an accepted function.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := data-named-between-data
SRCS := script.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
