@ libfix, fix_mem.o. FixFillWords (sig.unique-fit) loads an IWRAM address from its pool, a word the mask drops
@ whole (top byte 0x03). FixScale (sig.pinned-both-sides in library-game) is 36 bytes with two literal constants
@ that are no address, so the mask keeps them; library-game links a copy whose first constant differs, and its
@ neighbours FixFillWords and FixCopyHalves, both unique, fix where it must be. FixCopyHalves: sig.unique-fit.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start FixFillWords
	push {r4, lr}
	ldr r4, =0x03001000
	movs r3, #0
.LFixFillWords_loop:
	str r0, [r4]
	adds r4, #4
	adds r3, #1
	cmp r3, r1
	blt .LFixFillWords_loop
	pop {r4}
	pop {r0}
	bx r0
	.align 2, 0
	.pool
	func_end FixFillWords

	thumb_func_start FixScale
	push {r4, r5, lr}
	ldr r4, .LFixScale_factor
	muls r0, r4
	ldr r5, .LFixScale_bias
	adds r0, r0, r5
	asrs r0, r0, #12
	movs r1, #0xff
	ands r0, r1
	adds r0, #1
	lsls r0, r0, #1
	subs r0, #2
	pop {r4, r5}
	pop {r1}
	bx r1
	.align 2, 0
.LFixScale_factor:
	.word 0x00001234
.LFixScale_bias:
	.word 0x00000800
	func_end FixScale

	thumb_func_start FixCopyHalves
	push {r4, lr}
	movs r3, #0
.LFixCopyHalves_loop:
	ldrh r4, [r1]
	strh r4, [r0]
	adds r0, #2
	adds r1, #2
	adds r3, #1
	cmp r3, r2
	blt .LFixCopyHalves_loop
	pop {r4}
	pop {r0}
	bx r0
	func_end FixCopyHalves
