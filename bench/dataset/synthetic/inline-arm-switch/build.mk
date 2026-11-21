# inline-arm-switch (rule-specific: walk.inline-arm-switch). Umul is a called Thumb entry whose body is
# the ARM code right after `add r2, pc, #0; bx r2` (m4a's umul3232H32). The Thumb walk ends at the bx;
# walk.inline-arm-switch walks the ARM code after it for Umul's extent, so Umul spans all 16 bytes,
# and leaves those bytes free, so gap.arm-scan still finds UmulArm. Without the rule Umul's extent
# ends at its bx.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := inline-arm-switch
SRCS := main.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
