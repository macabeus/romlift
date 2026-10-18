@ The last function is followed by data whose halfwords decode as a chain of Thumb stubs. Nothing
@ points into the data with a Thumb bit, so the code ends where Last ends. main is a loop that never
@ returns and saves no registers, as a game's main loop is.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	ldr r0, =gPalette
	bl Last
	b main
	.align 2, 0
	.pool
	func_end main

	thumb_func_start Last
	ldrh r0, [r0]
	adds r0, #4
	bx lr
	func_end Last

	.align 2, 0
	.global gPalette
	.type gPalette, %object
gPalette:
	.hword 0x2001, 0x4770, 0x2002, 0x4770
	.hword 0xB500, 0x2003, 0xBD00, 0x0000
	.size gPalette, .-gPalette
