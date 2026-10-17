@ gTasks, a table of four Thumb pointers to the task functions, sits between TaskD and Last; as Thumb
@ its words decode as a run of shifts into Last. After Last, a zero word of padding precedes Spare, an
@ unreferenced leaf; gEnd keeps Spare from ending where Last2 starts.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =gTasks
	ldr r1, =gTaskList
	str r0, [r1]
	bl TaskA
	bl TaskB
	bl TaskC
	bl TaskD
	bl Last
	bl Last2
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

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

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.align 2, 0
	.word 0

	thumb_func_start Spare
	lsls r0, r0, #1
	adds r0, #3
	bx lr
	func_end Spare

	.align 2, 0
	.global gEnd
	.type gEnd, %object
gEnd:
	.word 0xFFFFFFFF
	.size gEnd, .-gEnd

	thumb_func_start Last2
	movs r0, #0
	adds r0, #5
	bx lr
	func_end Last2

	.bss
	.global gTaskList
gTaskList:
	.space 4
