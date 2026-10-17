# ram-copy-setup-bound (rule-specific; the argument window of seed.ram-copy). main copies the ram-code-entries
# block to 0x03000000 through CopyWords(source, destination, size) after an argument setup of exactly 12
# straight-line instructions, the profile's ramCopy.argInsns, and reaches IwramDouble and IwramTriple only
# through veneers. With a window of 11 the source is unknown, the copy is not recognised and the block,
# the last code in the ROM, is lost.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-setup-bound
SRCS := ram.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
