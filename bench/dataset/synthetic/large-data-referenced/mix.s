@ gMixer holds the only pointer to Mix, in .rodata after the code. gStop, a word of data that is no
@ instruction and no pointer, separates main from Mix. Mix pushes lr, runs 2100 additions (4200 bytes)
@ and returns through r1; Last, called by main, follows it directly.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Last
	pop {r0}
	bx r0
	func_end main

	.align 2, 0
	.global gStop
	.type gStop, %object
gStop:
	.word 0xFFFFFFFF
	.size gStop, .-gStop

	thumb_func_start Mix
	push {lr}
	.rept 2100
	adds r0, #1
	.endr
	pop {r1}
	bx r1
	func_end Mix

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.section .rodata
	.align 2, 0
	.global gMixer
	.type gMixer, %object
gMixer:
	.word Mix
	.size gMixer, .-gMixer
