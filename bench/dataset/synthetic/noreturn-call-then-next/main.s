@ The fixture's entry: registers Abort as a callback (a pool pointer, so Abort is judged valid before
@ it is accepted) and calls Next.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =Abort
	ldr r1, =gOnError
	str r0, [r1]
	movs r0, #4
	bl Next
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	.bss
	.global gOnError
gOnError:
	.space 4
	.global gLimit
gLimit:
	.space 4
