@ A table of entry stubs that share one tail, as hand-written code writes them: each entry loads its own
@ constant into r1 and branches to the common code (the last falls into it). main calls LavaFx and PitFx;
@ DrownFx and SwampFx are reached by nothing. Read from LavaFx, the stubs after it are unreached bytes inside its
@ extent; SwampFx is a copy of LavaFx's own entry stub (`movs r1, #k; b Common`), so it is another entry
@ of the table, not dead code: claim.dead-code-in-extent leaves its four bytes free, and the gap scan
@ takes it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #1
	bl LavaFx
	bl PitFx
	pop {r1}
	bx r1
	func_end main

	thumb_func_start DrownFx
	movs r1, #11
	b Common
	func_end DrownFx

	non_word_aligned_thumb_func_start LavaFx
	movs r1, #12
	b Common
	func_end LavaFx

	non_word_aligned_thumb_func_start SwampFx
	movs r1, #82
	b Common
	func_end SwampFx

	non_word_aligned_thumb_func_start PitFx
	movs r1, #0
Common:
	push {r4, lr}
	adds r4, r0, #0
	adds r0, r4, r1
	pop {r4}
	pop {r1}
	bx r1
	func_end PitFx

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
