@ The last function is hand-written asm without `.size`, as tmc's intr.s is: its FUNC symbol has size 0,
@ and the data right after it, which the assembler opens with a `$d` mapping symbol, is an OBJECT. The
@ ELF's code end is that `$d` (D61 a, the owner's answer to Q5: "Use $d for every ROM"), where the
@ analysis ends the code too, not the function's start, where addr + size would put it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	ldr r0, =gValue
	bl Last
	b main
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Last
	ldr r0, [r0]
	adds r0, #1
	movs r1, #0
	bx lr

	.align 2, 0
	.global gValue
	.type gValue, %object
gValue:
	.word 0x12345678, 0x00000000
	.size gValue, .-gValue
