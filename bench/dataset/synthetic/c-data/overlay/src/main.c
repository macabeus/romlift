#include "include_asm.h"

const unsigned short sPrices[8] = { 0x0110, 0x0220, 0x0330, 0x0440, 0x0550, 0x0660, 0x0770, 0x0880 };

/* A stub right after a const definition, where agbcc is still in .rodata: INCLUDE_ASM selects .text itself (D112). */
INCLUDE_ASM("asm/nonmatchings/main", sub_080000F4);

int sub_080000F8(int item)
{
    return sPrices[item & 7];
}

int sub_0800010C(volatile int *items, int n)
{
    int total = 0;
    int i;
    for (i = 0; i < n; i++)
        total += sub_080000F8(items[i]);
    return total;
}

void sub_08000130(void)
{
    volatile int *out;

    sub_080000F4();
    out = (volatile int *)0x02000000;
    out[0] = sub_0800010C(out + 1, 4);
}
