@ Hand-written ARM uses `adr` for two things that are no function: the address of one of its own labels
@ (a return address it stores for a handler, inside its own extent), and a table of words after its code
@ that it loads with `ldm` (words that do not read as ARM code). seed.adr proposes neither; only an
@ unclaimed address past the function's extent that reads as ARM code would open a function.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #5
	bl Work
	bl Last
	pop {r1}
	bx r1
	func_end main

	thumb_func_start Work
	bx pc
	nop
	func_end Work

	arm_func_start Work_arm
	push {r4, lr}
	adr r4, Table
	ldm r4, {r1, r2}
	adr r3, .Lresume
	str r3, [r1]
	add r0, r0, r2
.Lresume:
	add r0, r0, #1
	pop {r4, lr}
	bx lr
	func_end Work_arm

	.align 2, 0
Table:
	@ Undefined as ARM (UDF) and as Thumb (the low halfword is 0xE8F0): not code in either mode.
	.word 0xE7F0E8F0, 0xE7F0E8F1

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
