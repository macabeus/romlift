#include "include_asm.h"

/* INCLUDE_ASM("asm/nonmatchings/main", sub_08000200); is only a comment */
INCLUDE_ASM("asm/nonmatchings/main", sub_08000100);

// sub_08000300 is decompiled below; its message names sub_08000200
static const char sMessage[] = "INCLUDE_ASM(\"asm/nonmatchings/main\", sub_08000200);";
static const char sQuote = '"';

int sub_08000300(int x) {
    return x + sQuote;
}
