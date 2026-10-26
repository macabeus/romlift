@ The game code after libfix in library-game: GameTail follows FixShort, a neighbour no reference has. It loads a
@ Thumb pointer into its own code (GameTail + 4, its third instruction), which the analysis harvests from the pool and
@ valid.in-rom-unclaimed rejects as inside claimed bytes: the explain golden of that rule (test/golden/explain).
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start GameTail
	movs r0, #9
	ldr r2, =GameTail + 4
	adds r0, r0, r1
	lsls r0, r0, #1
	bx lr
	.align 2, 0
	.pool
	func_end GameTail
