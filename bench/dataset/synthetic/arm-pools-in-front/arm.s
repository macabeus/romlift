@ A hand-written ARM routine whose literal words sit in front of its entry and are loaded with
@ negative pc-relative offsets. Nothing references the routine (it is copied or called from code this
@ fixture does not model), so only a scan of the gap after main finds it.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Last
	pop {r0}
	bx r0
	func_end main

	.align 2, 0
	.global gArmWords
	.type gArmWords, %object
gArmWords:
	.word 0x04000000
	.word 0x03007FFC
	.size gArmWords, .-gArmWords

	arm_func_start ArmSetVector
	ldr r0, gArmWords
	ldr r1, gArmWords + 4
	str r0, [r1]
	mov r0, #0
	bx lr
	func_end ArmSetVector

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last
