@ The veneers and the block of ARM routines that main copies to IWRAM, linked after CopyBytes.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start Double_veneer
	ldr r3, .Lram_double
	bx r3
	func_end Double_veneer

	thumb_func_start Triple_veneer
	ldr r3, .Lram_triple
	bx r3
	func_end Triple_veneer
	.align 2, 0
.Lram_double:
	.word RAM_BASE + IwramDouble - RamBlock
.Lram_triple:
	.word RAM_BASE + IwramTriple - RamBlock

	.align 2, 0
	.global RamBlock
RamBlock:
	arm_func_start IwramNegate
	rsb r0, r0, #0
	add r0, r0, #0
	bx lr
	func_end IwramNegate

	arm_func_start IwramDouble
	add r0, r0, r0
	add r0, r0, #1
	bx lr
	func_end IwramDouble

	arm_func_start IwramTriple
	add r1, r0, r0
	add r0, r0, r1
	sub r0, r0, #1
	bx lr
	func_end IwramTriple
	.global RamBlockEnd
RamBlockEnd:

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
