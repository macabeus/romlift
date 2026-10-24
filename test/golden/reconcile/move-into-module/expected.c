#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/main", Init);
/* Init moves here from module boot when romlift.toml moves its border: 'I' */
#ifndef NONMATCHING
INCLUDE_ASM("asm/nonmatchings/main", Run);
#endif
INCLUDE_ASM("asm/nonmatchings/main", Stop);
