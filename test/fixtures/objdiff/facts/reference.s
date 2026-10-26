@ The reference side of the objdiff facts fixture (test/fixtures/objdiff/facts, ../build.sh; architecture-r2-3): a
@ function at a non-zero section offset whose pool word relocates against gRam + 8 and whose bl relocates against
@ the external Callee. base.s holds the same bytes with neither relocation: the pool word the plain value
@ 0x03000008, the bl resolved to a local Callee, so objdiffDifferences must give each difference its section base,
@ its offset, the reference addend and the base field.
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
	.word gRam + 8
	.size FactsFunc, .-FactsFunc
