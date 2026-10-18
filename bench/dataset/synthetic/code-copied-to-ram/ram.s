@ main copies an ARM routine from the cartridge to IWRAM and calls it there through _call_via_r3.
@ The routine is linked at 0x03000000 (section .iwram) with its load address after the ROM code.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =__iwram_lma
	ldr r1, =__iwram_start
	ldr r2, =__iwram_end
	bl CopyWords
	movs r0, #7
	ldr r3, =IwramDouble
	bl _call_via_r3
	pop {r1}
	bx r1
	.align 2, 0
	.pool
	func_end main

	thumb_func_start CopyWords
.Lcopy:
	cmp r1, r2
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

	.section .iwram, "ax", %progbits
	arm_func_start IwramDouble
	add r0, r0, r0
	add r0, r0, #1
	bx lr
	func_end IwramDouble
