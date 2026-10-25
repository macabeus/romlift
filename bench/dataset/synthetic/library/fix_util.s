@ libfix, fix_util.o. FixAbs (sig.unique-fit) is 14 bytes, so two bytes of zero padding follow it and no run in
@ link order reaches past it. FixReturnZero and FixReturnOne are 4-byte members whose bytes other code has too
@ (library-game's GameReturnZero): too short for a fit of their own and cut off from any run, they are placed at
@ their reference spacing from the matched FixAbs, then from each other (sig.neighbour-spacing).
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start FixAbs
	cmp r0, #0
	bge .LFixAbs_positive
	negs r0, r0
.LFixAbs_positive:
	lsls r0, r0, #16
	lsrs r0, r0, #16
	adds r0, #0
	bx lr
	func_end FixAbs

	thumb_func_start FixReturnZero
	movs r0, #0
	bx lr
	func_end FixReturnZero

	thumb_func_start FixReturnOne
	movs r0, #1
	bx lr
	func_end FixReturnOne
