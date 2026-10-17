extern int gState;
extern int gMode;

int Dispatch(int x, int y)
{
    switch (x) {
    case 0: gState = y; break;
    case 1: gState = y + 3; break;
    case 2: gMode = y; break;
    case 3: gState = gMode; break;
    case 4: gMode = 7; break;
    case 5: return gMode + gState;
    }
    return gState;
}

int After(int a)
{
    return gMode - a;
}
