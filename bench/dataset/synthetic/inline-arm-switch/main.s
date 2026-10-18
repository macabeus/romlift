@ The fixture's entry: calls Umul, a Thumb entry that switches to ARM in place, in the style of m4a's
@ umul3232H32 (`add r2, pc, #0; bx r2` and the ARM body right after it, one 16-byte function). The
@ ARM body is a function of its own too (UmulArm), as kleod and FE7J type it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #3
	movs r1, #5
	bl Umul
	bl Next
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Umul
	add r2, pc, #0
	bx r2
	arm_func_start UmulArm
	umull r2, r3, r0, r1
	add r0, r3, #0
	bx lr
	func_end UmulArm
	.size Umul, .-Umul

	thumb_func_start Next
	movs r0, #0
	adds r0, #1
	bx lr
	func_end Next
