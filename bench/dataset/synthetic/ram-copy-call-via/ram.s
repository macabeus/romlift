@ main copies a block of ARM routines from the cartridge to IWRAM (CopyWords(source, destination, size))
@ and calls two of them by loading their IWRAM addresses into r3 and calling libgcc's `_call_via_r3`
@ (`bx r3`), as agbcc emits a call through a function pointer. The block is linked at its load address
@ after every other function, so no ROM address names it: only the `bl` to a `bx r3` stub after the
@ pointer load tells that main jumps through it.
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
	ldr r3, .Lram_double
	bl _call_via_r3
	ldr r3, .Lram_triple
	bl _call_via_r3
	pop {r1}
	bx r1
	.align 2, 0
.Lram_double:
	.word RAM_BASE + IwramDouble - RamBlock
.Lram_triple:
	.word RAM_BASE + IwramTriple - RamBlock
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

	thumb_func_start _call_via_r3
	bx r3
	func_end _call_via_r3

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
