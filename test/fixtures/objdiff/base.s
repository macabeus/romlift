@ The base side of the objdiff-cli fixture (test/fixtures/objdiff, build.sh): reference.s with InsnFunc's
@ second instruction a subtraction, PoolFunc's pool word naming gOther, and SectFunc's pool word naming the
@ global sectData, placed after 4 other bytes of .rodata.
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
	subs r0, r0, r1
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
	.word gOther
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
	.word sectData
	.size SectFunc, .-SectFunc

	.section .rodata
	.align 2, 0
	.byte 9, 9, 9, 9
	.global sectData
sectData:
	.byte 1, 2, 3, 4
