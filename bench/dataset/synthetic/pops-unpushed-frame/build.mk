# pops-unpushed-frame (rule-specific: bl.target-pops-unpushed-frame; also bl.target-before-entry and
# bl.target-has-prologue). Caller's last `bl` goes 1.6 KiB ahead, past its code end, to .Lepilogue, which
# has no prologue, so its reading decides: it pops r4-r7 and the return address Caller pushed, so the
# `bl` is a far jump to Caller's own epilogue (otherwise .Lepilogue becomes a false entry and Caller is
# cut at its pool). Leaf, which only Caller calls, lies before Caller's entry, so that `bl` is a call
# (bl.target-before-entry; otherwise it reads as a far jump inside Caller). CleanupArg pops one word more
# than it pushes (the argument Caller pushed), but it opens with push {.., lr}, so that `bl` is a call
# (bl.target-has-prologue; otherwise its reading makes it a far jump and CleanupArg is lost). DropArg
# also pops one word it never pushed and has no prologue, but it is already accepted (Nudge calls it
# from near by) when Caller is judged, so that `bl` is a call (bl.self-or-accepted; otherwise Caller's
# walk would run on through DropArg).
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := pops-unpushed-frame
SRCS := frame.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
