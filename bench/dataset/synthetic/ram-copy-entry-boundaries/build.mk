# ram-copy-entry-boundaries (rule-specific; where seed.ram-copy lets an entry open). main copies a block to
# 0x03000000 with CopyWords(source, destination, end), an end-pointer loop (`cmp r1, r2`), and reaches four
# of its addresses through veneers: IwramTwoEntry, the label IwramTwoEntry_b the code before it falls into
# (declined: not a function), IwramLoad, and IwramAfter right after IwramLoad's literal pool, whose word
# decodes as a conditional ARM instruction (a boundary all the same). Reverting the end-pointer form loses
# the block, dropping the fall-through test adds IwramTwoEntry_b, dropping the pool boundary loses
# IwramAfter.
# Startup: _start and start_vector (common/crt0.s); expect.json lists them too.
NAME := ram-copy-entry-boundaries
SRCS := ram.s
# Toolchain record (D28), written by `npm run fixtures -- rebuild`:
AGBCC_COMMIT := da598c1d918402c42c0c0d7128ba14567f3175e9
AS_VERSION := GNU assembler (Arm GNU Toolchain 15.3.Rel1 (Build arm-15.149)) 2.45.1.20260126
include ../common/rules.mk
