# pops-unpushed-frame (rule-specific: bl.target-pops-unpushed-frame; also bl.target-before-entry,
# bl.target-has-prologue and bl.target-beyond-callee). Caller's last `bl` goes 1.6 KiB ahead, past its
# code end, to .Lepilogue, which has no prologue, so its reading decides: it pops r4-r7 and the return
# address Caller pushed, so the `bl` is a far jump to Caller's own epilogue (otherwise .Lepilogue
# becomes a false entry and Caller is cut at its pool). Leaf, which only Caller calls, lies before
# Caller's entry, so that `bl` is a call (bl.target-before-entry; otherwise it reads as a far jump
# inside Caller). CleanupArg pops one word more than it pushes (the argument Caller pushed), but it
# opens with push {.., lr}, so that `bl` is a call (bl.target-has-prologue; otherwise its reading makes
# it a far jump and CleanupArg is lost). DropArg also pops one word it never pushed and has no prologue;
# under the ascending worklist Caller is settled before Nudge (which calls DropArg from near by) is
# accepted, so that far `bl` is a call because it lies past the entry of CleanupArg, another function
# Caller calls (bl.target-beyond-callee; otherwise Caller's walk would run on through DropArg).
# bl.self-or-accepted has its own fixture, recursive-far-call.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := pops-unpushed-frame
SRCS := frame.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
