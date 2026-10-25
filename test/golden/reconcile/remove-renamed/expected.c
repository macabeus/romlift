#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/main", sub_08000100);
INCLUDE_ASM("asm/nonmatchings/main", UpdateScore);
// sub_08000200 was renamed to UpdateScore in romlift.toml
const char *const kOldName = "sub_08000200";
#if 0
INCLUDE_ASM("asm/nonmatchings/main", sub_08000100);
#endif
INCLUDE_ASM("asm/nonmatchings/main", sub_08000300);
