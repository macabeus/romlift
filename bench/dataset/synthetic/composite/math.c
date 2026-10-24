int MathSum(int *p, int n)
{
    int s = 0;
    while (n-- > 0)
        s += *p++;
    return s;
}

int MathMix(int a, int b)
{
    int r = a * 7 + b * 3;
    if (r < 0)
        r = -r;
    return (r >> 2) ^ (a & b);
}

int MathPoly(int x)
{
    return ((x * 3 + 5) * x - 11) * x + 2;
}

int MathClamp(int x, int lo, int hi)
{
    if (x < lo)
        return lo;
    if (x > hi)
        return hi;
    return x;
}

int MathGcd(int a, int b)
{
    if (a <= 0 || b <= 0)
        return 1;
    while (a != b) {
        if (a > b)
            a -= b;
        else
            b -= a;
    }
    return a;
}

int MathLerp(int a, int b, int t)
{
    return a + ((b - a) * t >> 8);
}

int MathDist(int x0, int y0, int x1, int y1)
{
    int dx = x1 - x0;
    int dy = y1 - y0;
    if (dx < 0)
        dx = -dx;
    if (dy < 0)
        dy = -dy;
    if (dx > dy)
        return dx + (dy >> 1);
    return dy + (dx >> 1);
}

int MathSqrt(int n)
{
    int r = 0;
    int bit = 1 << 30;
    while (bit > n)
        bit >>= 2;
    while (bit != 0) {
        if (n >= r + bit) {
            n -= r + bit;
            r = (r >> 1) + bit;
        } else {
            r >>= 1;
        }
        bit >>= 2;
    }
    return r;
}
