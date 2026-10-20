#include "include_asm.h"

int sub_08000174(int a, int b)
{
    return (a * 3) ^ b;
}

int sub_08000180(int x)
{
    if (x > 255)
        return 255;
    if (x < 0)
        return 0;
    return x;
}

int sub_08000190(int a)
{
    return sub_08000174(a, 7) + sub_08000180(a >> 2);
}
