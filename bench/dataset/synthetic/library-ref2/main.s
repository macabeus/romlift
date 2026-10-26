@ The game code of the library-ref2 fixture (reference 2 of libfix): it links fix_math.o, fix_short.o and
@ fix_util.o, and calls every member, so the discover analysis finds each one by its call.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #7
	movs r1, #9
	bl FixMulShift
	bl FixShort
	bl FixAbs
	bl FixReturnZero
	bl FixReturnOne
	pop {r0}
	bx r0
	func_end main
