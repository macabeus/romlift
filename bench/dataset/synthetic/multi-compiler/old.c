int OldMix(int a, int b)
{
    return (a * 3) ^ b;
}

int OldClamp(int x)
{
    if (x > 255)
        return 255;
    if (x < 0)
        return 0;
    return x;
}

int OldScale(int a)
{
    return OldMix(a, 7) + OldClamp(a >> 2);
}
