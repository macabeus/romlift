#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/main", First);

/* the middle of the module lives in part.c */
#include "part.c"
INCLUDE_ASM("asm/nonmatchings/main", Fourth);
