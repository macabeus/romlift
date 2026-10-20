@ A Thumb function whose address code takes with `adr`: main in Thumb, which also calls it, and Work_arm in ARM,
@ which stores it, each load the word-aligned address of Handler (the ARM one after Handler, the Thumb one before
@ it). The source names that address by the local label .Lhandler. `adr r0, Handler` would name a symbol that
@ links to Handler + 1: romlift's text-layout check resolves it to that and refuses the Thumb adr, and GNU as with
@ -mthumb-interwork assembles the ARM adr, Handler being defined before it, to Handler + 1.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	adr r0, .Lhandler
	bl Handler
	bl Work
	pop {r1}
	bx r1
	func_end main

	.align 2, 0
.Lhandler:
	thumb_func_start Handler
	movs r0, #1
	bx lr
	func_end Handler

	thumb_func_start Work
	bx pc
	nop
	func_end Work

	arm_func_start Work_arm
	adr r1, .Lhandler
	str r1, [r0]
	bx lr
	func_end Work_arm

	.section .rodata
	@ Data after the code, so the ROM does not end at the code end.
	.word 0xFFFFFFFF, 0xFFFFFFFF
