@ The fixture's entry: calls Next and the compiled MainLoop, whose branch over its body is a far jump.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #1
	bl Next
	bl MainLoop
	pop {r0}
	bx r0
	func_end main

	.bss
	.global gBuf
gBuf:
	.space 0x400
	.global gOut
gOut:
	.space 4
