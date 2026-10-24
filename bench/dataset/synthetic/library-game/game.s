@ The game code before libfix in library-game: other neighbours than the references'. GameShift has FixShort's
@ bytes and GameReturnZero FixReturnZero's, so neither library member fits at one place only; GameFiller keeps
@ GameShift more than 64 bytes from the first libfix member, outside the matcher's window.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {r4, lr}
	bl GameShift
	bl GameReturnZero
	bl GameFiller
	movs r0, #3
	movs r1, #5
	bl FixMulShift
	movs r1, #4
	bl FixFillWords
	movs r0, #2
	bl FixScale
	ldr r0, =0x02000000
	ldr r1, =0x02000100
	movs r2, #8
	bl FixCopyHalves
	bl FixSwiDiv
	bl FixSwiSqrt
	bl FixSwiCpuSet
	bl FixSwiHalt
	bl FixAbs
	bl FixReturnZero
	bl FixReturnOne
	bl FixShort
	bl GameTail
	pop {r4}
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	thumb_func_start GameShift
	lsls r0, r0, #2
	adds r0, #1
	bx lr
	func_end GameShift

	thumb_func_start GameReturnZero
	movs r0, #0
	bx lr
	func_end GameReturnZero

	thumb_func_start GameFiller
	push {r4, lr}
	adds r4, r0, #0
	.rept 18
	adds r0, r0, r1
	eors r1, r4
	.endr
	pop {r4}
	pop {r1}
	bx r1
	func_end GameFiller
