@ main registers a table of three Thumb pointers to leaf handlers; nothing else names the handlers.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =gHandlers
	ldr r1, =gCallbacks
	str r0, [r1]
	bl Last
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	.align 2, 0
	.global gHandlers
	.type gHandlers, %object
gHandlers:
	.word HandlerA
	.word HandlerB
	.word HandlerC
	.size gHandlers, .-gHandlers

	thumb_func_start HandlerA
	movs r0, #1
	bx lr
	func_end HandlerA

	thumb_func_start HandlerB
	movs r0, #2
	bx lr
	func_end HandlerB

	thumb_func_start HandlerC
	movs r0, #3
	bx lr
	func_end HandlerC

	thumb_func_start Last
	ldr r1, =gCallbacks
	movs r0, #0
	str r0, [r1]
	bx lr
	.align 2, 0
	.pool
	func_end Last

	.bss
	.global gCallbacks
gCallbacks:
	.space 4
