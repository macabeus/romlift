# libc-agbcc (D123): every member of agbcc's libc.a, the C library agbcc's build.sh compiles from its libc/ sources
# (newlib) with old_agbcc -O2 -fno-builtin. It is the reference of the members no benchmark game links: agbcc itself
# writes calls to memcpy, memset and memcmp (block copies, clears and compares), and no tuning game links memcmp.
# The signature builder reads its FUNC symbols, so the two hand-written members whose labels have no type
# (arm/setjmp.s, arm/trap.s) give no signature. libgcc.a resolves the arithmetic helpers libc calls; stubs.s the rest.
NAME := libc-agbcc
TOOLCHAIN := agbcc
ARCHIVE := libc.a
LIBS := libgcc.a
SRCS := stubs.s
include ../rules.mk
