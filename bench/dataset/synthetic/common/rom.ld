/* The shared linker script of the synthetic fixtures (architecture §8.1): the startup object first,
 * then the fixture's objects in the order build.mk lists them, all at the cartridge base. Code that
 * runs from IWRAM (section .iwram) is placed after the ROM code with its load address in the ROM. */
ENTRY(_start)

SECTIONS
{
    . = 0x08000000;
    .text : {
        *crt0.o(.text);
        *(.text);
        *(.rodata);
        *(.rodata.*);
        *(.data);
        . = ALIGN(4);
    }
    __iwram_lma = .;
    .iwram 0x03000000 : AT(__iwram_lma) {
        __iwram_start = .;
        *(.iwram);
        . = ALIGN(4);
        __iwram_end = .;
    }
    .bss 0x02000000 (NOLOAD) : {
        *(.bss);
        *(COMMON);
    }
    /DISCARD/ : {
        *(.comment);
        *(.note*);
    }
}
