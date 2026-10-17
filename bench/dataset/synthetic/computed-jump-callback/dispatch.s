@ main stores Dispatch's address in gCallback and calls Last. Dispatch, right after main's pool, reads
@ the handler pointer from gHandler and jumps through it with `mov pc, r1`; it has no prologue and no
@ return of its own.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =Dispatch
	ldr r1, =gCallback
	str r0, [r1]
	bl Last
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Dispatch
	ldr r1, =gHandler
	ldr r1, [r1]
	adds r0, #1
	mov pc, r1
	.align 2, 0
	.pool
	func_end Dispatch

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.bss
	.global gCallback
gCallback:
	.space 4
	.global gHandler
gHandler:
	.space 4
