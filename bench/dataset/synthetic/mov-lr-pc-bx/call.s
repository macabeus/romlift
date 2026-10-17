@ ArmApply calls the ARM routine ArmAddOne through a register, `adr r1, ArmAddOne; mov lr, pc; bx r1`,
@ then goes on. Nothing references ArmApply; only the `adr` names ArmAddOne.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Last
	pop {r0}
	bx r0
	func_end main

	arm_func_start ArmApply
	push {r4, lr}
	mov r4, r0
	adr r1, ArmAddOne
	mov lr, pc
	bx r1
	add r0, r0, r4
	pop {r4, lr}
	bx lr
	func_end ArmApply

	arm_func_start ArmAddOne
	add r0, r0, #1
	bx lr
	func_end ArmAddOne

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
