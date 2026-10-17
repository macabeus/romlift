@ Twice calls a local subroutine placed inside its own body, between its two calls, the way
@ hand-written code keeps a helper next to its only caller.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #1
	bl Twice
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Twice
	push {lr}
	bl Increment
	b .Lsecond

	thumb_func_start Increment
	adds r0, #1
	bx lr
	func_end Increment

.Lsecond:
	bl Increment
	pop {r1}
	bx r1
	.size Twice, .-Twice
