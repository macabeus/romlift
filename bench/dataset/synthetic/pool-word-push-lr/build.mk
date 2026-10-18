# pool-word-push-lr (negative: zero entries beyond the real functions). .Lmagic is a literal word of
# LoadMagic placed after Store's pool, far from LoadMagic's code end, so it is outside LoadMagic's
# extent. It decodes as push {lr}; pop {pc}. Every pool word a walk loads is a pool
# (walk.pc-load-is-pool), and pools away from their function are claimed too (claim.far-pools), so the
# word is never a candidate. gScale's reading branches back into the claimed word and is rejected for
# covering it (valid.no-claimed-code); otherwise it is a valid function anchored after that word.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := pool-word-push-lr
SRCS := pool.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
