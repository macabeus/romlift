@ ArmSum is ARM and unreferenced. Its first word, push {r4-r6, r8-r10, lr} (0xE92D4770), reads in Thumb
@ as `bx lr` followed by an invalid halfword: a one-instruction Thumb stub anchored after main.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Last
	pop {r0}
	bx r0
	func_end main

	arm_func_start ArmSum
	push {r4, r5, r6, r8, r9, r10, lr}
	mov r4, r0
	add r0, r4, r1
	pop {r4, r5, r6, r8, r9, r10, lr}
	bx lr
	func_end ArmSum

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
