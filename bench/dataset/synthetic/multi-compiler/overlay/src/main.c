#include "include_asm.h"

int sub_08000174(int a, int b);
int sub_08000180(int x);
int sub_08000190(int a);

void sub_080000F4(void)
{
}

int sub_080000F8(int n)
{
    int s = 0;
    int i;
    for (i = 0; i < n; i++)
        s += sub_08000174(i, n);
    return s;
}

int sub_0800011C(int a, int b, int w)
{
    int x = sub_08000180(a * w + b * (16 - w));
    return sub_08000190(x >> 4);
}

void sub_08000138(void)
{
    volatile int *out;

    sub_080000F4();
    out = (volatile int *)0x02000000;
    out[0] = sub_080000F8(8);
    out[1] = sub_08000190(out[0]);
    out[2] = sub_0800011C(out[0], out[1], 5);
    out[3] = sub_08000180(out[2] - 300);
}
