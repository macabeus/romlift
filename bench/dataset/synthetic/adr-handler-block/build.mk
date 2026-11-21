# adr-handler-block (rule-specific: gap.adr-block-absorb). .Lhandler starts the gap after
# InstallHandler's pool, is named by InstallHandler's `adr` and leaves only by `b .Lresume` back into
# it, so it is absorbed into InstallHandler; without the rule it is a two-instruction block anchored
# after claimed bytes and becomes a false entry, and InstallHandler's extent is cut at its pool.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := adr-handler-block
SRCS := handler.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
