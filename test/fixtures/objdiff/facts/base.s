@ The base side of the objdiff facts fixture (test/fixtures/objdiff/facts, ../build.sh): reference.s with FactsFunc's
@ pool word the plain value gRam + 8 links to (0x03000008) and its bl resolved by `as` to a local Callee after it.
	.syntax unified
	.text
	.thumb

	.align 2, 0
	.global FirstFunc
	.thumb_func
	.type FirstFunc, %function
FirstFunc:
	bx lr
	.align 2, 0
	.size FirstFunc, .-FirstFunc

	.align 2, 0
	.global FactsFunc
	.thumb_func
	.type FactsFunc, %function
FactsFunc:
	push {lr}
	bl Callee
	ldr r0, .LFactsFunc_pool
	ldr r0, [r0]
	pop {r1}
	bx r1
	.align 2, 0
.LFactsFunc_pool:
	.word 0x03000008
	.size FactsFunc, .-FactsFunc

	.thumb_func
	.type Callee, %function
Callee:
	bx lr
	.size Callee, .-Callee
