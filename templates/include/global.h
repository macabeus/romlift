/* include/global.h: what decompiled C in @@name@@ includes first (written once by romlift init; yours to edit).
 * The fixed-width types and the GBA's I/O registers. The generated INCLUDE_ASM stubs do not need it: they include
 * include_asm.h alone, so you may reshape this header as your project grows. */
#ifndef GUARD_GLOBAL_H
#define GUARD_GLOBAL_H

#include "gba/types.h"
#include "gba/io_reg.h"

#define ARRAY_COUNT(array) (sizeof(array) / sizeof((array)[0]))

#endif /* GUARD_GLOBAL_H */
