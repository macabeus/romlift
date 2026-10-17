/* Linker script of the parser fixture: ROM at 0x08000000, one initialised IWRAM section loaded
   from ROM, an alignment that makes ld print a *fill* line, and the PROVIDE, ASSERT and
   assignment lines the map parser must skip. */
ENTRY(arm_entry)

SECTIONS
{
  . = 0x08000000;
  .text :
  {
    tiny.o(.text)
    *(.text)
    . = ALIGN(16);
  }
  .rodata :
  {
    *(.rodata*)
  }
  __data_load = .;
  .data 0x03000000 : AT(__data_load)
  {
    *(.data)
  }
  PROVIDE(tiny_rom_end = __data_load + SIZEOF(.data));
  ASSERT(SIZEOF(.text) > 0, "tiny.ld: empty .text")
  /DISCARD/ :
  {
    *(.ARM.attributes)
    *(.comment)
  }
}
