@ Data records between functions whose halfwords decode as Thumb that opens with push {.., lr} and
@ closes with pop {.., pc}, each failing exactly one validity rule: a `bl` into a zero word, an
@ undefined halfword, a branch over a hole, a pc-relative load from Last5's code, and a pop of one
@ register more than was pushed. Each record opens a gap after a called function; the last one ends
@ where Last5 starts. gGuard words keep the others from ending where the next function starts.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Last1
	bl Last2
	bl Last3
	bl Last4
	bl Last5
	pop {r0}
	bx r0
	func_end main

	.align 2, 0
	.global gRecordCall
	.type gRecordCall, %object
gRecordCall:
	.hword 0xB510		@ push {r4, lr}
	.hword 0x2001		@ movs r0, #1
	.hword 0xF000, 0xF801	@ bl to the zero halfwords below
	.hword 0xBD10		@ pop {r4, pc}
	.hword 0x0000
	.word 0x00000000
	.size gRecordCall, .-gRecordCall

	thumb_func_start Last1
	movs r0, #0
	adds r0, #1
	bx lr
	func_end Last1

	.align 2, 0
	.global gRecordUndefined
	.type gRecordUndefined, %object
gRecordUndefined:
	.hword 0xB510		@ push {r4, lr}
	.hword 0xE800		@ undefined in Thumb
	.hword 0xBD10		@ pop {r4, pc}
	.hword 0xFFFF
	.word 0xFFFFFFFF
	.size gRecordUndefined, .-gRecordUndefined

	thumb_func_start Last2
	movs r0, #0
	adds r0, #2
	bx lr
	func_end Last2

	.align 2, 0
	.global gRecordHole
	.type gRecordHole, %object
gRecordHole:
	.hword 0xB510		@ push {r4, lr}
	.hword 0xE006		@ b over the next 14 bytes, to the pop
	.word 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF
	.hword 0xFFFF
	.hword 0xBD10		@ pop {r4, pc}
	.word 0xFFFFFFFF
	.size gRecordHole, .-gRecordHole

	thumb_func_start Last3
	movs r0, #0
	adds r0, #3
	bx lr
	func_end Last3

	.align 2, 0
	.global gRecordLoad
	.type gRecordLoad, %object
gRecordLoad:
	.hword 0xB510		@ push {r4, lr}
	ldr r0, Last5		@ a pc-relative load from Last5's first word
	.hword 0xBD10		@ pop {r4, pc}
	.hword 0xFFFF
	.word 0xFFFFFFFF
	.size gRecordLoad, .-gRecordLoad

	thumb_func_start Last4
	movs r0, #0
	adds r0, #4
	bx lr
	func_end Last4

	.align 2, 0
	.global gRecordPops
	.type gRecordPops, %object
gRecordPops:
	.word 0xFFFFFFFF
	.hword 0xB510		@ push {r4, lr}
	.hword 0x2002		@ movs r0, #2
	.hword 0xBD30		@ pop {r4, r5, pc}
	.size gRecordPops, .-gRecordPops

	thumb_func_start Last5
	movs r0, #0
	adds r0, #5
	bx lr
	func_end Last5
