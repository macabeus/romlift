int GameMode(int mode, int value);
int MathClamp(int x, int lo, int hi);

const unsigned short sMenuCosts[8] = { 0x0110, 0x0220, 0x0330, 0x0440, 0x0550, 0x0660, 0x0770, 0x0880 };

int MenuCost(int item)
{
    return sMenuCosts[item & 7];
}

int MenuPick(int cursor, int delta, int count)
{
    cursor += delta;
    if (cursor < 0)
        cursor = count - 1;
    else if (cursor >= count)
        cursor = 0;
    return cursor;
}

int MenuTotal(int *items, int n)
{
    int total = 0;
    int i;
    for (i = 0; i < n; i++)
        total += MenuCost(items[i]);
    return MathClamp(total, 0, 0x2000);
}

int MenuRun(int choice)
{
    int *items = (int *)0x02000200;
    int cursor = 0;
    int i;
    for (i = 0; i < 8; i++) {
        cursor = MenuPick(cursor, (choice >> i) & 1 ? 1 : -1, 6);
        items[i] = GameMode(cursor, i);
    }
    return MenuTotal(items, 8);
}
