@ Sharer ends by branching into Owner's epilogue, a tail shared the way hand-written code (m4a) does.
@ main calls Owner and registers Sharer as a callback, so Sharer is judged valid after Owner is accepted.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #2
	bl Owner
	ldr r0, =Sharer
	ldr r1, =gCallback
	str r0, [r1]
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Owner
	push {r4, lr}
	adds r4, r0, #0
	adds r0, #1
.LsharedTail:
	adds r0, r0, r4
	pop {r4}
	pop {r1}
	bx r1
	func_end Owner

	thumb_func_start Sharer
	push {r4, lr}
	movs r4, #3
	b .LsharedTail
	func_end Sharer

	.bss
	.global gCallback
gCallback:
	.space 4
