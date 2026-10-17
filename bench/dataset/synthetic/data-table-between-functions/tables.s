@ Three data tables sit between functions. The function after each is found by a different piece of
@ evidence, because a table ends the forward scan of a gap: Mid by its pool pointer and prologue,
@ Tidy by ending where Last1 starts, Frame by its prologue and ending where Last2 starts. gSizesA
@ decodes as shifts that run into Mid; gOffsetsB and gOffsetsC hold negative offsets, halfwords that do
@ not decode as Thumb at all.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =Mid
	ldr r1, =gHook
	str r0, [r1]
	bl Last1
	bl Last2
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	.global gSizesA
	.type gSizesA, %object
gSizesA:
	.hword 1, 2, 4, 8, 16, 32
	.size gSizesA, .-gSizesA

	thumb_func_start Mid
	push {r4, lr}
	adds r4, r0, #0
	adds r0, r4, r4
	pop {r4}
	pop {r1}
	bx r1
	func_end Mid

	.align 2, 0
	.global gOffsetsB
	.type gOffsetsB, %object
gOffsetsB:
	.hword -1, -3, -5, -7
	.size gOffsetsB, .-gOffsetsB

	thumb_func_start Tidy
	lsls r0, r0, #2
	adds r0, #3
	bx lr
	func_end Tidy

	thumb_func_start Last1
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last1

	.align 2, 0
	.global gOffsetsC
	.type gOffsetsC, %object
gOffsetsC:
	.hword -2, -4, -6, -8
	.size gOffsetsC, .-gOffsetsC

	thumb_func_start Frame
	push {r4, lr}
	pop {r4, pc}
	func_end Frame

	thumb_func_start Last2
	movs r0, #1
	adds r0, #4
	bx lr
	func_end Last2

	.bss
	.global gHook
gHook:
	.space 4
