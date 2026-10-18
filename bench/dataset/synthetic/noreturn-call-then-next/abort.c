extern int gLimit;

void Fatal(int code) __attribute__((noreturn));

void Fatal(int code)
{
    for (;;)
        gLimit = code;
}

void Abort(int code)
{
    gLimit = code;
    Fatal(code);
}

int Next(int a)
{
    return gLimit + a;
}
