int MathClamp(int x, int lo, int hi);
int MathLerp(int a, int b, int t);

int SoundEnvelope(int t, int attack, int decay, int sustain)
{
    if (t < attack)
        return (t << 8) >> attack;
    t -= attack;
    if (t < decay)
        return 256 - (((256 - sustain) * t) >> 4);
    return sustain;
}

int SoundMixChannel(volatile short *buf, int n, int vol)
{
    int peak = 0;
    int i;
    for (i = 0; i < n; i++) {
        int s = (buf[i] * vol) >> 8;
        s = MathClamp(s, -128, 127);
        buf[i] = s;
        if (s < 0)
            s = -s;
        if (s > peak)
            peak = s;
    }
    return peak;
}

int SoundPitch(int note, int bend)
{
    int base = 0x400 + note * 0x40;
    int shifted = MathLerp(base, base + 0x40, bend & 0xFF);
    if (bend < 0)
        shifted -= 0x20;
    return shifted & 0x7FF;
}

void SoundWriteRegs(int channel, int freq, int vol)
{
    volatile unsigned short *regs = (volatile unsigned short *)0x04000060;
    regs += channel * 4;
    regs[0] = 0x0008;
    regs[1] = (vol << 12) | 0x0080;
    regs[2] = freq | 0x8000;
}

int SoundUpdate(int ticks)
{
    volatile short *buf = (volatile short *)0x02000400;
    int ch;
    int total = 0;
    for (ch = 0; ch < 4; ch++) {
        int env = SoundEnvelope(ticks + ch * 8, 4, 16, 160);
        int peak = SoundMixChannel(buf + ch * 32, 32, env);
        SoundWriteRegs(ch, SoundPitch(ch * 5 + 40, ticks - 64), env >> 4);
        total += peak;
    }
    return total;
}
