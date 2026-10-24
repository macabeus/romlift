@ The game code of the library fixture (reference 1 of libfix): main calls every libfix member it links, so the
@ discover analysis finds each one by its call.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {r4, lr}
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
	pop {r4}
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main
