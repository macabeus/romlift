# code-copied-to-ram (positive; the plan's code copied to RAM). IwramDouble runs at 0x03000000; its bytes
# are loaded after the ROM code and copied by main through CopyWords. Its FUNC symbol lies outside the
# ROM, so it is no expected entry, and the code end stays at the end of _call_via_r3: the copied bytes
# are not ROM code and nothing in the ROM points at them with a Thumb bit.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := code-copied-to-ram
SRCS := ram.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := a0f70c956e8f982ee2a1f67f9fbead46cbaef339
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
