@ An unreferenced hand-written function on 2 mod 4, opening with `push {r4, lr}`, right after a data
@ halfword that decodes as `movs r0, #1`. Both readings at the end of the gap are valid and fill it up to
@ Next: the word one at the data halfword (it runs into the push) and the halfword one at the push. A
@ prologue wins over a reading without one, so gap.end-anchor takes Helper and the data halfword stays
@ data; a scan of words only would take the data halfword and lose Helper.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #4
	bl Next
	pop {r1}
	bx r1
	func_end main

	.align 2, 0
	@ Data the forward chain cannot read through (undefined Thumb encodings), then the halfword.
Table:
	.word 0xE800E800, 0xE800E800
	.short 0x2001

	non_word_aligned_thumb_func_start Helper
	push {r4, lr}
	movs r4, #3
	adds r0, r0, r4
	pop {r4}
	pop {r1}
	bx r1
	func_end Helper

	thumb_func_start Next
	movs r1, #2
	muls r0, r1
	bx lr
	func_end Next

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
