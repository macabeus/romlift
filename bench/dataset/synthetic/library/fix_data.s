@ libfix, fix_data.o: gFixTable, a table of the library (.rodata, after the code): three pointers to libfix
@ functions (Thumb bit set; the mask drops each, since the link moves them, and the table's names record which
@ member each one names) and one constant the mask keeps.
	.syntax unified
	.section .rodata
	.align 2, 0
	.global gFixTable
	.type gFixTable, %object
gFixTable:
	.word FixMulShift
	.word FixClamp
	.word 0x00000010
	.word FixReturnZero
	.size gFixTable, .-gFixTable
