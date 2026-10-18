@ LoadMagic loads a constant that a hand-written module keeps after Store, far from LoadMagic. The
@ word, 0xBD00B500, reads in Thumb as `push {lr}; pop {pc}`. The halfwords of gScale after it read as
@ `movs r0, #1; b .Lmagic`, a branch back into that frame.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl LoadMagic
	bl Store
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start LoadMagic
	ldr r0, .Lmagic
	adds r0, #1
	bx lr
	func_end LoadMagic

	thumb_func_start Store
	ldr r1, =gMagic
	str r0, [r1]
	adds r0, #0
	bx lr
	.align 2, 0
	.pool
	func_end Store

	.align 2, 0
.Lmagic:
	.word 0xBD00B500

	.global gScale
	.type gScale, %object
gScale:
	.hword 0x2001		@ movs r0, #1
	b .Lmagic		@ 0xE7FD
	.size gScale, .-gScale

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.bss
	.global gMagic
gMagic:
	.space 4
