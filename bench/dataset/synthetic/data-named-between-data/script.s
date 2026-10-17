@ A function named only by one word of data (a script command table), sitting between two blocks of data
@ inside the code: no code calls or loads it, no other pointer runs beside it, and neither its start nor
@ its end touches another function, so no gap rule reaches it. It opens with push {lr}, calls an
@ accepted function and returns.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Helper
	bl Last
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Helper
	movs r0, #1
	bx lr
	func_end Helper

	.align 2, 0
ScriptData1:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	thumb_func_start ScriptCallback
	push {lr}
	bl Helper
	pop {pc}
	func_end ScriptCallback

	.align 2, 0
ScriptData2:
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF

	thumb_func_start Last
	movs r0, #2
	bx lr
	func_end Last

	.section .rodata
	.align 2, 0
ScriptCommands:
	.word 0x00000001, ScriptCallback + 1, 0x00000002, 0x00000000
