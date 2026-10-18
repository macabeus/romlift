@ main returns the address, size and IWRAM destination of Decoy on one path; the other path, the branch
@ target right after that return, calls CopyWords with the r1 and r2 of its caller. Decoy is data (an
@ OBJECT) whose words read as ARM code that returns, and Twice_veneer jumps through an IWRAM pointer
@ inside the range [RAM_BASE, RAM_BASE + 16) the stale values describe.
	.include "../common/macros.inc"
	.syntax unified
	.text
	.equ RAM_BASE, 0x03000000

	thumb_func_start main
	push {lr}
	cmp r0, #0
	beq .Lcopy
	ldr r0, =Decoy
	ldr r1, =RAM_BASE
	movs r2, #16
	pop {pc}
.Lcopy:
	bl CopyWords
	movs r0, #3
	bl Twice_veneer
	pop {pc}
	.align 2, 0
	.pool
	func_end main

	thumb_func_start CopyWords
	adds r2, r0, r2
.Lloop:
	cmp r0, r2
	bcs .Ldone
	ldmia r0!, {r3}
	stmia r1!, {r3}
	b .Lloop
.Ldone:
	bx lr
	func_end CopyWords

	thumb_func_start Twice_veneer
	ldr r3, .Lram_twice
	bx r3
	func_end Twice_veneer
	.align 2, 0
.Lram_twice:
	.word RAM_BASE + 8

	.section .rodata
	.align 2, 0
	.type Decoy, %object
Decoy:
	@ add r0, r0, r0; bx lr; add r0, r0, #1; bx lr
	.word 0xE0800000, 0xE12FFF1E, 0xE2800001, 0xE12FFF1E
	.size Decoy, . - Decoy
	@ Data after the decoy, so the ROM does not end at it.
	.word 0xFFFFFFFF, 0xFFFFFFFF
