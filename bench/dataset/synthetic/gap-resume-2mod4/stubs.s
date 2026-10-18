@ libgcc's _call_via_rN: one 2-byte `bx rN` stub per register, back to back, so every other stub sits on 2
@ mod 4. main calls through _call_via_r0 only; _call_via_r1 and _call_via_r2 are reached by nothing. The
@ gap after _call_via_r0 starts on 2 mod 4 with a `bx r1` that is not padding: the gap scan must resume
@ there, not on the next word, or _call_via_r1 is never a candidate.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =Leaf
	bl _call_via_r0
	bl After
	pop {r1}
	bx r1
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Leaf
	movs r0, #1
	bx lr
	func_end Leaf

	thumb_func_start _call_via_r0
	bx r0
	func_end _call_via_r0

	non_word_aligned_thumb_func_start _call_via_r1
	bx r1
	func_end _call_via_r1

	non_word_aligned_thumb_func_start _call_via_r2
	bx r2
	func_end _call_via_r2

	non_word_aligned_thumb_func_start _call_via_r3
	bx r3
	func_end _call_via_r3

	thumb_func_start After
	movs r0, #2
	adds r0, r0, #1
	bx lr
	func_end After

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
