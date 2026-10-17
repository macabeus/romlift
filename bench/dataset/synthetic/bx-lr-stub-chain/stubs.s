@ A chain of `bx lr` stubs (as m4a keeps for its unused sound hooks) after a called function. No code
@ and no data names them; each starts where the claimed bytes before it end.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl First
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start First
	movs r0, #1
	adds r0, #2
	bx lr
	func_end First

	thumb_func_start DummyHookA
	bx lr
	func_end DummyHookA

	thumb_func_start DummyHookB
	movs r0, #0
	bx lr
	func_end DummyHookB

	thumb_func_start DummyHookC
	bx lr
	func_end DummyHookC

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
