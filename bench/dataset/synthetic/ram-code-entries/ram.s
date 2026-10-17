@ main copies a block of ARM routines from the cartridge to IWRAM (CopyWords(source, destination, size),
@ the size computed as end - start, as agbcc emits it) and calls two of them through load-and-jump veneers
@ that name their IWRAM addresses. The block is linked at its load address, after every other function
@ (as zeldaret-tmc links its RAM functions), so no ROM address names it and the code end stops before it
@ unless the copy maps the veneers' IWRAM pointers back to the ROM.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start main
	push {lr}
	ldr r0, =RamBlockEnd
	ldr r3, =RamBlock
	subs r2, r0, r3
	adds r0, r3, #0
	ldr r1, =RAM_BASE
	bl CopyWords
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
