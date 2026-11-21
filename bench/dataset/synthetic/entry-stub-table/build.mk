# entry-stub-table (positive; claim.dead-code-in-extent leaves an unreached copy of the entry stub free,
# D60 d). DrownFx, LavaFx, SwampFx and PitFx are `movs r1, #k; b Common` stubs (PitFx falls into Common);
# main calls LavaFx and PitFx. Read from LavaFx (accepted before PitFx, so Common is still free),
# SwampFx's four bytes are unreached inside its extent, but they are a copy of LavaFx's own entry stub
# (same register, same target): another entry of the table, so they stay free and the gap scan takes
# SwampFx. Claiming them as dead code loses SwampFx.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := entry-stub-table
SRCS := stubs.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
