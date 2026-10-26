@ libfix, fix_short.o: FixShort, the short member only this reference links (6 bytes, fewer than the matcher's 12),
@ so the version takes it from here. In library-game it sits after the last libfix member, outside the span its
@ neighbours here (FixClamp, FixAbs) give it, and its bytes also occur far from the library (GameShift): only its
@ fit within 64 bytes of a matched member places it (sig.short-member-window).
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start FixShort
	lsls r0, r0, #2
	adds r0, #1
	bx lr
	func_end FixShort
