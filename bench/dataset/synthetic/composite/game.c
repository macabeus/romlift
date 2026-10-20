int MathPoly(int x);
int MathLerp(int a, int b, int t);
int MathDist(int x0, int y0, int x1, int y1);
int MathSqrt(int n);
int MathSum(int *p, int n);
int MathMix(int a, int b);

void GameInit(int seed)
{
    int *state = (int *)0x02000100;
    int i;
    for (i = 0; i < 16; i++) {
        seed = seed * 1103515245 + 12345;
        state[i] = (seed >> 16) & 0x7FFF;
    }
    *(int (**)(int))0x03000104 = MathPoly;
}

int GameScore(int *state, int n)
{
    int best = 0;
    int i;
    for (i = 0; i < n; i++) {
        int d = MathDist(state[i] & 0xFF, state[i] >> 8, 120, 80);
        if (d > best)
            best = d;
    }
    return best;
}

int GameMove(int pos, int target, int speed)
{
    int next = MathLerp(pos, target, speed);
    if (next == pos) {
        if (pos < target)
            next = pos + 1;
        else if (pos > target)
            next = pos - 1;
    }
    return next;
}

int GameStep(int frames)
{
    int *state = (int *)0x02000100;
    int i;
    int moved = 0;
    while (frames-- > 0) {
        for (i = 0; i < 16; i++) {
            int n = GameMove(state[i], state[(i + 1) & 15], 64);
            if (n != state[i])
                moved++;
            state[i] = n;
        }
    }
    return moved + GameScore(state, 16) + MathSqrt(MathSum(state, 16));
}

int GameMode(int mode, int value)
{
    switch (mode) {
    case 0:
        return value + 1;
    case 1:
        return value * 2;
    case 2:
        return MathMix(value, 9);
    case 3:
        return value - 7;
    case 4:
        return value ^ 0x55;
    case 5:
        return MathPoly(value);
    default:
        return 0;
    }
}
