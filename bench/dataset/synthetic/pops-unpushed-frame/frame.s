@ Caller is hand-written: it keeps a 1.6 KiB lookup table between its code and its epilogue and reaches
@ the epilogue only with a far `bl`. It also calls Leaf, 1.6 KiB behind it (gBlob keeps them apart,
@ gGuard keeps Leaf from starting where main's bytes end), and CleanupArg, past its table, which
@ opens with push {lr} and pops the stack argument Caller pushed for it, and DropArg, which only drops
@ such an argument and is first accepted as the near callee of Nudge.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #3
	bl Caller
	bl Nudge
	pop {r0}
	bx r0
	func_end main

	.align 2, 0
	.global gGuard
	.type gGuard, %object
gGuard:
	.word 0xFFFFFFFF
	.size gGuard, .-gGuard

	thumb_func_start Leaf
	adds r0, #1
	bx lr
	func_end Leaf

	.align 2, 0
	.global gBlob
	.type gBlob, %object
gBlob:
	.fill 0x640, 1, 0xFF
	.size gBlob, .-gBlob

	thumb_func_start Caller
	push {r4, r5, r6, r7, lr}
	adds r4, r0, #0
	bl Leaf
	push {r0}
	bl CleanupArg
	adds r4, r4, r0
	push {r0}
	bl DropArg
	ldr r0, =gValue
	str r4, [r0]
	bl .Lepilogue
	.align 2, 0
	.pool
.Llookup:
	.fill 0x640, 1, 0xFF
.Lepilogue:
	pop {r4, r5, r6, r7}
	pop {r0}
	bx r0
	func_end Caller

	thumb_func_start CleanupArg
	push {lr}
	movs r0, #0
	pop {r3}
	add sp, #4
	bx r3
	func_end CleanupArg

	thumb_func_start DropArg
	add sp, #4
	bx lr
	func_end DropArg

	thumb_func_start Nudge
	push {lr}
	push {r0}
	bl DropArg
	pop {r0}
	bx r0
	func_end Nudge

	.bss
	.global gValue
gValue:
	.space 4
