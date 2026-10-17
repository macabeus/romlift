@ A Thumb entry that switches to ARM with `bx pc; nop`, the ARM body following at the next word.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #5
	bl AddOne
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start AddOne
	bx pc
	nop
	func_end AddOne

	arm_func_start AddOne_arm
	add r0, r0, #1
	bx lr
	func_end AddOne_arm

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
