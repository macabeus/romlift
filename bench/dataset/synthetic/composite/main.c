int MathSum(int *p, int n);
int MathMix(int a, int b);
int MathPoly(int x);
int MathClamp(int x, int lo, int hi);
int MathGcd(int a, int b);
int HandOwner(int x);
int HandSharer(int x);
int HandHalf(int a, int b);
void HandIrq(void);
void GameInit(int seed);
int GameStep(int frames);
int MenuRun(int choice);
int SoundUpdate(int ticks);

void __gccmain(void)
{
}

int Checksum(volatile int *p, int n)
{
    int s = 0;
    int i;
    for (i = 0; i < n; i++)
        s = (s << 1) ^ p[i];
    return s;
}

void main(void)
{
    volatile int *out;
    int i;

    out = (volatile int *)0x02000000;
    GameInit(out[0]);
    for (i = 0; i < 4; i++)
        out[4 + i] = GameStep(i + 1);
    out[8] = MenuRun(out[1]);
    out[9] = HandOwner(out[2]) + HandHalf(out[3], 2);
    *(void (**)(void))0x03007FFC = HandIrq;
    *(int (**)(int))0x03000100 = HandSharer;
    out[10] = MathClamp(MathMix(out[5], out[6]), -50, 50) + MathGcd(out[7], 12);
    out[11] = SoundUpdate(out[10]);
    out[12] = Checksum(out, 12);
}
