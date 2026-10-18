@ Two hand-written mixers in the style of m4a's SoundMainRAM: Thumb functions that keep an ARM routine
@ inside their own body and jump around it, so a Thumb reading is not dense. Mixer opens the gap after
@ Before; Mixer2 follows an unreferenced leaf, and its tail alone (`movs; adds; bx lr`) reads as a
@ valid leaf that ends where After2 starts. Both mixers end where a called function starts. Each ARM
@ routine is a FUNC of its own, lying in its mixer's hole.
	.include "../common/macros.inc"
	.syntax unified
	.text

	thumb_func_start main
	push {lr}
	bl Before
	bl After1
	bl After2
	pop {r0}
	bx r0
	func_end main

	thumb_func_start Before
	movs r0, #0
	adds r0, #1
	bx lr
	func_end Before

	thumb_func_start Mixer
	push {r4, r5, r6, r7, lr}
	ldr r4, .LmixBuf
	cmp r0, #0
	beq .LmixTail
	adr r1, MixerArm
	bx r1
	.align 2, 0
.LmixBuf:
	.word gMixBuf
	arm_func_start MixerArm
	ldr r2, .LmixBuf
	add r2, r2, r0
	str r0, [r2]
	bx lr
	func_end MixerArm
	.thumb
.LmixTail:
	movs r0, #1
	pop {r4, r5, r6, r7}
	pop {r1}
	bx r1
	func_end Mixer

	thumb_func_start After1
	movs r0, #0
	adds r0, #2
	bx lr
	func_end After1

	thumb_func_start Leaf2
	lsls r0, r0, #1
	adds r0, #3
	bx lr
	func_end Leaf2

	thumb_func_start Mixer2
	cmp r0, #0
	beq .Lmix2Tail
	adr r1, Mixer2Arm
	bx r1
	arm_func_start Mixer2Arm
	add r2, r0, r0
	str r2, [r3]
	bx lr
	func_end Mixer2Arm
	.thumb
.Lmix2Tail:
	movs r0, #2
	adds r0, #1
	bx lr
	func_end Mixer2

	thumb_func_start After2
	movs r0, #0
	adds r0, #3
	bx lr
	func_end After2

	.bss
	.global gMixBuf
gMixBuf:
	.space 0x40
