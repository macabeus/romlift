const unsigned short sPrices[8] = { 0x0110, 0x0220, 0x0330, 0x0440, 0x0550, 0x0660, 0x0770, 0x0880 };

void __gccmain(void)
{
}

int Price(int item)
{
    return sPrices[item & 7];
}

int Basket(volatile int *items, int n)
{
    int total = 0;
    int i;
    for (i = 0; i < n; i++)
        total += Price(items[i]);
    return total;
}

void main(void)
{
    volatile int *out;

    out = (volatile int *)0x02000000;
    out[0] = Basket(out + 1, 4);
}
