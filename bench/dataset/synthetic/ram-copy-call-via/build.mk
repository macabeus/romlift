# ram-copy-call-via (rule-specific; seed.ram-copy's jump through `bl _call_via_rN`). main copies the
# ram-code-entries block to 0x03000000 and calls IwramDouble and IwramTriple by loading their IWRAM
# addresses into r3 and calling `_call_via_r3` (`bx r3`), agbcc's call through a function pointer. Only
# the `bl` to a `bx rN` stub of the loaded register tells that main jumps through the pointer; without it
# the block, the last code in the ROM, is lost.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-call-via
SRCS := ram.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
