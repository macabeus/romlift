@ The fixture's entry: calls the compiled Rec, which calls itself across a body longer than a `b`
@ reaches; Fatal, Rec's guard, never returns.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #3
	bl Rec
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Fatal
	b Fatal
	func_end Fatal

	.bss
	.global gBuf
gBuf:
	.space 0x400
	.global gOut
gOut:
	.space 4
