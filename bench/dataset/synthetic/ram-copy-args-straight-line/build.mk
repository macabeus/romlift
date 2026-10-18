# ram-copy-args-straight-line (rule-specific, negative; the argument scan of seed.ram-copy). main loads a
# ROM address, an IWRAM address and a size into r0..r2 and returns them on one path (`pop {pc}`); the
# other path, a branch target laid out right after that return, calls CopyWords with whatever r1 and r2
# hold there. The call never sees the values loaded before the return, so seed.ram-copy must not read a
# copy from them: a scan that walked back across the exit and the join point would map the veneer's IWRAM
# pointer into the data object Decoy and propose an ARM entry inside it, a false entry.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-args-straight-line
SRCS := main.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
