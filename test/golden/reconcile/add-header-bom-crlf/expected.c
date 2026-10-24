#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/tail", sub_08000400);
// The C a user pasted here: "sub_08000500" and its neighbours.
void sub_08000500(void) {
    char quote = '\'';
    (void)quote;
}
INCLUDE_ASM("asm/nonmatchings/tail", sub_08000600);
