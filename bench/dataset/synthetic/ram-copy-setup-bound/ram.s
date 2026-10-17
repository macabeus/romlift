@ main copies a block of ARM routines from the cartridge to IWRAM (CopyWords(source, destination, size))
@ with an argument setup of exactly 12 straight-line instructions, the profile's ramCopy.argInsns: the
@ source is loaded first, then the size (end - start, rounded to words) and the destination, behind a
@ `cmp; beq` guard for an empty block. The block is linked at its load address after every other
@ function, so no ROM address names it: with a window one shorter the source is unknown and the block is
@ lost.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start main
	push {lr}
	ldr r0, =RamBlock
	ldr r3, =RamBlockEnd
	ldr r2, =RamBlock
	subs r2, r3, r2
	lsrs r2, r2, #2
	lsls r2, r2, #2
	ldr r1, =RAM_BASE
	movs r3, #0
	adds r1, r1, r3
	cmp r2, #0
	beq .Lskip
	movs r3, #7
	bl CopyWords
.Lskip:
	movs r0, #7
	bl Double_veneer
	bl Triple_veneer
	pop {r1}
	bx r1
	.align 2, 0
	.pool
	func_end main

	thumb_func_start CopyWords
	adds r2, r0, r2
.Lcopy:
	cmp r0, r2
	bcs .Ldone
	ldmia r0!, {r3}
	stmia r1!, {r3}
	b .Lcopy
.Ldone:
	bx lr
	func_end CopyWords

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
RamBlockEnd:

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
