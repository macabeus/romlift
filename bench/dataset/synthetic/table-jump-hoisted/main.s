@ The fixture's entry: calls the compiled switch and the function after it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #3
	movs r1, #9
	bl Dispatch
	bl After
	pop {r0}
	bx r0
	func_end main

	.bss
	.global gState
gState:
	.space 4
	.global gMode
gMode:
	.space 4
