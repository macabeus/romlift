@ InstallHandler stores the address of a handler block it computes with `adr`; the block follows the
@ function's pool and leaves only by branching back into the function, the way hand-written interrupt
@ code is laid out. The block is part of InstallHandler (its FUNC size covers it), not an entry.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl InstallHandler
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start InstallHandler
	push {r4, lr}
	adr r0, .Lhandler
	ldr r1, =gHandler
	str r0, [r1]
.Lresume:
	movs r0, #0
	pop {r4}
	pop {r1}
	bx r1
	.align 2, 0
	.pool
.Lhandler:
	movs r2, #1
	b .Lresume
	func_end InstallHandler

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.bss
	.global gHandler
gHandler:
	.space 4
