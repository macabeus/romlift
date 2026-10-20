@ Hand-written code an assembly-only module must hold: HandSharer ends by branching into HandOwner's
@ epilogue (a shared tail, the short branch no border may cut), HandHalf starts at 2 mod 4 right after
@ it, and HandIrq is ARM, named only by the interrupt vector main stores.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start HandOwner
	push {r4, lr}
	adds r4, r0, #0
	adds r0, #1
.LsharedTail:
	adds r0, r0, r4
	pop {r4}
	pop {r1}
	bx r1
	func_end HandOwner

	thumb_func_start HandSharer
	push {r4, lr}
	movs r4, #3
	b .LsharedTail
	func_end HandSharer

	non_word_aligned_thumb_func_start HandHalf
	adds r0, r0, r1
	bx lr
	func_end HandHalf

	arm_func_start HandIrq
	ldr r0, =0x04000200
	ldr r1, [r0]
	str r1, [r0]
	bx lr
	.pool
	func_end HandIrq
