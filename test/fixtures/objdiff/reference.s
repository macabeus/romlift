@ The reference side of the objdiff-cli fixture (test/fixtures/objdiff, build.sh): four Thumb functions.
@ base.s keeps SameFunc, changes one instruction of InsnFunc, names gOther in PoolFunc's pool word where
@ this file names gTarget, and names sectData (4 bytes further into .rodata) in SectFunc's pool word where
@ this file refers to .rodata through its section symbol (a local label).
	.syntax unified
	.text
	.thumb

	.align 2, 0
	.global SameFunc
	.thumb_func
	.type SameFunc, %function
SameFunc:
	push {r4, lr}
	adds r4, r0, #1
	lsls r0, r4, #2
	pop {r4}
	pop {r1}
	bx r1
	.size SameFunc, .-SameFunc

	.align 2, 0
	.global InsnFunc
	.thumb_func
	.type InsnFunc, %function
InsnFunc:
	adds r0, r0, #1
	adds r0, r0, r1
	bx lr
	.size InsnFunc, .-InsnFunc

	.align 2, 0
	.global PoolFunc
	.thumb_func
	.type PoolFunc, %function
PoolFunc:
	ldr r0, .LPoolFunc_pool
	ldr r0, [r0]
	bx lr
	.align 2, 0
.LPoolFunc_pool:
	.word gTarget
	.size PoolFunc, .-PoolFunc

	.align 2, 0
	.global SectFunc
	.thumb_func
	.type SectFunc, %function
SectFunc:
	ldr r0, .LSectFunc_pool
	ldrb r0, [r0]
	bx lr
	.align 2, 0
.LSectFunc_pool:
	.word .LsectData
	.size SectFunc, .-SectFunc

	.section .rodata
	.align 2, 0
.LsectData:
	.byte 1, 2, 3, 4
