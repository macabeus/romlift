@ A veneer array: four two-instruction `ldr r3, [pc, #k]; bx r3` stubs laid end to end, their pool words
@ after the array, right after a table of data words. main calls the last two; the first two are
@ reached by nothing. Each unreferenced stub ends exactly where the next stub starts, so gap.end-anchor
@ takes it from the end of the gap, one element at a time, although two instructions are fewer than
@ gapScan.minInsns and its pool does not fill the hole up to the next stub.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Veneer2
	bl Veneer3
	pop {r1}
	bx r1
	func_end main

	.align 2, 0
	@ Data right before the array (undefined Thumb encodings): no forward chain runs from main into the stubs.
Table:
	.word 0xE800E800, 0xE800E800, 0xE800E800, 0xE800E800

	thumb_func_start Veneer0
	ldr r3, .Lp0
	bx r3
	func_end Veneer0

	non_word_aligned_thumb_func_start Veneer1
	ldr r3, .Lp1
	bx r3
	func_end Veneer1

	non_word_aligned_thumb_func_start Veneer2
	ldr r3, .Lp2
	bx r3
	func_end Veneer2

	non_word_aligned_thumb_func_start Veneer3
	ldr r3, .Lp3
	bx r3
	func_end Veneer3
	.align 2, 0
.Lp0:
	.word Target0 + 1
.Lp1:
	.word Target1 + 1
.Lp2:
	.word Target2 + 1
.Lp3:
	.word Target3 + 1

	thumb_func_start Target0
	movs r0, #0
	bx lr
	func_end Target0

	thumb_func_start Target1
	movs r0, #1
	bx lr
	func_end Target1

	thumb_func_start Target2
	movs r0, #2
	bx lr
	func_end Target2

	thumb_func_start Target3
	movs r0, #3
	bx lr
	func_end Target3

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
