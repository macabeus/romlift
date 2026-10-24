int OldMix(int a, int b);
int OldScale(int a);
int OldClamp(int x);

void __gccmain(void)
{
}

int Accumulate(int n)
{
    int s = 0;
    int i;
    for (i = 0; i < n; i++)
        s += OldMix(i, n);
    return s;
}

int Blend(int a, int b, int w)
{
    int x = OldClamp(a * w + b * (16 - w));
    return OldScale(x >> 4);
}

void main(void)
{
    volatile int *out = (volatile int *)0x02000000;
    out[0] = Accumulate(8);
    out[1] = OldScale(out[0]);
    out[2] = Blend(out[0], out[1], 5);
    out[3] = OldClamp(out[2] - 300);
}
