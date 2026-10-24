#include "include_asm.h"

/* git mv src/old.c src/new.c: module "old" is "new" in romlift.toml */
INCLUDE_ASM("asm/nonmatchings/new", sub_08001000);
INCLUDE_ASM("asm/nonmatchings/new", sub_08001100);
