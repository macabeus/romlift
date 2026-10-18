@ DoReset clears the soft-reset flag and calls the BIOS SoftReset (`swi 0`), which never returns; its
@ literal pool follows the swi directly. main registers it as a callback, so it is judged valid first.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	ldr r0, =DoReset
	ldr r1, =gOnReset
	str r0, [r1]
	bl Last
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end main

	thumb_func_start DoReset
	ldr r0, =0x03007FFA
	movs r1, #0
	strb r1, [r0]
	swi 0x00
	.align 2, 0
	.pool
	func_end DoReset

	thumb_func_start Last
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last

	.bss
	.global gOnReset
gOnReset:
	.space 4
