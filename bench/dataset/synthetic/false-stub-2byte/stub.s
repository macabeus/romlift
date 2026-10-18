@ Choose jumps through a two-entry table; after its case blocks comes a lone `b` that nothing reaches,
@ a 2-byte fragment that starts where Choose's code ends.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #1
	bl Choose
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Choose
	lsls r0, r0, #2
	ldr r1, =.Lcases
	adds r0, r0, r1
	ldr r0, [r0]
	mov pc, r0
	.align 2, 0
	.pool
.Lcases:
	.word .Lcase0
	.word .Lcase1
.Lcase0:
	movs r0, #10
	bx lr
.Lcase1:
	movs r0, #20
	bx lr
	func_end Choose

	.align 2, 0
	b .Lcase1
	.align 2, 0

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
