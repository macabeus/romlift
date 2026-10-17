@ A callback word holding Leaf + 1 (an accepted Thumb function's address) lies in a gap, right before
@ Unreferenced, a Thumb function nothing calls, and data the gap scan cannot read through follows it.
@ Read as Thumb from the gap start, the word is `lsls; lsrs` that runs on into Unreferenced up to its
@ return: a valid reading gap.forward-chain would take for one function, swallowing Unreferenced. The
@ word is Leaf's address, so the chain declines it, the skip slot steps over it, and the chain takes
@ Unreferenced at the next word.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Leaf
	bl Tail
	pop {r1}
	bx r1
	func_end main

	thumb_func_start Leaf
	movs r0, #1
	bx lr
	func_end Leaf

	.align 2, 0
Callbacks:
	.word Leaf + 1

	thumb_func_start Unreferenced
	push {lr}
	movs r0, #3
	adds r0, #1
	pop {r1}
	bx r1
	func_end Unreferenced

	.align 2, 0
	@ Undefined Thumb encodings: the chain stops here, and the gap is not one exact tile.
	.word 0xE800E800, 0xE800E800

	thumb_func_start Tail
	movs r0, #2
	bx lr
	func_end Tail

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
