@ The fixture's entry: calls First and Last, never Leaf.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #2
	bl First
	bl Last
	pop {r0}
	bx r0
	func_end main
