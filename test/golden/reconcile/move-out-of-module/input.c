#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/boot", Boot);
// Init leaves for module main: "Init" is main's from now on
INCLUDE_ASM("asm/nonmatchings/boot", Init);
static const char kSeparator = ';';
#if 0
#endif
