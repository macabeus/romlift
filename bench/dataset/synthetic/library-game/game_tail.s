@ The game code after libfix in library-game: GameTail follows FixShort, a neighbour no reference has.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start GameTail
	movs r0, #9
	adds r0, r0, r1
	lsls r0, r0, #1
	bx lr
	func_end GameTail
