#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/main", Keep); INCLUDE_ASM("asm/nonmatchings/main", Gone);
INCLUDE_ASM("asm/nonmatchings/main", AlsoGone); /* "AlsoGone" was deleted */
char gLast = 'G';
