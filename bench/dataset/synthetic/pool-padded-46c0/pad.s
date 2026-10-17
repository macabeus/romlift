@ Setup ends at 2 mod 4 and pads to its literal pool with 0x46C0 (`nop`, the fill GNU as uses for
@ code alignment in hand-written Thumb) instead of zero. Its pool word, 0x47702000, reads in Thumb as
@ `movs r0, #0; bx lr`, a stub that starts after padding.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Setup
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Setup
	ldr r0, .Lvalue
	ldr r1, =gValue
	str r0, [r1]
	movs r2, #0
	bx lr
	.hword 0x46C0
.Lvalue:
	.word 0x47702000
	.pool
	func_end Setup

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.bss
	.global gValue
gValue:
	.space 4
