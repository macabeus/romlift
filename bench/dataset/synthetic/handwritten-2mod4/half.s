@ JumpAdd is a hand-written trampoline at a 2-mod-4 address: it adds and jumps through r2 with
@ `mov pc, r2` (no jump table). Tail follows it after a zero halfword; main registers Tail as a callback.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Lead
	ldr r2, =Tail
	movs r1, #1
	bl JumpAdd
	ldr r0, =Tail
	ldr r1, =gNext
	str r0, [r1]
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Lead
	movs r0, #1
	adds r0, #2
	bx lr
	func_end Lead

	non_word_aligned_thumb_func_start JumpAdd
	adds r0, r0, r1
	mov pc, r2
	func_end JumpAdd

	thumb_func_start Tail
	lsls r0, r0, #1
	adds r0, #1
	bx lr
	func_end Tail

	.bss
	.global gNext
gNext:
	.space 4
