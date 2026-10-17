# local-subroutine (rule-specific: bl.near-is-call). Increment lies inside Twice's extent, after its
# first `bl` and before its second. A `bl` whose target is near (closer than a far jump ever is) is a
# call; without that rule the target, which lies before the caller's code end, reads as a far jump
# inside the caller and Increment is lost.
# Startup: _start and start_vector (common/crt0.s); entries counted from main on.
NAME := local-subroutine
SRCS := local.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
