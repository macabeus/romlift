@ gTasks, four Thumb pointers to TaskA-TaskD, sits between TaskD and Leaf; as Thumb its words decode as
@ shifts (0x01xx: lsls; 0x0800: lsrs #32) that run into Leaf's code. gTaskRef holds the table's address
@ with the Thumb bit set, as a dispatcher that jumps through `bx` stores it. Caller is named by nothing
@ and calls Leaf; Last closes the gap after Leaf.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl TaskA
	bl TaskB
	bl TaskC
	bl TaskD
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Caller
	push {lr}
	bl Leaf
	pop {r1}
	bx r1
	func_end Caller

	thumb_func_start TaskA
	movs r0, #1
	bx lr
	func_end TaskA

	thumb_func_start TaskB
	movs r0, #2
	bx lr
	func_end TaskB

	thumb_func_start TaskC
	movs r0, #3
	bx lr
	func_end TaskC

	thumb_func_start TaskD
	movs r0, #4
	bx lr
	func_end TaskD

	.align 2, 0
	.global gTasks
	.type gTasks, %object
gTasks:
	.word TaskA
	.word TaskB
	.word TaskC
	.word TaskD
	.size gTasks, .-gTasks

	thumb_func_start Leaf
	lsls r0, r0, #1
	adds r0, #3
	bx lr
	func_end Leaf

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.section .rodata
	.align 2, 0
	.global gTaskRef
	.type gTaskRef, %object
gTaskRef:
	.word gTasks + 1
	.size gTaskRef, .-gTaskRef
