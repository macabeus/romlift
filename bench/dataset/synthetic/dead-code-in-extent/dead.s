@ Pick branches over a stub-shaped block that no path reaches: dead code inside its extent.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	movs r0, #1
	bl Pick
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Pick
	adds r1, r0, #0
	cmp r0, #0
	beq .Lzero
	b .Ldone
	movs r0, #0
	bx lr
.Lzero:
	adds r0, #1
.Ldone:
	adds r0, r0, r1
	bx lr
	func_end Pick

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
