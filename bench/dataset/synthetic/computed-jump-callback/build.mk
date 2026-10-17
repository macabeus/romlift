# computed-jump-callback (rule-specific: walk.mov-pc-without-table). Dispatch is a hand-written
# trampoline that main installs as a callback and nothing calls: it loads a handler from gHandler and
# jumps to it with `mov pc, r1`, which is no table jump. It is found only as a loaded pointer that tiles
# after main (seed.pool-pointer, accept.tiles-after-accepted), so it must be valid: the write to pc ends
# its path as a register jump. Without walk.mov-pc-without-table that jump is not code, Dispatch is
# rejected and missed.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := computed-jump-callback
SRCS := dispatch.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
