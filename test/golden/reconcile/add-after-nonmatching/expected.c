#include "include_asm.h"

INCLUDE_ASM("asm/nonmatchings/main", Start);

#ifdef NONMATCHING
void Update(void) {
    const char c = '}';
    (void)c;
}
#else
INCLUDE_ASM("asm/nonmatchings/main", Update);
#endif
INCLUDE_ASM("asm/nonmatchings/main", Draw);

INCLUDE_ASM("asm/nonmatchings/main", Finish);
