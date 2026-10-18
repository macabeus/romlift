@ The last function is hand-written asm without `.size`, as tmc's intr.s is: its FUNC symbol has size 0,
@ and right after it comes an untyped pool (`.word`s with no `.type`), which the assembler opens with a
@ `$d` mapping symbol, and then an OBJECT, as tmc's `$d` at 0x080B2A30 opens a pool 0x40 bytes before
@ its next typed symbol. The ELF's code end is that `$d`, 0x08000108 (D61 a, the owner's answer to Q5:
@ "Use $d for every ROM"), where the analysis ends the code too: not the function's start, 0x08000100,
@ where addr + size would put it, and not the OBJECT, 0x08000110, where the next typed symbol would
@ (overfitting-correctness-r1-3).
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
	.word 0xA5A5A5A5, 0x5A5A5A5A

	.global gValue
	.type gValue, %object
gValue:
	.word 0x12345678, 0x00000000
	.size gValue, .-gValue
