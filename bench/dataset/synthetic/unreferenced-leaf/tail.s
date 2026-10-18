@ gFill, two words that do not decode as Thumb, keeps Leaf from ending where Last starts.
	.include "../common/macros.inc"
	.syntax unified
	.text

	.align 2, 0
	.global gFill
	.type gFill, %object
gFill:
	.word 0xFFFFFFFF, 0xFFFFFFFF
	.size gFill, .-gFill

	thumb_func_start Last
	movs r0, #0
	bx lr
	func_end Last
