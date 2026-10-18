void *CopyBytes(void *dest, const void *src, unsigned int n)
{
    unsigned char *d = dest;
    const unsigned char *s = src;
    while (n != 0)
    {
        *d++ = *s++;
        n--;
    }
    return dest;
}
